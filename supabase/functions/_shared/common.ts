// Código partilhado pelas funções: configuração, envio de email (Brevo),
// modelos de email, ficheiro de calendário (.ics) e utilitários.

import { createClient } from "npm:@supabase/supabase-js@2";

export const TZ = "Europe/Lisbon";

export const env = (name: string, fallback = ""): string =>
  Deno.env.get(name) ?? fallback;

/**
 * Configuração. Os dados do negócio (emails, morada, endereço do site...) ficam
 * na tabela privada public.app_settings, que só o servidor consegue ler — assim
 * nada pessoal fica no código, que é público no GitHub. Um "secret" das Edge
 * Functions com o mesmo nome em maiúsculas (ex.: BREVO_API_KEY) tem prioridade.
 */
export const cfg = {
  businessName: "Vaz Barber",
  businessAddress: "",
  businessPhone: "",
  ownerEmail: "",
  senderEmail: "",
  senderName: "",
  siteUrl: "",
  brevoKey: "",
  cronSecret: "",
  allowedOrigin: env("ALLOWED_ORIGIN", "*"),
};

/** Cliente com permissões totais — só existe no servidor, nunca no site. */
export const adminDb = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

let loadedAt = 0;
/** Carrega a configuração (com cache de 1 minuto). Chamar no início de cada pedido. */
export async function initConfig() {
  if (Date.now() - loadedAt < 60_000) return;
  const { data, error } = await adminDb().from("app_settings").select("key, value");
  if (error) console.error("Não foi possível ler app_settings:", error.message);
  const s: Record<string, string> = Object.fromEntries(
    (data ?? []).map((r: { key: string; value: string }) => [r.key, r.value ?? ""]),
  );
  const pick = (key: string, fallback = "") => env(key.toUpperCase()) || s[key] || fallback;
  cfg.businessName = pick("business_name", "Vaz Barber");
  cfg.businessAddress = pick("business_address");
  cfg.businessPhone = pick("business_phone");
  cfg.ownerEmail = pick("owner_email");
  cfg.senderEmail = pick("sender_email");
  cfg.senderName = pick("sender_name") || cfg.businessName;
  cfg.siteUrl = pick("site_url").replace(/\/+$/, "");
  cfg.brevoKey = pick("brevo_api_key");
  cfg.cronSecret = pick("cron_secret");
  loadedAt = Date.now();
}

// ------------------------------------------------------------------ HTTP

export const corsHeaders = {
  "Access-Control-Allow-Origin": cfg.allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ------------------------------------------------------------------ Datas

export const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("pt-PT", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long",
  }).format(d);

export const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("pt-PT", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  }).format(d);

/** "2026-10-13" — o dia em Lisboa correspondente a um instante. */
export const lisbonDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);

const icsStamp = (d: Date) =>
  d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

// ------------------------------------------------------------------ Tipos

export interface Booking {
  id: string;
  starts_at: string;
  ends_at: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  notes: string | null;
  status: string;
  decided_at: string | null;
  services?: { name: string; price_eur: number | null } | null;
}

// ------------------------------------------------------------------ Calendário

const icsText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/** Ficheiro .ics com alarmes 1 dia e 2 horas antes — o telemóvel avisa sozinho. */
export function buildIcs(b: Booking, method: "PUBLISH" | "CANCEL" = "PUBLISH") {
  const service = b.services?.name ?? "Marcação";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Marcacoes//PT",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${b.id}@marcacoes`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(new Date(b.starts_at))}`,
    `DTEND:${icsStamp(new Date(b.ends_at))}`,
    `SUMMARY:${icsText(`${service} — ${cfg.businessName}`)}`,
    cfg.businessAddress ? `LOCATION:${icsText(cfg.businessAddress)}` : "",
    `DESCRIPTION:${icsText(
      `Marcação confirmada em ${cfg.businessName}.` +
        (cfg.businessPhone ? `\nContacto: ${cfg.businessPhone}` : ""),
    )}`,
    method === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D",
    `DESCRIPTION:${icsText(`Amanhã: ${service}`)}`, "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT2H",
    `DESCRIPTION:${icsText(`Daqui a 2 horas: ${service}`)}`, "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n") + "\r\n";
}

