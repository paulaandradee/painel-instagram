-- =====================================================================
-- 22_formacao.sql
-- "Minha Formação": módulos, cursos e sessões de estudo da
-- administradora. Área PRIVADA: cada linha tem dona (dono) e só ela vê,
-- e só quem é administradora do painel grava. Clientes e leitoras nunca
-- enxergam (nem no calendário).
-- Os cursos, links e o cronograma NÃO ficam neste arquivo (o repositório
-- é público): são cadastrados direto no banco.
--
-- Também prepara ig_contas.recursos: lista de recursos novos ligados por
-- conta (Produção, Drive...). Vazio = a conta continua como está.
--
-- Rode depois do 21_caixa_familia.sql. Pode rodar de novo sem estragar.
-- Desfazer: drop table formacao_sessoes, formacao_cursos, formacao_modulos;
--           alter table ig_contas drop column recursos;
-- =====================================================================

alter table public.ig_contas add column if not exists recursos text[] not null default '{}';

-- É administradora do painel?
create or replace function public.sou_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from painel_admins where user_id = auth.uid()) $$;

create table if not exists public.formacao_modulos (
  id         uuid primary key default gen_random_uuid(),
  dono       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero     int  not null,
  titulo     text not null,
  mes        text not null default '',     -- ex.: "Novembro de 2026"
  objetivo   text not null default '',
  entrega    text not null default '',     -- entrega do mês
  unique (dono, numero)
);

create table if not exists public.formacao_cursos (
  id                 uuid primary key default gen_random_uuid(),
  dono               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  modulo_id          uuid not null references public.formacao_modulos(id) on delete cascade,
  numero             int  not null,
  nome               text not null,
  instituicao        text not null default 'Sebrae',
  link               text not null default '',
  carga_h            numeric not null default 0,   -- carga anunciada
  valor              text not null default '',
  competencias       text[] not null default '{}',
  aplicacao_prevista text[] not null default '{}',
  entrega            text not null default '',
  status             text not null default 'nao_iniciado'
                     check (status in ('nao_iniciado', 'matriculado', 'em_andamento', 'concluido',
                                       'certificado_pendente', 'certificado_recebido')),
  anotacoes          jsonb not null default '{}',  -- resumo, conceitos, duvidas, exemplos, referencias
  exercicios         jsonb not null default '[]',  -- [{ texto, feito, resposta }]
  pratica            jsonb not null default '{}',  -- aprendizado, tarefa, experimento, conteudo, resultado
  pratica_status     text not null default 'pendente'
                     check (pratica_status in ('pendente', 'em_andamento', 'entregue')),
  cert_arquivo       text,                         -- caminho no armazenamento "formacao"
  cert_data          date,
  cert_horas         numeric,
  cert_link          text not null default '',     -- link do Drive, se houver
  atualizado_em      timestamptz not null default now(),
  unique (dono, numero)
);

create table if not exists public.formacao_sessoes (
  id            uuid primary key default gen_random_uuid(),
  dono          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero        int  not null,                -- 1 a 52 (não muda ao remarcar)
  semana        int  not null,
  modulo_id     uuid references public.formacao_modulos(id) on delete set null,
  curso_id      uuid references public.formacao_cursos(id) on delete set null,
  data          date not null,
  inicio        time not null default '18:30',
  fim           time not null default '20:30',
  tema          text not null default '',
  tarefa        text not null default '',
  status        text not null default 'planejada' check (status in ('planejada', 'feita', 'nao_feita')),
  flexivel      boolean not null default false, -- feriado ou véspera: pode remarcar
  notas         text not null default '',
  atualizado_em timestamptz not null default now(),
  unique (dono, numero)
);
create index if not exists formacao_sessoes_data_idx on public.formacao_sessoes (dono, data);

-- atualizado_em (mesma função do calendário)
drop trigger if exists formacao_cursos_atualizado on public.formacao_cursos;
create trigger formacao_cursos_atualizado before update on public.formacao_cursos
  for each row execute function public.conteudos_atualizado();
drop trigger if exists formacao_sessoes_atualizado on public.formacao_sessoes;
create trigger formacao_sessoes_atualizado before update on public.formacao_sessoes
  for each row execute function public.conteudos_atualizado();

-- Regras: só a dona, e só se for administradora
do $$
declare t text;
begin
  foreach t in array array['formacao_modulos', 'formacao_cursos', 'formacao_sessoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "so_a_dona" on public.%I', t);
    execute format('create policy "so_a_dona" on public.%I for all to authenticated
      using (dono = auth.uid() and public.sou_admin())
      with check (dono = auth.uid() and public.sou_admin())', t);
  end loop;
end $$;

-- Certificados: armazenamento privado, pasta = id da dona
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('formacao', 'formacao', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "formacao_ler" on storage.objects;
create policy "formacao_ler" on storage.objects for select to authenticated
  using (bucket_id = 'formacao' and (storage.foldername(name))[1] = auth.uid()::text and public.sou_admin());
drop policy if exists "formacao_subir" on storage.objects;
create policy "formacao_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'formacao' and (storage.foldername(name))[1] = auth.uid()::text and public.sou_admin());
drop policy if exists "formacao_apagar" on storage.objects;
create policy "formacao_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'formacao' and (storage.foldername(name))[1] = auth.uid()::text and public.sou_admin());
