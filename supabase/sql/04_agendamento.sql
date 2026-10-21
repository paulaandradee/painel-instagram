-- =====================================================================
-- 04_agendamento.sql
-- Agenda os robôs com pg_cron + pg_net. Rode DEPOIS de publicar as
-- Edge Functions e configurar o segredo SCHED_SECRET.
--
-- Troque os dois placeholders antes de rodar:
--   SEU_PROJETO     -> o id do seu projeto (aparece na URL do Supabase)
--   SEU_SCHED_SECRET -> a mesma senha que você colocou no segredo SCHED_SECRET
-- =====================================================================

-- O pg_cron agenda; o pg_net deixa o Postgres chamar uma URL
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamentos antigos com o mesmo nome (se rodar de novo)
do $$
begin
  perform cron.unschedule('ig-scheduler')     where exists (select 1 from cron.job where jobname = 'ig-scheduler');
  perform cron.unschedule('ig-token-refresh') where exists (select 1 from cron.job where jobname = 'ig-token-refresh');
end $$;

-- ig-scheduler: a cada 1 minuto (esvazia a fila e manda passos com atraso)
select cron.schedule(
  'ig-scheduler',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://lllcdkwkvqbszdawzhua.supabase.co/functions/v1/ig-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sched-key',  'SEU_SCHED_SECRET'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ig-token-refresh: toda segunda-feira às 06:00 (UTC)
select cron.schedule(
  'ig-token-refresh',
  '0 6 * * 1',
  $$
  select net.http_post(
    url     := 'https://lllcdkwkvqbszdawzhua.supabase.co/functions/v1/ig-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sched-key',  'SEU_SCHED_SECRET'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Pra conferir: select * from cron.job;
-- Pra ver as últimas execuções: select * from cron.job_run_details order by start_time desc limit 20;
