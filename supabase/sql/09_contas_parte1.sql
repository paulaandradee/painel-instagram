-- =====================================================================
-- 09_contas_parte1.sql
-- Várias contas de Instagram no mesmo painel, cada pessoa vendo só as
-- contas liberadas pra ela. PARTE 1: cria as tabelas novas e marca os
-- dados atuais como da primeira conta. O código antigo continua
-- funcionando (as colunas novas têm valor padrão = primeira conta).
-- Depois de publicar as funções novas, rode a PARTE 2.
--
-- Troque os 3 valores da primeira conta antes de rodar, se for outro projeto.
-- =====================================================================

-- Contas de Instagram conectadas (nada secreto aqui)
create table if not exists public.ig_contas (
  id                 uuid primary key default gen_random_uuid(),
  ig_user_id         text unique not null,   -- id da conta profissional (1784...)
  app_scoped_id      text,                   -- o outro id que a API devolve em /me
  username           text,
  nome               text,
  ativo              boolean not null default true,
  token_expira_em    timestamptz,
  token_ok           boolean,
  token_erro         text,
  token_renovado_em  timestamptz,
  criado_em          timestamptz not null default now()
);

-- Token de cada conta: TRANCADO (RLS ligado, sem política: só o backend lê)
create table if not exists public.ig_contas_token (
  conta_id      uuid primary key references public.ig_contas(id) on delete cascade,
  access_token  text not null,
  updated_at    timestamptz not null default now()
);

-- Quem acessa qual conta
create table if not exists public.ig_membros (
  user_id   uuid not null references auth.users(id) on delete cascade,
  conta_id  uuid not null references public.ig_contas(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (user_id, conta_id)
);

-- Quem administra (conecta contas e libera pessoas)
create table if not exists public.painel_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.ig_contas enable row level security;
alter table public.ig_contas_token enable row level security;
alter table public.ig_membros enable row level security;
alter table public.painel_admins enable row level security;
revoke all on public.ig_contas_token from anon, authenticated;

do $$
declare
  c   uuid;
  tok text;
  t   text;
begin
  -- Primeira conta
  insert into public.ig_contas (ig_user_id, app_scoped_id, username, nome)
  values ('17841447695850258', '28514654071537762', 'natiferraric', 'Natalia Ferrari')
  on conflict (ig_user_id) do update set username = excluded.username
  returning id into c;

  -- Token: o renovado (ig_token_store); validade: ig_token_status
  select access_token into tok from public.ig_token_store where id = 'main';
  if tok is not null then
    insert into public.ig_contas_token (conta_id, access_token) values (c, tok)
    on conflict (conta_id) do update set access_token = excluded.access_token, updated_at = now();
  end if;
  update public.ig_contas k
     set token_expira_em = s.expires_at, token_ok = s.last_ok, token_renovado_em = s.last_refreshed_at
    from public.ig_token_status s
   where s.id = 'main' and k.id = c;

  -- Quem já usa o painel vira administradora e membro da primeira conta
  insert into public.painel_admins (user_id) select id from auth.users on conflict do nothing;
  insert into public.ig_membros (user_id, conta_id) select id, c from auth.users on conflict do nothing;

  -- conta_id em todas as tabelas de dados (padrão = primeira conta, por enquanto)
  foreach t in array array['ig_automations','ig_leads','ig_deliveries','ig_send_queue','ig_scheduled','ig_assets']
  loop
    execute format('alter table public.%I add column if not exists conta_id uuid default %L references public.ig_contas(id) on delete cascade', t, c);
    execute format('update public.%I set conta_id = %L where conta_id is null', t, c);
    execute format('alter table public.%I alter column conta_id set not null', t);
    execute format('create index if not exists %I on public.%I (conta_id)', t || '_conta_idx', t);
  end loop;

  -- Freio por conta (o limite da Meta é por conta): copia o contador atual
  insert into public.ig_send_budget (id, min_count, hour_count, day_count, min_start, hour_start, day_start, err_streak, cap_minute, cap_hour, cap_day, paused_until)
  select 'private_reply:' || c, min_count, hour_count, day_count, min_start, hour_start, day_start, err_streak, cap_minute, cap_hour, cap_day, paused_until
    from public.ig_send_budget where id = 'private_reply'
  on conflict (id) do nothing;
end $$;

-- O mesmo @ pode existir em contas diferentes: lead é único por (conta, pessoa)
create unique index if not exists ig_leads_conta_user on public.ig_leads (conta_id, ig_user_id);

-- ---------------------------------------------------------------------
-- Versões por conta das funções de lead (as antigas saem na PARTE 2)
-- ---------------------------------------------------------------------
create or replace function public.registrar_interacao(p_conta uuid, p_user text, p_criar boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_criar then
    insert into ig_leads (conta_id, ig_user_id, interacoes, last_interaction_at)
    values (p_conta, p_user, 1, now())
    on conflict (conta_id, ig_user_id) do update
      set interacoes = ig_leads.interacoes + 1, last_interaction_at = now();
  else
    update ig_leads set interacoes = interacoes + 1, last_interaction_at = now()
     where conta_id = p_conta and ig_user_id = p_user;
  end if;
end $$;
revoke all on function public.registrar_interacao(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.registrar_interacao(uuid, text, boolean) to service_role;

-- Exclusão a pedido do titular, dentro de UMA conta.
-- Quem chama pelo painel precisa ter acesso à conta.
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
  );
  if alvo ~ '^[0-9]+$' then ids := ids || alvo; end if;

  delete from ig_deliveries where conta_id = p_conta and ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from ig_send_queue where conta_id = p_conta and (ig_user_id = any(ids) or lower(username) = alvo); get diagnostics n = row_count; total := total + n;
  delete from ig_scheduled  where conta_id = p_conta and ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  delete from ig_leads      where conta_id = p_conta and ig_user_id = any(ids); get diagnostics n = row_count; total := total + n;
  return total;
end $$;
revoke all on function public.apagar_dados_lead(uuid, text) from public, anon;
grant execute on function public.apagar_dados_lead(uuid, text) to authenticated, service_role;
