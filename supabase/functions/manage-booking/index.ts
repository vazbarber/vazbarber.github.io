// Usado pela página de gestão: confirmar, recusar ou cancelar uma marcação.
// Só funciona para quem tem login E está na tabela "admins".

import {
  adminDb, buildIcs, corsHeaders, emails, json, loadBooking, sendEmail,
} from "../_shared/common.ts";

const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  confirm: { from: ["pending"], to: "confirmed" },
  reject: { from: ["pending"], to: "rejected" },
  cancel: { from: ["confirmed", "pending"], to: "cancelled" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const db = adminDb();

  // --- Quem está a pedir?
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await db.auth.getUser(token);
  const userEmail = userData?.user?.email?.toLowerCase();
  if (!userEmail) return json({ error: "Sessão expirada. Entra outra vez." }, 401);

  const { data: admins } = await db.from("admins").select("email");
  const isAdmin = (admins ?? []).some((a: { email: string }) => a.email.toLowerCase() === userEmail);
  if (!isAdmin) return json({ error: "Sem permissão." }, 403);

  // --- O que quer fazer?
  let body: { id?: string; action?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Pedido inválido" }, 400);
  }
  const t = TRANSITIONS[body.action ?? ""];
  if (!t || !body.id) return json({ error: "Ação inválida." }, 400);
  const message = (body.message ?? "").trim().slice(0, 300) || undefined;

  // Atualiza só se ainda estiver no estado esperado (evita cliques duplos)
  const { data: updated, error } = await db.from("bookings")
    .update({ status: t.to, decided_at: new Date().toISOString() })
    .eq("id", body.id).in("status", t.from)
    .select("id");
  if (error) return json({ error: "Não foi possível atualizar." }, 500);
  if (!updated?.length) return json({ error: "Esta marcação já foi tratada. Atualiza a página." }, 409);

  // --- Avisar o cliente
  let emailSent = true;
  try {
    const b = await loadBooking(db, body.id);
    if (t.to === "confirmed") {
      await sendEmail({ to: b.customer_email, toName: b.customer_name, ...emails.confirmed(b), ics: buildIcs(b) });
    } else if (t.to === "rejected") {
      await sendEmail({ to: b.customer_email, toName: b.customer_name, ...emails.rejected(b, message) });
    } else {
      await sendEmail({ to: b.customer_email, toName: b.customer_name, ...emails.cancelled(b, message), ics: buildIcs(b, "CANCEL") });
    }
  } catch (e) {
    console.error("Email falhou:", e);
    emailSent = false;
  }

  return json({ ok: true, status: t.to, emailSent });
});
