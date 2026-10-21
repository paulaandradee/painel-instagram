-- =====================================================================
-- 03_rls.sql
-- Regras de acesso (RLS). Rode depois do 02_freio.sql.
--
-- - O painel (pessoa logada) lê e escreve.
-- - O público anônimo NÃO acessa nada.
-- - As Edge Functions usam a service_role, que ignora o RLS.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'ig_automations','ig_leads','ig_deliveries','ig_send_queue','ig_send_budget',
    'ig_scheduled','ig_assets','ig_token_status','ig_bot_sends','ig_processed_events'
  ]
  loop
    -- Liga o RLS
    execute format('alter table public.%I enable row level security', t);

    -- Remove a política antiga (se rodar de novo) e cria a nova:
    -- só usuários autenticados (você logada no painel)
    execute format('drop policy if exists "painel_autenticado" on public.%I', t);
    execute format(
      'create policy "painel_autenticado" on public.%I for all to authenticated using (true) with check (true)', t
    );

    -- Garante que o anônimo não tem permissão nenhuma
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ig_token_store: RLS ligado e SEM política nenhuma.
-- Nem o painel lê o token; só as Edge Functions (service_role).
alter table public.ig_token_store enable row level security;
revoke all on public.ig_token_store from anon, authenticated;
