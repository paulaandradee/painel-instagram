-- =====================================================================
-- 27_estrategia_lab_portfolio.sql
-- - estrategias: a Estratégia Editorial de cada conta (posicionamento,
--   público, tom de voz, perfil, identidade visual, pilares com meta de
--   distribuição, meta autoral × remix, diagnóstico inicial)
-- - experimentos (+ experimento_conteudos): o Laboratório. Os números vêm
--   das métricas coletadas; resultado, interpretação e conclusão são
--   escritos por você (nada é inventado)
-- - portfolio_casos: estudos de caso do Portfólio (privado: só a dona,
--   e só administradora)
-- Leitura: equipe da conta (e a expert, só a Estratégia). Escrita: equipe
-- que edita (não "só visualização", não colaboradora).
--
-- Rode depois do 26_colaboradores.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create table if not exists public.estrategias (
  conta_id       uuid primary key references public.ig_contas(id) on delete cascade,
  essencia       text not null default '',
  proposito      text not null default '',
  promessa       text not null default '',
  publico        text not null default '',
  tom_voz        text[] not null default '{}',
  nome_perfil    text not null default '',
  bio            text not null default '',
  bio_status     text not null default 'proposta' check (bio_status in ('proposta', 'aplicada')),
  destaques      text[] not null default '{}',
  fixados        text[] not null default '{}',
  perfil_notas   text not null default '',
  paleta         jsonb not null default '[]',   -- [{ nome, hex }]
  estilo         text not null default '',
  regras         text[] not null default '{}',
  pilares        jsonb not null default '[]',   -- [{ nome, meta_pct, descricao }]
  meta_origem    jsonb not null default '{}',   -- { autoral: n, remix: n, mes: "2026-11", funcao_autoral, funcao_remix }
  diagnostico    jsonb not null default '{}',   -- { periodo, fonte, indicadores: [{nome, valor}], faixas: [...], destaques: [...], texto, hipoteses: [] }
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid() references auth.users(id) on delete set null
);
drop trigger if exists estrategias_atualizado on public.estrategias;
create trigger estrategias_atualizado before update on public.estrategias
  for each row execute function public.conteudos_atualizado();

create table if not exists public.experimentos (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references public.ig_contas(id) on delete cascade,
  letra          text not null default '',
  nome           text not null,
  objetivo       text not null default '',
  hipotese       text not null default '',
  inicio         date,
  fim            date,
  metrica        text not null default 'views' check (metrica in ('views', 'alcance', 'salvos', 'compartilhamentos', 'curtidas', 'comentarios', 'seguidores')),
  comparar       text not null default 'manual' check (comparar in ('origem', 'formato', 'campanha', 'manual')),
  campanha_id    uuid references public.campanhas(id) on delete set null,
  status         text not null default 'planejado' check (status in ('planejado', 'em_andamento', 'concluido', 'cancelado')),
  resultado      text not null default '',
  interpretacao  text not null default '',
  conclusao      text not null default '',
  proximo_teste  text not null default '',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
drop trigger if exists experimentos_atualizado on public.experimentos;
create trigger experimentos_atualizado before update on public.experimentos
  for each row execute function public.conteudos_atualizado();

create table if not exists public.experimento_conteudos (
  experimento_id uuid not null references public.experimentos(id) on delete cascade,
  conteudo_id    uuid not null references public.conteudos(id) on delete cascade,
  conta_id       uuid not null references public.ig_contas(id) on delete cascade,
  grupo          text not null default 'A',     -- A / B (comparação manual)
  primary key (experimento_id, conteudo_id)
);

create table if not exists public.portfolio_casos (
  id            uuid primary key default gen_random_uuid(),
  dono          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conta_id      uuid references public.ig_contas(id) on delete set null,
  titulo        text not null,
  subtitulo     text not null default '',
  secoes        jsonb not null default '{}',   -- { contexto: "...", diagnostico: "...", ... }
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
drop trigger if exists portfolio_atualizado on public.portfolio_casos;
create trigger portfolio_atualizado before update on public.portfolio_casos
  for each row execute function public.conteudos_atualizado();

-- ---------- Regras ----------
do $$
declare t text;
begin
  foreach t in array array['estrategias', 'experimentos', 'experimento_conteudos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "ler_membros" on public.%I', t);
    execute format('create policy "ler_membros" on public.%I for select to authenticated using (conta_id in (select public.minhas_contas()))', t);
    execute format('drop policy if exists "incluir_editores" on public.%I', t);
    execute format('create policy "incluir_editores" on public.%I for insert to authenticated with check (conta_id in (select public.contas_que_edito()))', t);
    execute format('drop policy if exists "alterar_editores" on public.%I', t);
    execute format('create policy "alterar_editores" on public.%I for update to authenticated using (conta_id in (select public.contas_que_edito())) with check (conta_id in (select public.contas_que_edito()))', t);
    execute format('drop policy if exists "apagar_editores" on public.%I', t);
    execute format('create policy "apagar_editores" on public.%I for delete to authenticated using (conta_id in (select public.contas_que_edito()))', t);
  end loop;
end $$;
-- a expert vê (não altera) a estratégia do projeto dela
drop policy if exists "ler_colaboradores" on public.estrategias;
create policy "ler_colaboradores" on public.estrategias for select to authenticated
  using (conta_id in (select conta_id from colaboradores where user_id = auth.uid() and papel = 'expert'));

alter table public.portfolio_casos enable row level security;
revoke all on public.portfolio_casos from anon;
grant select, insert, update, delete on public.portfolio_casos to authenticated;
drop policy if exists "so_a_dona" on public.portfolio_casos;
create policy "so_a_dona" on public.portfolio_casos for all to authenticated
  using (dono = auth.uid() and public.sou_admin()) with check (dono = auth.uid() and public.sou_admin());
