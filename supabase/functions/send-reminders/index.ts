// Chamado de hora a hora pelo agendador (ver supabase/cron.sql).
// Envia o lembrete por email ~24h antes de cada marcação confirmada.

import { adminDb, cfg, emails, initConfig, json, sendEmail, type Booking } from "../_shared/common.ts";

const HOUR = 3_600_000;

Deno.serve(async (req) => {
  await initConfig();
  if (!cfg.cronSecret || req.headers.get("x-cron-secret") !== cfg.cronSecret)
    return json({ error: "Não autorizado" }, 401);

  const db = adminDb();
  const now = Date.now();

  const { data, error } = await db.from("bookings")
    .select("*, services(name, price_eur)")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gt("starts_at", new Date(now + HOUR).toISOString())
    .lte("starts_at", new Date(now + 24 * HOUR).toISOString());
  if (error) return json({ error: error.message }, 500);

  let sent = 0, skipped = 0, failed = 0;
  for (const b of (data ?? []) as Booking[]) {
    // Confirmada há pouco tempo? O email de confirmação já serve de lembrete.
    const confirmedAt = b.decided_at ? new Date(b.decided_at).getTime() : 0;
    const recentlyConfirmed = new Date(b.starts_at).getTime() - confirmedAt < 12 * HOUR;

    try {
      if (recentlyConfirmed) {
        skipped++;
      } else {
        await sendEmail({ to: b.customer_email, toName: b.customer_name, ...emails.reminder(b) });
        sent++;
      }
      await db.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
    } catch (e) {
      console.error(`Lembrete falhou para ${b.id}:`, e);
      failed++;
    }
  }

  const schedule = await remindToSetSchedule(db).catch((e) => {
    console.error("Aviso de horário falhou:", e);
    return "erro";
  });

  return json({ ok: true, sent, skipped, failed, schedule });
});

/**
 * A partir do dia 20 (depois das 9h em Lisboa), se o mês seguinte ainda não
 * tiver nenhum dia aberto, envia um email à dona — uma vez por mês.
 */
async function remindToSetSchedule(db: ReturnType<typeof adminDb>) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  if (Number(parts.day) < 20 || Number(parts.hour) < 9 || !cfg.ownerEmail) return "fora de prazo";

  const y = Number(parts.year), m = Number(parts.month);           // mês atual (1-12)
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;      // mês seguinte
  const monthKey = `${ny}-${String(nm).padStart(2, "0")}`;
  const first = `${monthKey}-01`;
  const last = new Date(Date.UTC(ny, nm, 0)).toISOString().slice(0, 10);

  const { data: done } = await db.from("app_settings").select("value").eq("key", "schedule_reminder_sent").maybeSingle();
  if (done?.value === monthKey) return "já enviado";

  const { count } = await db.from("availability").select("day", { count: "exact", head: true })
    .gte("day", first).lte("day", last);
  if ((count ?? 0) > 0) return "mês já definido";

  const monthName = new Intl.DateTimeFormat("pt-PT", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(ny, nm - 1, 15)));
  await sendEmail({ to: cfg.ownerEmail, ...emails.scheduleReminder(monthName) });
  await db.from("app_settings").upsert({ key: "schedule_reminder_sent", value: monthKey });
  return "enviado";
}
