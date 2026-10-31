-- =====================================================================
-- 25_drive.sql
-- Google Drive: pastas e arquivos dos conteúdos (contas com o recurso
-- 'drive' em ig_contas.recursos).
-- - drive_conexao: a conta Google ligada (refresh token). NINGUÉM lê pelo
--   painel: só a função "drive" (chave de serviço).
-- - drive_estados: o "state" do login do Google (vale 15 min)
-- - drive_pastas: cada pasta criada (raiz, conta, ano, mês, conteúdo e
--   subpastas), pelo ID do Drive. Mudou a data? A pasta é a mesma (o ID
--   não muda); a função só renomeia ou move.
-- - arquivos: cada arquivo enviado pelo painel, com versão e quem enviou
-- O painel lê pastas e arquivos das contas que vê; quem grava é a função.
--
-- Rode depois do 24_relatorios.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create table if not exists public.drive_conexao (
  id             text primary key default 'principal',
  refresh_token  text not null,
  email          text,
  conectado_por  uuid references auth.users(id) on delete set null,
  conectado_em   timestamptz not null default now()
);
alter table public.drive_conexao enable row level security;
revoke all on public.drive_conexao from anon, authenticated;

create table if not exists public.drive_estados (
  estado     text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  volta      text not null default '',
  criado_em  timestamptz not null default now()
);
alter table public.drive_estados enable row level security;
revoke all on public.drive_estados from anon, authenticated;

create table if not exists public.drive_pastas (
  chave        text primary key,   -- raiz | conta:<id> | ano:<conta>:2026 | mes:<conta>:2026-11 | sem_data:<conta> | conteudo:<id> | sub:<conteudo>:<n>
  conta_id     uuid references public.ig_contas(id) on delete cascade,
  conteudo_id  uuid references public.conteudos(id) on delete set null,
  drive_id     text not null,
  nome         text not null,
  pai_drive_id text,
  link         text,
  criado_em    timestamptz not null default now()
);
create index if not exists drive_pastas_conteudo_idx on public.drive_pastas (conteudo_id);

create table if not exists public.arquivos (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references public.ig_contas(id) on delete cascade,
  conteudo_id   uuid references public.conteudos(id) on delete set null,
  subpasta      int  not null default 1,      -- 1 Briefing e Roteiro, 2 Gravações, 3 Edição, 4 Aprovados, 5 Publicados
  drive_id      text not null unique,
  nome          text not null,
  nome_original text not null default '',
  tipo_mime     text,
  tamanho       bigint,
  versao        int not null default 1,
  link          text,
  enviado_por   uuid references auth.users(id) on delete set null,
  enviado_em    timestamptz not null default now()
);
create index if not exists arquivos_conteudo_idx on public.arquivos (conteudo_id, subpasta, enviado_em);

do $$
declare t text;
begin
  foreach t in array array['drive_pastas', 'arquivos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists "ler_membros" on public.%I', t);
  end loop;
end $$;
-- a pasta raiz não tem conta: só quem tem alguma conta com Drive vê
create policy "ler_membros" on public.drive_pastas for select to authenticated
  using (conta_id in (select public.minhas_contas()) or (conta_id is null and public.sou_admin()));
create policy "ler_membros" on public.arquivos for select to authenticated
  using (conta_id in (select public.minhas_contas()));

-- Está conectado? (sem revelar o token)
create or replace function public.drive_status()
returns table (conectado boolean, email text, conectado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select true, c.email, c.conectado_em from drive_conexao c where c.id = 'principal'
    and exists (select 1 from ig_membros m where m.user_id = auth.uid())
  union all
  select false, null, null where not exists (select 1 from drive_conexao where id = 'principal')
$$;
revoke all on function public.drive_status() from anon;
grant execute on function public.drive_status() to authenticated;
