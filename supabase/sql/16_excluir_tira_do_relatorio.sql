-- =====================================================================
-- 16_excluir_tira_do_relatorio.sql
-- Excluir uma conversa = era pessoal, não trabalho: os atendimentos de
-- DIRECT daquela pessoa saem do Relatório (todos os dias). Os de
-- comentário ficam (foram respostas da automação a um comentário).
-- Se a pessoa escrever de novo e for respondida, volta a contar.
--
-- Também limpa:
-- - atendimentos de Direct de antes de 22/10/2026 criados a partir do
--   histórico importado pela repescagem (não foram atendimentos daqueles
--   dias: o 12_midias_relatorio.sql contava as mensagens importadas)
-- - atendimentos de Direct de conversas que já tinham sido excluídas
--
-- Rode depois do 15_atendimento_dm_manual.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.conversa_excluida_sai_do_relatorio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from atendimentos
   where conta_id = old.conta_id and ig_user_id = old.instagram_user_id and canal = 'dm';
  return old;
end $$;

drop trigger if exists conversas_excluida_relatorio on public.conversas;
create trigger conversas_excluida_relatorio
  after delete on public.conversas
  for each row execute function public.conversa_excluida_sai_do_relatorio();

-- Um atendimento de Direct "de verdade" de um dia tem envio de automação
-- (ig_deliveries) ou resposta gravada ao vivo (de 22/10/2026 em diante)
delete from public.atendimentos a
 where a.canal = 'dm' and a.dia < date '2026-10-22'
   and not exists (
     select 1 from public.ig_deliveries d
      where d.conta_id = a.conta_id and d.ig_user_id = a.ig_user_id and d.canal = 'dm' and d.status = 'ok'
        and (d.ts at time zone 'America/Sao_Paulo')::date = a.dia);

delete from public.atendimentos a
 where a.canal = 'dm' and a.dia >= date '2026-10-22'
   and not exists (select 1 from public.conversas c where c.conta_id = a.conta_id and c.instagram_user_id = a.ig_user_id)
   and not exists (
     select 1 from public.ig_deliveries d
      where d.conta_id = a.conta_id and d.ig_user_id = a.ig_user_id and d.canal = 'dm' and d.status = 'ok'
        and (d.ts at time zone 'America/Sao_Paulo')::date = a.dia);
