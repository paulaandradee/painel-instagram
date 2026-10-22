-- =====================================================================
-- 13_calendario.sql
-- Calendário de conteúdo: ideias e rascunhos por data, com formato,
-- legenda, status (a fazer, pronto, publicado) e as etapas
-- gravar, editar, legenda e publicado. Cada conteúdo é de uma conta;
-- quem tem acesso à conta vê e edita.
--
-- Rode depois do 12_midias_relatorio.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create table if not exists public.conteudos (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references public.ig_contas(id) on delete cascade,
  data             date,                       -- vazio = ideia sem data
  formato          text not null default 'reels'
                   check (formato in ('reels', 'carrossel', 'post', 'story', 'live', 'outro')),
  tema             text not null default '',
  legenda          text not null default '',
  notas            text not null default '',
  status           text not null default 'a_fazer'
                   check (status in ('a_fazer', 'pronto', 'publicado')),
  etapa_gravar     boolean not null default false,
  etapa_editar     boolean not null default false,
  etapa_legenda    boolean not null default false,
  etapa_publicado  boolean not null default false,
  criado_por       uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists conteudos_data_idx on public.conteudos (conta_id, data);

-- atualizado_em sempre certo, venha a mudança de onde vier
create or replace function public.conteudos_atualizado()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists conteudos_atualizado on public.conteudos;
create trigger conteudos_atualizado
  before update on public.conteudos
  for each row execute function public.conteudos_atualizado();

-- Regras: só quem é membro da conta
alter table public.conteudos enable row level security;
revoke all on public.conteudos from anon;
grant select, insert, update, delete on public.conteudos to authenticated;
drop policy if exists "membros_da_conta" on public.conteudos;
create policy "membros_da_conta" on public.conteudos for all to authenticated
  using (conta_id in (select public.minhas_contas()))
  with check (conta_id in (select public.minhas_contas()));
