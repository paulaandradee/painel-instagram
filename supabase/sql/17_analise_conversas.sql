-- =====================================================================
-- 17_analise_conversas.sql
-- Análise das conversas do dia (feita pela IA): resumo, principais
-- dúvidas, objeções e perfil/realidade dos leads. Uma por conta por dia,
-- guardada para não gastar a cota gratuita da IA a cada vez que abre.
-- Quem grava é o backend (conversas-acoes); o painel só lê.
--
-- Rode depois do 16_excluir_tira_do_relatorio.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create table if not exists public.analises_conversas (
  conta_id    uuid not null references public.ig_contas(id) on delete cascade,
  dia         date not null,
  dados       jsonb not null,            -- { resumo, duvidas[], objecoes[], perfil[] }
  conversas   int not null default 0,    -- quantas conversas entraram
  mensagens   int not null default 0,
  criada_em   timestamptz not null default now(),
  primary key (conta_id, dia)
);

alter table public.analises_conversas enable row level security;
revoke all on public.analises_conversas from anon;
drop policy if exists "ver_analises" on public.analises_conversas;
create policy "ver_analises" on public.analises_conversas for select to authenticated
  using (conta_id in (select public.minhas_contas()));
