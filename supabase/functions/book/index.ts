// Recebe um pedido de marcação do site público, valida a vaga,
// guarda como "pending" e envia emails ao cliente e à dona do negócio.

import {
  adminDb, cfg, corsHeaders, emails, json, lisbonDay, loadBooking, sendEmail,
} from "../_shared/common.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Pedido inválido" }, 400);
  }

  // Campo escondido anti-spam: pessoas não o preenchem, robôs sim.
  if (body.website) return json({ ok: true });

  const serviceId = Number(body.service_id);
  const startsAt = new Date(String(body.starts_at ?? ""));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const notes = String(body.notes ?? "").trim().slice(0, 500) || null;

  if (!Number.isInteger(serviceId) || isNaN(startsAt.getTime()))
    return json({ error: "Escolhe um serviço e um horário." }, 400);
  if (name.length < 2 || name.length > 100)
    return json({ error: "Indica o teu nome." }, 400);
  if (!EMAIL_RE.test(email))
    return json({ error: "O email não parece válido." }, 400);
  if (!/^[+\d][\d\s-]{5,24}$/.test(phone))
    return json({ error: "O número de telemóvel não parece válido." }, 400);

  const db = adminDb();

  const { data: service } = await db
    .from("services").select("id, duration_minutes")
    .eq("id", serviceId).eq("active", true).maybeSingle();
  if (!service) return json({ error: "Serviço indisponível." }, 400);

  // A hora escolhida tem de estar entre as vagas livres desse dia.
  const { data: slots, error: slotErr } = await db.rpc("available_slots", {
    p_day: lisbonDay(startsAt),
    p_service_id: serviceId,
  });
  if (slotErr) return json({ error: "Erro a verificar disponibilidade." }, 500);
  const free = (slots ?? []).some(
    (s: { slot_start: string }) => new Date(s.slot_start).getTime() === startsAt.getTime(),
  );
  if (!free) return json({ error: "Esse horário acabou de ficar ocupado. Escolhe outro, por favor." }, 409);

  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000);
  const { data: inserted, error } = await db.from("bookings").insert({
    service_id: serviceId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    customer_name: name,
    customer_email: email,
    customer_phone: phone,
    notes,
  }).select("id").single();

  if (error) {
    // 23P01 = duas pessoas a marcar o mesmo horário ao mesmo tempo
    if (error.code === "23P01")
      return json({ error: "Esse horário acabou de ficar ocupado. Escolhe outro, por favor." }, 409);
    console.error(error);
    return json({ error: "Não foi possível guardar a marcação." }, 500);
  }

  // Emails: se falharem, a marcação fica guardada na mesma.
  try {
    const b = await loadBooking(db, inserted.id);
    const tasks = [sendEmail({ to: b.customer_email, toName: b.customer_name, ...emails.requestReceived(b) })];
    if (cfg.ownerEmail) tasks.push(sendEmail({ to: cfg.ownerEmail, ...emails.newRequestForOwner(b) }));
    const results = await Promise.allSettled(tasks);
    results.forEach((r) => r.status === "rejected" && console.error("Email falhou:", r.reason));
  } catch (e) {
    console.error("Erro nos emails:", e);
  }

  return json({ ok: true, id: inserted.id });
});
