-- =====================================================================
-- 08_repescagem.sql
-- Campos extras na fila pra "repescagem" (responder comentários dos
-- últimos 7 dias que ficaram sem DM). Rode depois do 07_analises.sql.
-- =====================================================================

-- Quando o comentário foi feito (a Meta só aceita resposta privada até
-- ~7 dias depois dele; a fila usa isso pra expirar na hora certa)
alter table public.ig_send_queue add column if not exists comment_ts timestamptz;

-- Se, depois de mandar a DM, deve responder também no comentário
alter table public.ig_send_queue add column if not exists responder_publico boolean not null default false;

-- De onde veio o item da fila: 'webhook' (normal) ou 'repescagem'
alter table public.ig_send_queue add column if not exists origem text not null default 'webhook';
