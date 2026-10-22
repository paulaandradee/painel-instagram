-- =====================================================================
-- 12_midias_relatorio.sql
-- - Mídia nas conversas: imagem, vídeo, áudio, PDF e o coração ❤️
--   (colunas em mensagens + pasta "midias" no Storage)
-- - Relatório de atendimentos: 1 por pessoa, por canal, por dia
--   (comentário e Direct contam separados)
--
-- Rode depois do 11_conversas.sql. Pode rodar de novo sem estragar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Mídia nas mensagens
-- ---------------------------------------------------------------------
alter table public.mensagens add column if not exists midia_tipo text;  -- image / video / audio / file / like_heart
alter table public.mensagens add column if not exists midia_url  text;

-- Pasta pública "midias": o Instagram baixa o arquivo por este link.
-- Os nomes são aleatórios ({conta}/{uuid}.ext), ninguém adivinha o endereço.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('midias', 'midias', true, 26214400, array[
  'image/png', 'image/jpeg', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg', 'video/x-msvideo',
  'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'application/pdf'
])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Quem está logado só sobe arquivo na pasta das contas dela
drop policy if exists "midias_subir" on storage.objects;
create policy "midias_subir" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'midias'
    and (storage.foldername(name))[1] in (select c::text from public.minhas_contas() c)
  );

-- ---------------------------------------------------------------------
-- 2) Atendimentos: uma linha por (conta, pessoa, canal, dia)
--    O mesmo dia não repete a pessoa; no dia seguinte conta de novo.
--    Comentário e Direct são canais separados (respondida nos dois = 2).
--    O dia é o de Brasília.
-- ---------------------------------------------------------------------
create table if not exists public.atendimentos (
  conta_id     uuid not null references public.ig_contas(id) on delete cascade,
  ig_user_id   text not null,
  canal        text not null check (canal in ('comentario', 'dm')),
  dia          date not null,
  primeiro_em  timestamptz not null default now(),
  primary key (conta_id, canal, dia, ig_user_id)
);
create index if not exists atendimentos_dia_idx on public.atendimentos (conta_id, dia);

alter table public.atendimentos enable row level security;
revoke all on public.atendimentos from anon;
drop policy if exists "ver_atendimentos" on public.atendimentos;
create policy "ver_atendimentos" on public.atendimentos for select to authenticated
  using (conta_id in (select public.minhas_contas()));

create or replace function public.registrar_atendimento(p_conta uuid, p_user text, p_canal text, p_quando timestamptz default now())
returns void
language sql
security definer
set search_path = public
as $$
  insert into atendimentos (conta_id, ig_user_id, canal, dia, primeiro_em)
  values (p_conta, p_user, p_canal, (p_quando at time zone 'America/Sao_Paulo')::date, p_quando)
  on conflict do nothing;
$$;
revoke all on function public.registrar_atendimento(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_atendimento(uuid, text, text, timestamptz) to service_role;

-- a) Envios das automações (resposta privada do comentário, passos no Direct)
create or replace function public.atendimento_por_envio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ok' and new.ig_user_id is not null then
    if new.canal = 'private_reply' then
      perform registrar_atendimento(new.conta_id, new.ig_user_id, 'comentario', new.ts);
    elsif new.canal = 'dm' then
      perform registrar_atendimento(new.conta_id, new.ig_user_id, 'dm', new.ts);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ig_deliveries_atendimento on public.ig_deliveries;
create trigger ig_deliveries_atendimento
  after insert on public.ig_deliveries
  for each row execute function public.atendimento_por_envio();

-- b) Respostas no Direct (painel, celular ou automação): conta quando a
--    cliente tinha escrito no Direct nos 7 dias anteriores.
create or replace function public.atendimento_por_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quem text;
begin
  if new.autor = 'eu' and exists (
    select 1 from mensagens m
     where m.conversa_id = new.conversa_id and m.autor = 'cliente'
       and m.criada_em <= new.criada_em and m.criada_em > new.criada_em - interval '7 days'
  ) then
    select instagram_user_id into quem from conversas where id = new.conversa_id;
    if quem is not null then
      perform registrar_atendimento(new.conta_id, quem, 'dm', new.criada_em);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists mensagens_atendimento on public.mensagens;
create trigger mensagens_atendimento
  after insert on public.mensagens
  for each row execute function public.atendimento_por_mensagem();

