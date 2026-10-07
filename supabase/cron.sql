-- =====================================================================
--  Lembretes automáticos — corre de hora a hora e envia o lembrete
--  ~24 horas antes de cada marcação confirmada.
--
--  ANTES DE CORRER, trocar:
--    O-TEU-PROJETO  → o ID do projeto Supabase (está no URL do projeto)
--    O-TEU-SEGREDO  → o mesmo valor que puseste no secret CRON_SECRET
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Se já existir (por correres isto duas vezes), apaga a anterior
select cron.unschedule('lembretes-marcacoes')
where exists (select 1 from cron.job where jobname = 'lembretes-marcacoes');

select cron.schedule(
  'lembretes-marcacoes',
  '0 * * * *',   -- ao minuto 0 de cada hora
  $$
  select net.http_post(
    url     := 'https://O-TEU-PROJETO.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', 'O-TEU-SEGREDO'),
    body    := '{}'::jsonb
  );
  $$
);
