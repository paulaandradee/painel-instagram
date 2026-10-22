-- =====================================================================
-- 10_contas_parte2.sql
-- Várias contas, PARTE 2: rode DEPOIS de publicar as funções e o painel
-- novos. Liga as regras de acesso por conta: cada pessoa só lê e grava
-- dados das contas liberadas pra ela (tabela ig_membros).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Sem valor padrão: todo dado novo PRECISA dizer de qual conta é
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ig_automations','ig_leads','ig_deliveries','ig_send_queue','ig_scheduled','ig_assets']
  loop
    execute format('alter table public.%I alter column conta_id drop default', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) Lead: chave passa a ser (conta, pessoa)
-- ---------------------------------------------------------------------
alter table public.ig_leads drop constraint if exists ig_leads_pkey;
alter table public.ig_leads add primary key (conta_id, ig_user_id);
drop index if exists public.ig_leads_conta_user;

-- ---------------------------------------------------------------------
-- 3) Ajudas para as regras (security definer: leem ig_membros sem RLS)
-- ---------------------------------------------------------------------
create or replace function public.minhas_contas()
returns setof uuid
language sql stable security definer set search_path = public
as $$ select conta_id from ig_membros where user_id = auth.uid() $$;

create or replace function public.sou_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from painel_admins where user_id = auth.uid()) $$;

revoke all on function public.minhas_contas() from public, anon;
revoke all on function public.sou_admin() from public, anon;
grant execute on function public.minhas_contas() to authenticated;
grant execute on function public.sou_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 4) Regras (RLS)
-- ---------------------------------------------------------------------
-- Tabelas com dados de uma conta: só quem é membro da conta
do $$
declare t text;
begin
  foreach t in array array['ig_automations','ig_leads','ig_deliveries','ig_send_queue','ig_scheduled','ig_assets']
  loop
    execute format('drop policy if exists "painel_autenticado" on public.%I', t);
    execute format('drop policy if exists "membros_da_conta" on public.%I', t);
    execute format(
      'create policy "membros_da_conta" on public.%I for all to authenticated
         using (conta_id in (select public.minhas_contas()))
         with check (conta_id in (select public.minhas_contas()))', t);
  end loop;
end $$;

-- Tabelas internas do sistema: só o backend (service_role) mexe
do $$
declare t text;
begin
  foreach t in array array['ig_send_budget','ig_bot_sends','ig_processed_events','ig_token_status','ig_analises_cache','ig_token_store']
  loop
    execute format('drop policy if exists "painel_autenticado" on public.%I', t);
  end loop;
end $$;

-- Contas: cada pessoa vê as suas (administradora vê todas). Gravar: só pelo backend.
drop policy if exists "ver_contas" on public.ig_contas;
create policy "ver_contas" on public.ig_contas for select to authenticated
  using (id in (select public.minhas_contas()) or public.sou_admin());

-- Membros: cada pessoa vê os próprios acessos (administradora vê todos)
drop policy if exists "ver_membros" on public.ig_membros;
create policy "ver_membros" on public.ig_membros for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());

-- Administradoras: cada pessoa só consegue ver se ela mesma é
drop policy if exists "ver_admin" on public.painel_admins;
create policy "ver_admin" on public.painel_admins for select to authenticated
  using (user_id = auth.uid());

revoke all on public.ig_contas, public.ig_membros, public.painel_admins from anon;

-- ---------------------------------------------------------------------
-- 5) Visão da planilha de leads (refeita com a conta)
-- ---------------------------------------------------------------------
drop view if exists public.ig_leads_painel;
create view public.ig_leads_painel
with (security_invoker = true) as
select
  l.*,
  a.nome as automacao_nome,
  (select count(*) from public.ig_deliveries d
    where d.conta_id = l.conta_id and d.ig_user_id = l.ig_user_id and d.status = 'ok') as mensagens_enviadas
from public.ig_leads l
left join public.ig_automations a on a.id = l.automation_id;
revoke all on public.ig_leads_painel from anon;
grant select on public.ig_leads_painel to authenticated;

-- ---------------------------------------------------------------------
-- 6) Funções antigas (de uma conta só) saem
-- ---------------------------------------------------------------------
drop function if exists public.registrar_interacao(text, boolean);
drop function if exists public.apagar_dados_lead(text);

-- Limpeza de retenção: mesmo comportamento, agora casando conta + pessoa
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
end $$;
revoke all on function public.limpeza_retencao() from public, anon, authenticated;
