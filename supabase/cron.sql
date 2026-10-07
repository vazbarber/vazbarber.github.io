-- =====================================================================
--  Lembretes automáticos — corre de hora a hora e envia o lembrete
--  ~24 horas antes de cada marcação confirmada.
--  Antes de correr, trocar O-TEU-PROJETO pelo ID do projeto Supabase.
--  O segredo é lido da tabela privada app_settings (criada no schema.sql).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lembretes-marcacoes')
where exists (select 1 from cron.job where jobname = 'lembretes-marcacoes');

select cron.schedule(
  'lembretes-marcacoes',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://O-TEU-PROJETO.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', (select value from public.app_settings where key = 'cron_secret')),
    body    := '{}'::jsonb
  );
  $$
);
