-- =====================================================================
-- 01_tabelas.sql
-- Cria todas as tabelas do sistema de automação de DM do Instagram.
-- Rode este arquivo PRIMEIRO no SQL Editor do Supabase.
-- =====================================================================

-- Extensão pra gerar uuid (já vem ligada no Supabase, mas não custa garantir)
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- ig_automations: cada automação (gatilho + conversa)
-- A conversa INTEIRA mora no campo "flow" (jsonb). A Mensagem 1 é o
-- primeiro item de flow.steps. Não existem colunas separadas de
-- "mensagem" ou "link": tudo está no fluxo.
-- ---------------------------------------------------------------------
create table if not exists public.ig_automations (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null default 'Nova automação',
  keyword                text not null default '',          -- palavras separadas por vírgula
  match_any              boolean not null default false,    -- true = qualquer comentário dispara
  active                 boolean not null default true,
  media_ids              text[] not null default '{}',      -- posts escolhidos (vazio = todos)
  public_reply           text not null default '',          -- resposta pública no comentário
  public_reply_variants  text[] not null default '{}',      -- variações A/B da resposta pública
  flow                   jsonb not null default '{"steps":[]}'::jsonb,
  asset_ids              text[] not null default '{}',      -- arquivos anexados à Mensagem 1
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ig_leads: cada pessoa que interagiu (contato salvo)
-- ---------------------------------------------------------------------
create table if not exists public.ig_leads (
  ig_user_id     text primary key,
  username       text,
  last_source    text,              -- comment / dm / story_reply
  last_keyword   text,
  automation_id  uuid references public.ig_automations(id) on delete set null,
  flow_step      text,              -- em que passo da conversa a pessoa está
  link_sent      boolean not null default false,
  expecting      jsonb,             -- quando um passo pediu um dado: {"field":"email","automation_id":"...","next":3}
  tags           text[] not null default '{}',
  email          text,              -- dados capturados (campos livres)
  telefone       text,
  extra          jsonb not null default '{}'::jsonb,
  last_dm_at     timestamptz,       -- última DM ok (regra do 1 por dia)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ig_deliveries: log de cada envio (bom pra auditoria e pro painel)
-- ---------------------------------------------------------------------
create table if not exists public.ig_deliveries (
  id             bigserial primary key,
  ig_user_id     text,
  automation_id  uuid,
  canal          text,              -- private_reply / dm
  tipo           text,              -- flow / link / text
  status         text,              -- ok / erro / na_fila
  motivo         text,
  ts             timestamptz not null default now()
);
create index if not exists ig_deliveries_ts_idx   on public.ig_deliveries (ts desc);
create index if not exists ig_deliveries_user_idx on public.ig_deliveries (ig_user_id, ts desc);

-- ---------------------------------------------------------------------
-- ig_send_queue: envios segurados pelo freio (o ig-scheduler manda depois)
-- ---------------------------------------------------------------------
create table if not exists public.ig_send_queue (
  id             bigserial primary key,
  comment_id     text unique not null,
  automation_id  uuid,
  ig_user_id     text,
  username       text,
  status         text not null default 'pendente',   -- pendente / enviado / erro / expirado
  tentativas     int  not null default 0,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  last_error     text
);
create index if not exists ig_send_queue_status_idx on public.ig_send_queue (status, created_at);

-- ---------------------------------------------------------------------
-- ig_send_budget: o CONTADOR do freio (uma linha por chave)
-- SEM ESTA TABELA o freio não tem onde contar e o sistema trava mudo.
-- ---------------------------------------------------------------------
create table if not exists public.ig_send_budget (
  id             text primary key,                    -- ex: 'private_reply'
  min_count      int not null default 0,
  hour_count     int not null default 0,
  day_count      int not null default 0,
  min_start      timestamptz not null default now(),  -- início da janela do minuto
  hour_start     timestamptz not null default now(),  -- início da janela da hora
  day_start      timestamptz not null default now(),  -- início da janela do dia
  err_streak     int not null default 0,              -- falhas duras seguidas
  cap_minute     int not null default 6,              -- tetos CONSERVADORES
  cap_hour       int not null default 60,
  cap_day        int not null default 180,
  paused_until   timestamptz,                         -- disjuntor: pausa até esta hora
  updated_at     timestamptz not null default now()
);

-- Linha inicial (seed) com os tetos padrão
insert into public.ig_send_budget (id, cap_minute, cap_hour, cap_day)
values ('private_reply', 6, 60, 180)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- ig_scheduled: passos com atraso ("envia sozinho depois de X segundos")
-- ---------------------------------------------------------------------
create table if not exists public.ig_scheduled (
  id             bigserial primary key,
  ig_user_id     text not null,
  automation_id  uuid not null,
  step_id        text not null,
  send_at        timestamptz not null,
  sent           boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists ig_scheduled_due_idx on public.ig_scheduled (sent, send_at);

-- ---------------------------------------------------------------------
-- ig_assets: biblioteca de arquivos (PDF, áudio, foto, vídeo)
-- ---------------------------------------------------------------------
create table if not exists public.ig_assets (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  tipo           text not null check (tipo in ('image','audio','video','file')),
  public_url     text not null,
  attachment_id  text,               -- cache do id de anexo do Instagram
  size_bytes     bigint,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ig_token_status: validade do token do Instagram
-- ---------------------------------------------------------------------
create table if not exists public.ig_token_status (
  id                 text primary key default 'main',
  expires_at         timestamptz,
  last_ok            boolean,
  last_error         text,
  last_refreshed_at  timestamptz,
  updated_at         timestamptz not null default now()
);
insert into public.ig_token_status (id) values ('main') on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- ig_token_store: guarda o token RENOVADO pelo ig-token-refresh.
-- (Uma Edge Function não consegue reescrever os próprios segredos, então
-- o token novo fica aqui. As funções usam este token se existir, e caem
-- no segredo IG_ACCESS_TOKEN se não existir.)
-- Fica TRANCADA: RLS ligado e SEM política, só o backend lê.
-- ---------------------------------------------------------------------
create table if not exists public.ig_token_store (
  id            text primary key default 'main',
  access_token  text,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ig_bot_sends: ids (mid) das mensagens que o PRÓPRIO sistema mandou.
-- Serve pra ignorar os "echos" e não confundir envio automático com
-- resposta manual sua.
-- ---------------------------------------------------------------------
create table if not exists public.ig_bot_sends (
  mid         text primary key,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ig_processed_events: "já processei esse id" (evita eventos duplicados)
-- ---------------------------------------------------------------------
create table if not exists public.ig_processed_events (
  event_id    text primary key,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Atualiza "updated_at" sozinho
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_automations on public.ig_automations;
create trigger trg_touch_automations before update on public.ig_automations
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_leads on public.ig_leads;
create trigger trg_touch_leads before update on public.ig_leads
  for each row execute function public.touch_updated_at();
