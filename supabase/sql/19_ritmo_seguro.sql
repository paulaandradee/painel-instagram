-- =====================================================================
-- 19_ritmo_seguro.sql
-- 22/10: o Instagram avisou @natiferraric de "suspeita de automação".
-- Causa: rajadas da repescagem (~90 pessoas de uma vez) + DMs repetidas
-- (erro "desconhecido" que na verdade entregava, tentado até 5x) +
-- a mesma resposta pública em todo comentário.
-- Aqui: tetos menores no freio (o excesso espera na fila e sai aos
-- poucos) e variações na resposta pública das automações que não tinham.
-- =====================================================================

-- Freio: no máximo 2 DMs por minuto, 20 por hora, 100 por dia por conta
alter table public.ig_send_budget alter column cap_minute set default 2;
alter table public.ig_send_budget alter column cap_hour   set default 20;
alter table public.ig_send_budget alter column cap_day    set default 100;
update public.ig_send_budget set cap_minute = 2, cap_hour = 20, cap_day = 100;

-- Resposta pública: sorteia entre a original e estas (só onde não havia variação)
update public.ig_automations
   set public_reply_variants = array[
     'Te mandei no direct, dá uma olhadinha 🧡',
     'Acabei de te chamar no direct!',
     'Olha seu direct 💌',
     'Te enviei as informações por mensagem ✨',
     'Já te respondi lá no direct 😉',
     'Corre no direct que te mandei tudo!'
   ]
 where coalesce(trim(public_reply), '') <> ''
   and coalesce(array_length(public_reply_variants, 1), 0) = 0;
