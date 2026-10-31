-- =====================================================================
-- 26_colaboradores.sql
-- Papéis de colaboração na Produção: EXPERT (cliente) e EDITOR (vídeo).
-- Ficam numa tabela à parte (colaboradores), NÃO em ig_membros: assim
-- nunca enxergam DMs, leads, conversas nem automações da conta (dados
-- pessoais de seguidores), mesmo que uma regra nova esqueça de barrar.
--
-- Expert (no projeto dela):
--   vê conteúdos, tarefas, campanhas, comentários, histórico, arquivos e
--   pastas; relatórios de desempenho só se ver_relatorios = true.
--   Pode: mudar a etapa para gravando/gravado/aprovado/ajustes, mudar o
--   status e as notas das tarefas DELA, comentar e enviar gravações.
--   Não pode: criar/apagar conteúdo, mexer em datas, roteiro, estratégia,
--   automações, acessos; apagar arquivos.
-- Editor (de vídeo):
--   vê só os conteúdos em que é responsável pela edição ou tem tarefa,
--   e só as tarefas dele. Pode: etapa em_edicao/editado/aguardando
--   aprovação, status das tarefas dele, comentar, enviar versões.
-- Quem barra é o banco (políticas + gatilhos); a tela só organiza.
--
-- Rode depois do 25_drive.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create table if not exists public.colaboradores (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conta_id        uuid not null references public.ig_contas(id) on delete cascade,
  papel           text not null check (papel in ('expert', 'editor')),
  ver_relatorios  boolean not null default false,
  criado_em       timestamptz not null default now(),
  primary key (user_id, conta_id)
);
alter table public.colaboradores enable row level security;
revoke all on public.colaboradores from anon;
grant select on public.colaboradores to authenticated;
drop policy if exists "ver_proprio" on public.colaboradores;
create policy "ver_proprio" on public.colaboradores for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());

