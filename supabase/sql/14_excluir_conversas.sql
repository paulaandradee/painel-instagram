-- =====================================================================
-- 14_excluir_conversas.sql
-- Permite excluir conversas ARQUIVADAS pelo painel (mensagens e
-- sugestões vão junto). Só da conta da pessoa. Não apaga nada no
-- Instagram, e o Relatório continua contando os atendimentos.
--
-- Rode depois do 13_calendario.sql. Pode rodar de novo sem estragar.
-- =====================================================================

grant delete on public.conversas to authenticated;

drop policy if exists "excluir_conversa_arquivada" on public.conversas;
create policy "excluir_conversa_arquivada" on public.conversas for delete to authenticated
  using (conta_id in (select public.minhas_contas()) and status = 'arquivada');
