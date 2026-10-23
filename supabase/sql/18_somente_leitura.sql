-- =====================================================================
-- 18_somente_leitura.sql
-- Acesso "só visualização": a pessoa marcada em painel_leitores vê tudo
-- das contas liberadas pra ela (automações, leads, conversas, relatório,
-- calendário), mas não grava nada. Quem barra é o banco: as regras de
-- gravar usam contas_que_edito(), que deixa de fora quem é leitora.
-- As Edge Functions que enviam ou geram coisas também conferem.
--
-- Rode depois do 17_analise_conversas.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create table if not exists public.painel_leitores (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.painel_leitores enable row level security;
revoke all on public.painel_leitores from anon;

-- Cada pessoa vê se ela mesma é leitora (administradora vê todas). Gravar: só pelo backend.
drop policy if exists "ver_leitores" on public.painel_leitores;
create policy "ver_leitores" on public.painel_leitores for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());

-- Contas em que a pessoa logada pode ALTERAR (as dela, se não for leitora)
create or replace function public.contas_que_edito()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select conta_id from ig_membros
   where user_id = auth.uid()
     and not exists (select 1 from painel_leitores where user_id = auth.uid())
$$;
revoke all on function public.contas_que_edito() from public, anon;
grant execute on function public.contas_que_edito() to authenticated;

-- ---------------------------------------------------------------------
-- Tabelas que o painel grava: ler = membros; gravar = quem edita
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ig_automations','ig_leads','ig_deliveries','ig_send_queue','ig_scheduled','ig_assets','abordagem','conteudos']
  loop
    execute format('drop policy if exists "membros_da_conta" on public.%I', t);
    execute format('drop policy if exists "ler_membros" on public.%I', t);
    execute format('drop policy if exists "incluir_editores" on public.%I', t);
    execute format('drop policy if exists "alterar_editores" on public.%I', t);
    execute format('drop policy if exists "apagar_editores" on public.%I', t);
    execute format('create policy "ler_membros" on public.%I for select to authenticated
       using (conta_id in (select public.minhas_contas()))', t);
    execute format('create policy "incluir_editores" on public.%I for insert to authenticated
       with check (conta_id in (select public.contas_que_edito()))', t);
    execute format('create policy "alterar_editores" on public.%I for update to authenticated
       using (conta_id in (select public.contas_que_edito()))
       with check (conta_id in (select public.contas_que_edito()))', t);
    execute format('create policy "apagar_editores" on public.%I for delete to authenticated
       using (conta_id in (select public.contas_que_edito()))', t);
  end loop;
end $$;

-- Conversas: arquivar e excluir só quem edita
drop policy if exists "mudar_status_conversa" on public.conversas;
create policy "mudar_status_conversa" on public.conversas for update to authenticated
  using (conta_id in (select public.contas_que_edito()))
  with check (conta_id in (select public.contas_que_edito()));

drop policy if exists "excluir_conversa_arquivada" on public.conversas;
create policy "excluir_conversa_arquivada" on public.conversas for delete to authenticated
  using (conta_id in (select public.contas_que_edito()) and status = 'arquivada');

-- Anexos: subir arquivo só quem edita
drop policy if exists "midias_subir" on storage.objects;
create policy "midias_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'midias'
    and (storage.foldername(name))[1] in (select c::text from public.contas_que_edito() c));

-- ---------------------------------------------------------------------
-- Apagar dados de um lead (LGPD): só quem edita
-- (mesma função do 12_midias_relatorio.sql, com a checagem nova)
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
    select 1 from contas_que_edito() c where c = p_conta
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