-- Papel da pessoa logada numa conta (null = não colabora)
create or replace function public.meu_papel(p_conta uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$ select papel from colaboradores where user_id = auth.uid() and conta_id = p_conta $$;

create or replace function public.contas_colaboro()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select conta_id from colaboradores where user_id = auth.uid() $$;

-- Conteúdos que a colaboradora vê: expert = todos da conta; editor = os dele
create or replace function public.conteudos_colaboro()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from conteudos c join colaboradores k on k.conta_id = c.conta_id and k.user_id = auth.uid()
  where k.papel = 'expert'
     or c.resp_edicao = auth.uid()
     or exists (select 1 from tarefas t where t.conteudo_id = c.id and t.responsavel = auth.uid())
$$;

-- ---------- Leitura ----------
drop policy if exists "ver_colaboro" on public.ig_contas;
create policy "ver_colaboro" on public.ig_contas for select to authenticated
  using (id in (select public.contas_colaboro()));

drop policy if exists "ler_colaboradores" on public.conteudos;
create policy "ler_colaboradores" on public.conteudos for select to authenticated
  using (id in (select public.conteudos_colaboro()));

drop policy if exists "ler_colaboradores" on public.tarefas;
create policy "ler_colaboradores" on public.tarefas for select to authenticated
  using (responsavel = auth.uid() and conta_id in (select public.contas_colaboro())
         or conta_id in (select conta_id from colaboradores where user_id = auth.uid() and papel = 'expert'));

drop policy if exists "ler_colaboradores" on public.campanhas;
create policy "ler_colaboradores" on public.campanhas for select to authenticated
  using (conta_id in (select conta_id from colaboradores where user_id = auth.uid() and papel = 'expert'));

do $$
declare t text;
begin
  foreach t in array array['conteudo_comentarios', 'conteudo_historico', 'arquivos'] loop
    execute format('drop policy if exists "ler_colaboradores" on public.%I', t);
    execute format('create policy "ler_colaboradores" on public.%I for select to authenticated using (conteudo_id in (select public.conteudos_colaboro()))', t);
  end loop;
end $$;
drop policy if exists "ler_colaboradores" on public.drive_pastas;
create policy "ler_colaboradores" on public.drive_pastas for select to authenticated
  using (conteudo_id in (select public.conteudos_colaboro()));

-- relatórios e métricas: só expert com ver_relatorios
drop policy if exists "ler_colaboradores" on public.relatorios;
create policy "ler_colaboradores" on public.relatorios for select to authenticated
  using (conta_id in (select conta_id from colaboradores where user_id = auth.uid() and papel = 'expert' and ver_relatorios));
drop policy if exists "ler_colaboradores" on public.metricas_posts;
create policy "ler_colaboradores" on public.metricas_posts for select to authenticated
  using (conta_id in (select conta_id from colaboradores where user_id = auth.uid() and papel = 'expert'));

-- ---------- Escrita ----------
drop policy if exists "alterar_colaboradores" on public.conteudos;
create policy "alterar_colaboradores" on public.conteudos for update to authenticated
  using (id in (select public.conteudos_colaboro())) with check (id in (select public.conteudos_colaboro()));

drop policy if exists "alterar_colaboradores" on public.tarefas;
create policy "alterar_colaboradores" on public.tarefas for update to authenticated
  using (responsavel = auth.uid() and conta_id in (select public.contas_colaboro()))
  with check (responsavel = auth.uid() and conta_id in (select public.contas_colaboro()));

drop policy if exists "incluir_colaboradores" on public.conteudo_comentarios;
create policy "incluir_colaboradores" on public.conteudo_comentarios for insert to authenticated
  with check (conteudo_id in (select public.conteudos_colaboro()) and autor = auth.uid());

-- Colaboradora só muda a ETAPA (e só para as etapas do papel dela).
-- Quem é da equipe da conta (ig_membros que edita) não passa por aqui.
create or replace function public.conteudos_limite_colaborador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p text;
  ignorar text[] := array['etapa', 'status', 'etapa_publicado', 'atualizado_em'];
begin
  if auth.uid() is null or new.conta_id in (select contas_que_edito()) then return new; end if;
  p := meu_papel(old.conta_id);
  if p is null then return new; end if;  -- as políticas já barram quem não é nada
  if (to_jsonb(new) - ignorar) is distinct from (to_jsonb(old) - ignorar) then
    raise exception 'Seu acesso permite mudar só a etapa deste conteúdo.' using errcode = '42501';
  end if;
  if new.etapa is distinct from old.etapa and not (
       (p = 'expert' and new.etapa in ('gravando', 'gravado', 'aprovado', 'ajustes_solicitados'))
    or (p = 'editor' and new.etapa in ('em_edicao', 'editado', 'aguardando_aprovacao'))) then
    raise exception 'Essa etapa não é do seu papel.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists conteudos_limite_colaborador on public.conteudos;
create trigger conteudos_limite_colaborador before update on public.conteudos
  for each row execute function public.conteudos_limite_colaborador();

-- Nas tarefas dela: só status e notas
create or replace function public.tarefas_limite_colaborador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare ignorar text[] := array['status', 'notas', 'atualizado_em'];
begin
  if auth.uid() is null or new.conta_id in (select contas_que_edito()) then return new; end if;
  if meu_papel(old.conta_id) is null then return new; end if;
  if (to_jsonb(new) - ignorar) is distinct from (to_jsonb(old) - ignorar) then
    raise exception 'Seu acesso permite mudar só o status e as notas da tarefa.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists tarefas_limite_colaborador on public.tarefas;
create trigger tarefas_limite_colaborador before update on public.tarefas
  for each row execute function public.tarefas_limite_colaborador();

-- ---------- Responsáveis: equipe + colaboradoras ----------
-- (precisa apagar antes: a função muda o que devolve)
drop function if exists public.membros_da_conta(uuid);
create function public.membros_da_conta(p_conta uuid)
returns table (user_id uuid, email text, papel text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email::text, 'equipe'
  from ig_membros m join auth.users u on u.id = m.user_id
  where m.conta_id = p_conta
    and (p_conta in (select public.minhas_contas()) or p_conta in (select public.contas_colaboro()))
  union all
  select k.user_id, u.email::text, k.papel
  from colaboradores k join auth.users u on u.id = k.user_id
  where k.conta_id = p_conta
    and (p_conta in (select public.minhas_contas()) or p_conta in (select public.contas_colaboro()))
  order by 2
$$;
revoke all on function public.membros_da_conta(uuid) from anon;
grant execute on function public.membros_da_conta(uuid) to authenticated;
