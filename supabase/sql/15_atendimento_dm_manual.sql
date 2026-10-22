-- =====================================================================
-- 15_atendimento_dm_manual.sql
-- Relatório: toda resposta enviada pela conta no Direct conta como
-- atendimento (painel, celular ou computador), mesmo em conversa antiga
-- cujas mensagens da cliente são de antes do painel existir.
-- (O Instagram só deixa mandar DM pra quem escreveu antes: toda mensagem
-- da conta é uma resposta.)
--
-- Não conta aqui, pra não contar em dobro:
-- - mensagens dos robôs (ig_bot_sends): já contam pelos envios (ig_deliveries)
-- - a DM de resposta a comentário (envio private_reply de até 2 min antes
--   ou depois): conta como "comentario", não como Direct
--
-- Rode depois do 14_excluir_conversas.sql. Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.eh_resposta_manual_dm(p_conta uuid, p_user text, p_mid text, p_quando timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from ig_bot_sends b where p_mid is not null and b.mid = p_mid)
     and not exists (
       select 1 from ig_deliveries d
        where d.conta_id = p_conta and d.ig_user_id = p_user and d.canal = 'private_reply'
          and d.ts between p_quando - interval '2 minutes' and p_quando + interval '2 minutes'
     );
$$;
revoke all on function public.eh_resposta_manual_dm(uuid, text, text, timestamptz) from public, anon, authenticated;

create or replace function public.atendimento_por_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quem text;
begin
  -- só o que acabou de sair (o histórico importado pela repescagem não entra)
  if new.autor = 'eu' and new.criada_em > now() - interval '1 day' then
    select instagram_user_id into quem from conversas where id = new.conversa_id;
    if quem is not null and eh_resposta_manual_dm(new.conta_id, quem, new.instagram_message_id, new.criada_em) then
      perform registrar_atendimento(new.conta_id, quem, 'dm', new.criada_em);
    end if;
  end if;
  return new;
end $$;

-- Recupera as respostas de 22/10/2026 (quando o painel passou a gravar o que
-- sai) que ficaram de fora pela regra antiga. O histórico importado de antes
-- disso não entra.
insert into public.atendimentos (conta_id, ig_user_id, canal, dia, primeiro_em)
select e.conta_id, c.instagram_user_id, 'dm', (e.criada_em at time zone 'America/Sao_Paulo')::date, min(e.criada_em)
  from public.mensagens e
  join public.conversas c on c.id = e.conversa_id
 where e.autor = 'eu'
   and e.criada_em >= timestamptz '2026-10-22 00:00:00-03'
   and public.eh_resposta_manual_dm(e.conta_id, c.instagram_user_id, e.instagram_message_id, e.criada_em)
 group by 1, 2, 3, 4
on conflict do nothing;
