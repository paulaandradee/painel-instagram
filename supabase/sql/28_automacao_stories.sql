-- =====================================================================
-- 28_automacao_stories.sql
-- Automação por RESPOSTA AO STORY: a pessoa responde um story com a
-- palavra-chave e recebe a Mensagem 1 no direct.
-- - ig_automations.gatilho: 'comentario' (como sempre) ou 'story'.
--   media_ids, numa automação de story, guarda os stories escolhidos
--   (vazio = todos os stories).
-- - ig_send_queue.via: a fila do freio passa a guardar envios de story
--   (vão por DM normal, pelo id da pessoa, e valem por 24h).
-- - O freio é o MESMO da conta (story e comentário somam no mesmo teto).
-- - Liga o recurso 'stories' só na @tudoserestaura.
-- Pode rodar de novo sem problema.
-- =====================================================================

alter table public.ig_automations
  add column if not exists gatilho text not null default 'comentario';
do $$ begin
  alter table public.ig_automations add constraint ig_automations_gatilho_chk check (gatilho in ('comentario', 'story'));
exception when duplicate_object then null; end $$;

alter table public.ig_send_queue
  add column if not exists via text not null default 'comentario';
do $$ begin
  alter table public.ig_send_queue add constraint ig_send_queue_via_chk check (via in ('comentario', 'story'));
exception when duplicate_object then null; end $$;

update public.ig_contas
   set recursos = array_append(recursos, 'stories')
 where username = 'tudoserestaura' and not ('stories' = any(recursos));
