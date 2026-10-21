-- =====================================================================
-- 07_analises.sql
-- Guarda o resultado da aba "Análises" (cache), pra a tela abrir rápido
-- e não gastar o limite de chamadas da API do Instagram.
-- Só a função ig-insights lê e escreve aqui (RLS ligado, sem política).
-- Rode depois do 06_interacoes.sql.
-- =====================================================================
create table if not exists public.ig_analises_cache (
  chave          text primary key,          -- ex: 'analise:30', 'comentarios:30'
  dados          jsonb not null,
  atualizado_em  timestamptz not null default now()
);

alter table public.ig_analises_cache enable row level security;
revoke all on public.ig_analises_cache from anon, authenticated;
