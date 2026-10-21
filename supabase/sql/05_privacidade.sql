-- =====================================================================
-- 05_privacidade.sql
-- Cumpre o que a Política de Privacidade promete:
--   1) apagar_dados_lead('@usuario'): atende um pedido de exclusão
--   2) limpeza automática diária: apaga quem ficou 2 anos sem interação
-- Rode depois do 03_rls.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Exclusão a pedido do titular.
-- Uso no SQL Editor:  select public.apagar_dados_lead('@usuario');
-- (aceita o @ com ou sem arroba, ou o id numérico)
-- Retorna quantos registros foram apagados.
-- ---------------------------------------------------------------------
create or replace function public.apagar_dados_lead(p_quem text)
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
  -- Acha o(s) id(s) pelo @ ou pelo id numérico
  select array_agg(ig_user_id) into ids
    from ig_leads where lower(username) = alvo or ig_user_id = alvo;
  ids := coalesce(ids, '{}') || array(
    select distinct ig_user_id from ig_send_queue where lower(username) = alvo or ig_user_id = alvo
  );
  if alvo ~ '^[0-9]+$' then ids := ids || alvo; end if;

  delete from ig_deliveries where ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from ig_send_queue where ig_user_id = any(ids) or lower(username) = alvo; get diagnostics n = row_count; total := total + n;
  delete from ig_scheduled  where ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from ig_leads      where ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  return total;
end $$;

revoke all on function public.apagar_dados_lead(text) from public, anon;
grant execute on function public.apagar_dados_lead(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) Retenção: apaga quem está há mais de 2 anos sem nenhuma interação.
-- Também limpa registros técnicos antigos (envios, fila, agendados e
-- ids de eventos), que não precisam ficar guardados.
-- ---------------------------------------------------------------------
create or replace function public.limpeza_retencao()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  limite timestamptz := now() - interval '2 years';
begin
  delete from ig_deliveries where ig_user_id in (
    select ig_user_id from ig_leads where greatest(updated_at, coalesce(last_dm_at, updated_at)) < limite
  );
  delete from ig_scheduled where ig_user_id in (
    select ig_user_id from ig_leads where greatest(updated_at, coalesce(last_dm_at, updated_at)) < limite
  );
  delete from ig_leads where greatest(updated_at, coalesce(last_dm_at, updated_at)) < limite;

  delete from ig_deliveries        where ts < limite;
  delete from ig_send_queue        where created_at < limite;
  delete from ig_scheduled         where sent and send_at < now() - interval '30 days';
  delete from ig_processed_events  where created_at < now() - interval '30 days';
  delete from ig_bot_sends         where created_at < now() - interval '30 days';
end $$;

revoke all on function public.limpeza_retencao() from public, anon, authenticated;

-- Agenda a limpeza todo dia às 04:00 (UTC)
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('limpeza-retencao') where exists (select 1 from cron.job where jobname = 'limpeza-retencao');
end $$;
select cron.schedule('limpeza-retencao', '0 4 * * *', $$ select public.limpeza_retencao(); $$);
