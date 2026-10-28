-- =====================================================================
-- 21_caixa_familia.sql
-- Nova caixa "Família" na aba Conversas (família, amigos, contatos
-- pessoais). Conversa marcada como Família FICA em Família, mesmo quando
-- a pessoa escreve de novo: não volta pra Aguardando.
-- As outras regras continuam as do 20_caixas_conversas.sql. O botão
-- "Marcar como respondida" do painel só muda o status pra 'respondida':
-- a conversa volta pra Aguardando quando a cliente escrever de novo.
--
-- Rode depois do 20_caixas_conversas.sql. Pode rodar de novo sem estragar.
-- =====================================================================

alter table public.conversas drop constraint if exists conversas_status_check;
alter table public.conversas add constraint conversas_status_check
  check (status in ('aguardando', 'respondida', 'arquivada', 'familia'));

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
                             when status = 'familia' then 'familia'                -- família fica em Família
                             when new.autor = 'cliente' then 'aguardando'
                             when status = 'arquivada' then 'arquivada'
                             else 'respondida'
                           end
  where id = new.conversa_id;
  return new;
end $$;
