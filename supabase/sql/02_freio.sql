-- =====================================================================
-- 02_freio.sql
-- As funções do FREIO de envio (token bucket atômico).
--
-- AVISO IMPORTANTE: sem estas funções, o freio falha FECHADO e NENHUMA
-- DM por comentário sai (tudo vai pra fila e a fila nunca anda).
-- É o passo que NÃO pode faltar. Rode depois do 01_tabelas.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- take_send_slot: tenta pegar uma "ficha" de envio.
-- Retorna true se pode enviar agora, false se tem que esperar (fila).
-- Usa SELECT ... FOR UPDATE pra ser atômico (duas chamadas ao mesmo
-- tempo nunca pegam a mesma ficha).
-- ---------------------------------------------------------------------
create or replace function public.take_send_slot(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.ig_send_budget%rowtype;
  agora timestamptz := now();
begin
  -- Trava a linha do contador
  select * into b from public.ig_send_budget where id = p_key for update;

  -- Se a linha não existe, cria com os tetos padrão e trava de novo
  if not found then
    insert into public.ig_send_budget (id) values (p_key) on conflict (id) do nothing;
    select * into b from public.ig_send_budget where id = p_key for update;
  end if;

  -- Disjuntor ligado? Não envia.
  if b.paused_until is not null and b.paused_until > agora then
    return false;
  end if;

  -- Zera as janelas que já viraram
  if agora - b.min_start  >= interval '1 minute' then b.min_count  := 0; b.min_start  := agora; end if;
  if agora - b.hour_start >= interval '1 hour'   then b.hour_count := 0; b.hour_start := agora; end if;
  if agora - b.day_start  >= interval '1 day'    then b.day_count  := 0; b.day_start  := agora; end if;

  -- Algum teto estourado? Grava as janelas zeradas e responde "não".
  if b.min_count >= b.cap_minute or b.hour_count >= b.cap_hour or b.day_count >= b.cap_day then
    update public.ig_send_budget
       set min_count = b.min_count, hour_count = b.hour_count, day_count = b.day_count,
           min_start = b.min_start, hour_start = b.hour_start, day_start = b.day_start,
           updated_at = agora
     where id = p_key;
    return false;
  end if;

  -- Pega a ficha
  update public.ig_send_budget
     set min_count  = b.min_count + 1,
         hour_count = b.hour_count + 1,
         day_count  = b.day_count + 1,
         min_start  = b.min_start, hour_start = b.hour_start, day_start = b.day_start,
         updated_at = agora
   where id = p_key;

  return true;
end $$;

-- ---------------------------------------------------------------------
-- record_send_result: registra o resultado de um envio.
--   p_ok   = deu certo?
--   p_hard = foi falha "dura" (bloqueio, limite da Meta)?
-- 3 falhas duras seguidas ligam o disjuntor por 3 horas.
-- ---------------------------------------------------------------------
create or replace function public.record_send_result(p_key text, p_ok boolean, p_hard boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  streak int;
begin
  if p_ok then
    update public.ig_send_budget set err_streak = 0, updated_at = now() where id = p_key;
    return;
  end if;

  if p_hard then
    update public.ig_send_budget
       set err_streak = err_streak + 1, updated_at = now()
     where id = p_key
     returning err_streak into streak;

    if streak >= 3 then
      update public.ig_send_budget
         set paused_until = now() + interval '3 hours', err_streak = 0
       where id = p_key;
    end if;
  end if;
end $$;

-- Só o backend (service_role) pode chamar as funções do freio
revoke all on function public.take_send_slot(text) from public, anon, authenticated;
revoke all on function public.record_send_result(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.take_send_slot(text) to service_role;
grant execute on function public.record_send_result(text, boolean, boolean) to service_role;