-- c) Histórico: o que já foi enviado conta também
insert into public.atendimentos (conta_id, ig_user_id, canal, dia, primeiro_em)
select conta_id, ig_user_id,
       case canal when 'private_reply' then 'comentario' else 'dm' end,
       (ts at time zone 'America/Sao_Paulo')::date, min(ts)
  from public.ig_deliveries
 where status = 'ok' and ig_user_id is not null and canal in ('private_reply', 'dm')
 group by 1, 2, 3, 4
on conflict do nothing;

insert into public.atendimentos (conta_id, ig_user_id, canal, dia, primeiro_em)
select e.conta_id, c.instagram_user_id, 'dm', (e.criada_em at time zone 'America/Sao_Paulo')::date, min(e.criada_em)
  from public.mensagens e
  join public.conversas c on c.id = e.conversa_id
 where e.autor = 'eu' and exists (
   select 1 from public.mensagens m
    where m.conversa_id = e.conversa_id and m.autor = 'cliente'
      and m.criada_em <= e.criada_em and m.criada_em > e.criada_em - interval '7 days')
 group by 1, 2, 3, 4
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3) Relatório: atendimentos por dia, num intervalo (o painel agrupa
--    por semana, mês ou ano). Só das contas da pessoa.
-- ---------------------------------------------------------------------
create or replace function public.relatorio_atendimentos(p_conta uuid, p_de date, p_ate date)
returns table (dia date, comentarios bigint, dms bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.dia,
         count(*) filter (where a.canal = 'comentario') as comentarios,
         count(*) filter (where a.canal = 'dm')         as dms
    from atendimentos a
   where a.conta_id = p_conta and a.dia between p_de and p_ate
   group by a.dia
   order by a.dia;
$$;
revoke all on function public.relatorio_atendimentos(uuid, date, date) from public, anon;
grant execute on function public.relatorio_atendimentos(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4) LGPD e retenção agora cobrem os atendimentos
-- ---------------------------------------------------------------------
create or replace function public.apagar_dados_lead(p_conta uuid, p_quem text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo text := lower(trim(leading '@' from trim(p_quem)));
  ids text[];
  total int := 0;
  n int;
begin
  if auth.uid() is not null and not exists (
    select 1 from ig_membros where user_id = auth.uid() and conta_id = p_conta
  ) then
    raise exception 'sem acesso a esta conta';
  end if;

  select array_agg(ig_user_id) into ids
    from ig_leads where conta_id = p_conta and (lower(username) = alvo or ig_user_id = alvo);
  ids := coalesce(ids, '{}') || array(
    select distinct ig_user_id from ig_send_queue
     where conta_id = p_conta and (lower(username) = alvo or ig_user_id = alvo)
  ) || array(
    select instagram_user_id from conversas
     where conta_id = p_conta and (lower(username) = alvo or instagram_user_id = alvo)
  );
  if alvo ~ '^[0-9]+$' then ids := ids || alvo; end if;

  delete from ig_deliveries where conta_id = p_conta and ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from ig_send_queue where conta_id = p_conta and (ig_user_id = any(ids) or lower(username) = alvo); get diagnostics n = row_count; total := total + n;
  delete from ig_scheduled  where conta_id = p_conta and ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from ig_leads      where conta_id = p_conta and ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from conversas     where conta_id = p_conta and instagram_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from atendimentos  where conta_id = p_conta and ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  return total;
end $$;
revoke all on function public.apagar_dados_lead(uuid, text) from public, anon;
grant execute on function public.apagar_dados_lead(uuid, text) to authenticated, service_role;

create or replace function public.limpeza_retencao()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  limite timestamptz := now() - interval '2 years';
begin
  delete from ig_deliveries d using ig_leads l
   where d.conta_id = l.conta_id and d.ig_user_id = l.ig_user_id
     and greatest(l.updated_at, coalesce(l.last_dm_at, l.updated_at)) < limite;
  delete from ig_scheduled s using ig_leads l
   where s.conta_id = l.conta_id and s.ig_user_id = l.ig_user_id
     and greatest(l.updated_at, coalesce(l.last_dm_at, l.updated_at)) < limite;
  delete from ig_leads where greatest(updated_at, coalesce(last_dm_at, updated_at)) < limite;

  delete from ig_deliveries        where ts < limite;
  delete from ig_send_queue        where created_at < limite;
  delete from ig_scheduled         where sent and send_at < now() - interval '30 days';
  delete from ig_processed_events  where created_at < now() - interval '30 days';
  delete from ig_bot_sends         where created_at < now() - interval '30 days';
  delete from conversas            where ultima_mensagem_em < limite;
  delete from atendimentos         where dia < (limite at time zone 'America/Sao_Paulo')::date;
end $$;
revoke all on function public.limpeza_retencao() from public, anon, authenticated;