export function googleCalendarLink(b: Booking) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `${b.services?.name ?? "Marcação"} — ${cfg.businessName}`,
    dates: `${icsStamp(new Date(b.starts_at))}/${icsStamp(new Date(b.ends_at))}`,
    details: `Marcação confirmada em ${cfg.businessName}.`,
    location: cfg.businessAddress,
  });
  // a barra entre as datas fica sem codificação, como o Google espera
  return `https://calendar.google.com/calendar/render?${p}`.replace("%2F", "/");
}

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

// ------------------------------------------------------------------ Email (Brevo)

export async function sendEmail(opts: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  ics?: string;
}) {
  if (!cfg.brevoKey || !cfg.senderEmail) {
    throw new Error("Falta configurar BREVO_API_KEY e/ou SENDER_EMAIL");
  }
  const body: Record<string, unknown> = {
    sender: { name: cfg.senderName, email: cfg.senderEmail },
    to: [{ email: opts.to, name: opts.toName || opts.to }],
    subject: opts.subject,
    htmlContent: opts.html,
  };
  if (cfg.ownerEmail) body.replyTo = { email: cfg.ownerEmail, name: cfg.businessName };
  if (opts.ics) body.attachment = [{ name: "marcacao.ics", content: toBase64(opts.ics) }];

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": cfg.brevoKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

// ------------------------------------------------------------------ Modelos de email

function layout(title: string, inner: string) {
  const footer = [cfg.businessAddress, cfg.businessPhone].filter(Boolean)
    .map(esc).join(" · ");
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="height:6px;line-height:6px;font-size:0;background:#c8141c;background-image:repeating-linear-gradient(-45deg,#c8141c 0 12px,#ffffff 12px 18px,#102868 18px 30px,#ffffff 30px 36px)">&nbsp;</td></tr>
<tr><td align="center" style="padding:24px 28px 4px">${cfg.siteUrl
  ? `<img src="${esc(cfg.siteUrl)}/assets/logo.png" width="110" height="110" alt="${esc(cfg.businessName)}" style="display:block;border:0">`
  : `<span style="font-size:22px;font-weight:700;color:#000">${esc(cfg.businessName)}</span>`}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#000">${esc(title)}</h1>
${inner}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e4e4e4;font-size:12px;color:#6b6b6b">${footer || esc(cfg.businessName)}</td></tr>
</table></td></tr></table></body></html>`;
}

function details(b: Booking) {
  const s = new Date(b.starts_at);
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 0;color:#6b6b6b;width:90px">${k}</td><td style="padding:6px 0;font-weight:600">${v}</td></tr>`;
  const price = b.services?.price_eur != null
    ? `${Number.isInteger(Number(b.services.price_eur)) ? Number(b.services.price_eur) : Number(b.services.price_eur).toFixed(2).replace(".", ",")} €` : "";
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 20px;font-size:15px">
${row("Serviço", esc(b.services?.name ?? ""))}
${row("Dia", esc(fmtDate(s)))}
${row("Hora", esc(fmtTime(s)))}
${price ? row("Preço", esc(price)) : ""}
${cfg.businessAddress ? row("Morada", esc(cfg.businessAddress)) : ""}
</table>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:14px">${esc(label)}</a>`;

const p = (t: string) => `<p style="margin:0 0 14px;line-height:1.55;font-size:15px">${t}</p>`;

const contactLine = () =>
  cfg.businessPhone
    ? `Se precisares de alterar ou cancelar, responde a este email ou liga para ${esc(cfg.businessPhone)}.`
    : "Se precisares de alterar ou cancelar, basta responder a este email.";

const first = (name: string) => esc(name.trim().split(/\s+/)[0]);

export const emails = {
  requestReceived: (b: Booking) => ({
    subject: `Recebemos o teu pedido — ${cfg.businessName}`,
    html: layout("Pedido recebido", p(`Olá ${first(b.customer_name)},`) +
      p("Recebemos o teu pedido de marcação. Ainda <b>não está confirmado</b>: vais receber outro email assim que for aprovado.") +
      details(b) + p(contactLine())),
  }),

  newRequestForOwner: (b: Booking) => ({
    subject: `Nova marcação para aprovar: ${fmtDate(new Date(b.starts_at))} às ${fmtTime(new Date(b.starts_at))}`,
    html: layout("Nova marcação por aprovar",
      p(`<b>${esc(b.customer_name)}</b> · ${esc(b.customer_phone)} · ${esc(b.customer_email)}`) +
      details(b) +
      (b.notes ? p(`<i>Nota do cliente:</i> ${esc(b.notes)}`) : "") +
      (cfg.siteUrl ? button(`${cfg.siteUrl}/admin.html`, "Abrir agenda para aprovar") : "")),
  }),

  confirmed: (b: Booking) => ({
    subject: `Marcação confirmada — ${fmtDate(new Date(b.starts_at))} às ${fmtTime(new Date(b.starts_at))}`,
    html: layout("Está confirmado",
      p(`Olá ${first(b.customer_name)}, a tua marcação está confirmada.`) +
      details(b) +
      `<div style="margin:0 0 18px">${button(googleCalendarLink(b), "Adicionar ao Google Calendar")}</div>` +
      p("Em anexo segue também um ficheiro de calendário (<b>marcacao.ics</b>): abre-o no telemóvel para guardar a marcação com alertas automáticos.") +
      p("Vais receber um lembrete por email no dia anterior.") + p(contactLine())),
  }),

  rejected: (b: Booking, message?: string) => ({
    subject: `Não foi possível confirmar a tua marcação — ${cfg.businessName}`,
    html: layout("Marcação não disponível",
      p(`Olá ${first(b.customer_name)}, infelizmente não conseguimos aceitar este pedido:`) +
      details(b) +
      (message ? p(`<i>${esc(message)}</i>`) : "") +
      p("Pedimos desculpa pelo incómodo. Podes escolher outro horário:") +
      (cfg.siteUrl ? button(cfg.siteUrl, "Escolher outro horário") : "")),
  }),

  cancelled: (b: Booking, message?: string) => ({
    subject: `Marcação cancelada — ${cfg.businessName}`,
    html: layout("Marcação cancelada",
      p(`Olá ${first(b.customer_name)}, a seguinte marcação foi cancelada:`) +
      details(b) +
      (message ? p(`<i>${esc(message)}</i>`) : "") +
      (cfg.siteUrl ? button(cfg.siteUrl, "Fazer nova marcação") : "")),
  }),

  scheduleReminder: (monthName: string) => ({
    subject: `Falta definir o horário de ${monthName}`,
    html: layout(`Horário de ${monthName}`,
      p(`Ainda não há nenhum dia aberto em <b>${esc(monthName)}</b>, por isso os clientes ainda não conseguem marcar para esse mês.`) +
      p("Abre a agenda e escolhe, dia a dia, se trabalhas de manhã, à tarde ou o dia todo.") +
      (cfg.siteUrl ? button(`${cfg.siteUrl}/admin.html#horario`, "Definir horário") : "")),
  }),

  reminder: (b: Booking) => ({
    subject: `Lembrete: ${b.services?.name ?? "marcação"} — ${fmtDate(new Date(b.starts_at))} às ${fmtTime(new Date(b.starts_at))}`,
    html: layout("Lembrete da tua marcação",
      p(`Olá ${first(b.customer_name)}, só para lembrar a tua marcação:`) +
      details(b) + p(contactLine())),
  }),
};

/** Carrega a marcação com o nome e preço do serviço. */
export async function loadBooking(db: ReturnType<typeof adminDb>, id: string) {
  const { data, error } = await db
    .from("bookings")
    .select("*, services(name, price_eur)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Booking;
}
