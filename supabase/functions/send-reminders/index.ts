// Chamado de hora a hora pelo agendador (ver supabase/cron.sql).
// Envia o lembrete por email ~24h antes de cada marcação confirmada.

import { adminDb, cfg, emails, json, sendEmail, type Booking } from "../_shared/common.ts";

const HOUR = 3_600_000;

Deno.serve(async (req) => {
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

  return json({ ok: true, sent, skipped, failed });
});
