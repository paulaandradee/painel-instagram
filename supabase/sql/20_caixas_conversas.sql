-- =====================================================================
-- 20_caixas_conversas.sql
-- Caixas da aba Conversas: Aguardando, Respondidas e Arquivadas.
-- - Mensagem nova da cliente: volta pra Aguardando (até se estava arquivada)
-- - Resposta da conta (painel, celular, robô): vai pra Respondidas,
--   mas conversa ARQUIVADA continua arquivada
-- - Mensagem antiga (histórico importado) não muda a caixa
--
-- Rode depois do 19_ritmo_seguro.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.conversa_ao_receber_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update conversas set
    ultima_mensagem_em   = greatest(ultima_mensagem_em, new.criada_em),
    ultima_do_cliente_em = case when new.autor = 'cliente'
                                then greatest(coalesce(ultima_do_cliente_em, new.criada_em), new.criada_em)
                                else ultima_do_cliente_em end,
    status               = case
                             when new.criada_em < ultima_mensagem_em then status   -- mensagem antiga
                             when new.autor = 'cliente' then 'aguardando'
                             when status = 'arquivada' then 'arquivada'
                             else 'respondida'
                           end
  where id = new.conversa_id;
  return new;
end $$;
