-- =====================================================================
-- 06_interacoes.sql
-- Dados extras pra aba "Interações" do painel.
-- Rode depois do 05_privacidade.sql.
-- =====================================================================

-- Novos campos do lead
alter table public.ig_leads add column if not exists nome text;                      -- nome do perfil (quando a API libera)
alter table public.ig_leads add column if not exists interacoes int not null default 0; -- quantas vezes a pessoa interagiu
alter table public.ig_leads add column if not exists last_interaction_at timestamptz;  -- última interação DELA (não do bot)

-- ---------------------------------------------------------------------
-- registrar_interacao: soma 1 no contador da pessoa.
--   p_criar = true  -> cria o lead se ainda não existir (comentário que ativou automação)
--   p_criar = false -> só conta se a pessoa já é lead (mensagem no direct)
-- ---------------------------------------------------------------------
create or replace function public.registrar_interacao(p_user text, p_criar boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_criar then
    insert into ig_leads (ig_user_id, interacoes, last_interaction_at)
    values (p_user, 1, now())
    on conflict (ig_user_id) do update
      set interacoes = ig_leads.interacoes + 1, last_interaction_at = now();
  else
    update ig_leads set interacoes = interacoes + 1, last_interaction_at = now()
     where ig_user_id = p_user;
  end if;
end $$;

revoke all on function public.registrar_interacao(text, boolean) from public, anon, authenticated;
grant execute on function public.registrar_interacao(text, boolean) to service_role;

-- ---------------------------------------------------------------------
-- ig_leads_painel: o que a planilha do painel lê.
-- security_invoker = respeita o RLS (só quem está logado vê).
-- ---------------------------------------------------------------------
create or replace view public.ig_leads_painel
with (security_invoker = true) as
select
  l.*,
  a.nome as automacao_nome,
  (select count(*) from public.ig_deliveries d
    where d.ig_user_id = l.ig_user_id and d.status = 'ok') as mensagens_enviadas
from public.ig_leads l
left join public.ig_automations a on a.id = l.automation_id;

revoke all on public.ig_leads_painel from anon;
grant select on public.ig_leads_painel to authenticated;
