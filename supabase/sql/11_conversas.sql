-- =====================================================================
-- 11_conversas.sql
-- Caixa de entrada com SUGESTÃO de resposta (IA). A IA só sugere: o
-- envio acontece quando alguém clica em Enviar no painel.
--
-- - conversas: uma por pessoa, por conta de Instagram
-- - mensagens: tudo que a cliente mandou e o que "eu" respondi
-- - sugestoes: o texto sugerido pela IA pra cada conversa
-- - abordagem: o roteiro de atendimento do time (um por conta)
--
-- Rode depois do 10_contas_parte2.sql. Pode rodar de novo sem estragar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.conversas (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references public.ig_contas(id) on delete cascade,
  instagram_user_id     text not null,                 -- id da pessoa (IGSID)
  nome                  text,
  username              text,                          -- @ (usado pra esconder da IA)
  ultima_mensagem_em    timestamptz not null default now(),
  ultima_do_cliente_em  timestamptz,                   -- abre a janela de 24h da Meta
  status                text not null default 'aguardando'
                        check (status in ('aguardando', 'respondida', 'arquivada')),
  criada_em             timestamptz not null default now(),
  unique (conta_id, instagram_user_id)
);
create index if not exists conversas_lista_idx on public.conversas (conta_id, ultima_mensagem_em desc);

create table if not exists public.mensagens (
  id                    uuid primary key default gen_random_uuid(),
  conversa_id           uuid not null references public.conversas(id) on delete cascade,
  conta_id              uuid not null references public.ig_contas(id) on delete cascade, -- pro RLS e o Realtime
  autor                 text not null check (autor in ('cliente', 'eu')),
  texto                 text not null default '',
  criada_em             timestamptz not null default now(),
  instagram_message_id  text unique                    -- o "mid": evita gravar a mesma mensagem 2x
);
create index if not exists mensagens_conversa_idx on public.mensagens (conversa_id, criada_em desc);

create table if not exists public.sugestoes (
  id              uuid primary key default gen_random_uuid(),
  conversa_id     uuid not null references public.conversas(id) on delete cascade,
  conta_id        uuid not null references public.ig_contas(id) on delete cascade,
  texto_sugerido  text not null,
  criada_em       timestamptz not null default now(),
  usada           boolean not null default false
);
create index if not exists sugestoes_conversa_idx on public.sugestoes (conversa_id, criada_em desc);

-- Um roteiro por conta. Cole o texto pelo painel (botão "Roteiro") ou no Table Editor.
create table if not exists public.abordagem (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null unique references public.ig_contas(id) on delete cascade,
  texto          text not null default '',
  atualizada_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) Cada mensagem nova atualiza a conversa (ordem da lista, janela de
--    24h e status). Fica no banco pra webhook e envio não esquecerem.
-- ---------------------------------------------------------------------
create or replace function public.conversa_ao_receber_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update conversas set
    ultima_mensagem_em   = greatest(ultima_mensagem_em, new.criada_em),
    ultima_do_cliente_em = case when new.autor = 'cliente'
                                then greatest(coalesce(ultima_do_cliente_em, new.criada_em), new.criada_em)
                                else ultima_do_cliente_em end,
    status               = case when new.autor = 'cliente' then 'aguardando' else 'respondida' end
  where id = new.conversa_id;
  return new;
end $$;

drop trigger if exists mensagens_atualiza_conversa on public.mensagens;
create trigger mensagens_atualiza_conversa
  after insert on public.mensagens
  for each row execute function public.conversa_ao_receber_mensagem();

-- ---------------------------------------------------------------------
-- 3) Regras (RLS): só quem é membro da conta. Mensagens e sugestões o
--    painel só LÊ; quem grava é o backend (service_role).
-- ---------------------------------------------------------------------
alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;
alter table public.sugestoes enable row level security;
alter table public.abordagem enable row level security;
revoke all on public.conversas, public.mensagens, public.sugestoes, public.abordagem from anon;

drop policy if exists "ver_conversas" on public.conversas;
create policy "ver_conversas" on public.conversas for select to authenticated
  using (conta_id in (select public.minhas_contas()));
drop policy if exists "mudar_status_conversa" on public.conversas;
create policy "mudar_status_conversa" on public.conversas for update to authenticated
  using (conta_id in (select public.minhas_contas()))
  with check (conta_id in (select public.minhas_contas()));

drop policy if exists "ver_mensagens" on public.mensagens;
create policy "ver_mensagens" on public.mensagens for select to authenticated
  using (conta_id in (select public.minhas_contas()));

drop policy if exists "ver_sugestoes" on public.sugestoes;
create policy "ver_sugestoes" on public.sugestoes for select to authenticated
  using (conta_id in (select public.minhas_contas()));

drop policy if exists "membros_da_conta" on public.abordagem;
create policy "membros_da_conta" on public.abordagem for all to authenticated
  using (conta_id in (select public.minhas_contas()))
  with check (conta_id in (select public.minhas_contas()));

-- ---------------------------------------------------------------------
-- 4) Realtime nas tabelas mensagens e sugestoes (o painel atualiza sozinho)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mensagens', 'sugestoes']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) LGPD: a exclusão a pedido do titular também apaga as conversas
--    (mensagens e sugestões vão junto, pelo "on delete cascade").
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
  return total;
end $$;
revoke all on function public.apagar_dados_lead(uuid, text) from public, anon;
grant execute on function public.apagar_dados_lead(uuid, text) to authenticated, service_role;

-- Retenção: mesma regra de 2 anos, agora também pras conversas paradas
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
end $$;
revoke all on function public.limpeza_retencao() from public, anon, authenticated;
