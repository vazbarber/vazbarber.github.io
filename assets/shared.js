// Utilitários partilhados pelas duas páginas.
(function () {
  const C = window.APP_CONFIG || {};
  const TZ = "Europe/Lisbon";
  const DEMO = !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;

  const sb = DEMO ? null : window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

  // ---------- Datas (sempre na hora de Lisboa, venha o cliente de onde vier)
  const fmt = (opts) => new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, ...opts });
  const fTime = fmt({ hour: "2-digit", minute: "2-digit" });
  const fLong = fmt({ weekday: "long", day: "numeric", month: "long" });
  const fDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

  const time = (d) => fTime.format(new Date(d));
  const longDate = (d) => fLong.format(new Date(d));
  const dayKey = (d) => fDayKey.format(new Date(d));          // "2026-10-13"
  const todayKey = () => dayKey(new Date());

  /** Soma dias a "AAAA-MM-DD" sem problemas de fuso. */
  function addDays(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }
  /** 1 = segunda ... 7 = domingo */
  function isoWeekday(key) {
    const [y, m, d] = key.split("-").map(Number);
    return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
  }
  /** Data de calendário (meio-dia UTC) para mostrar nomes de dias/meses. */
  const keyToDate = (key) => new Date(key + "T12:00:00Z");

  /** Instante correspondente a "AAAA-MM-DD" + "HH:MM" em Lisboa. */
  function lisbonInstant(key, hhmm) {
    const guess = new Date(`${key}T${hhmm}:00Z`);
    const off = new Intl.DateTimeFormat("en", { timeZone: TZ, timeZoneName: "longOffset" })
      .formatToParts(guess).find((p) => p.type === "timeZoneName").value; // "GMT+01:00"
    const m = off.match(/([+-])(\d{2}):(\d{2})/);
    const mins = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
    return new Date(guess.getTime() - mins * 60000);
  }

  const euro = (v) => v == null ? "" :
    (Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2).replace(".", ",")) + " €";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /** Mensagem de erro legível a partir de supabase.functions.invoke */
  async function fnError(error) {
    try {
      const body = await error.context.json();
      if (body && body.error) return body.error;
    } catch (_) { /* sem corpo */ }
    return "Não foi possível ligar ao servidor. Tenta outra vez.";
  }

  // ---------- Preencher nome, morada, telefone... a partir do config
  function bindConfig() {
    const hide = (el) => ((el.closest(".info > div") || el).hidden = true);
    document.querySelectorAll("[data-bind]").forEach((el) => {
      const v = C[el.dataset.bind];
      if (v) el.textContent = v; else hide(el);
    });
    document.querySelectorAll("[data-bind-alt]").forEach((el) => {
      if (C[el.dataset.bindAlt]) el.alt = C[el.dataset.bindAlt];
    });
    document.querySelectorAll("[data-bind-phone]").forEach((a) => {
      if (!C.PHONE) {
        a.closest("p").hidden = true;
        if (!C.INSTAGRAM) hide(a);
        return;
      }
      a.textContent = C.PHONE;
      a.href = "tel:" + C.PHONE.replace(/\s/g, "");
    });
    document.querySelectorAll("[data-bind-insta]").forEach((a) => {
      if (!C.INSTAGRAM) return;
      a.textContent = "@" + C.INSTAGRAM;
      a.href = "https://instagram.com/" + encodeURIComponent(C.INSTAGRAM);
    });
    document.querySelectorAll("[data-show-if]").forEach((el) => {
      if (!C[el.dataset.showIf]) el.hidden = true;
    });
    if (C.BUSINESS_NAME) document.title = document.title + " · " + C.BUSINESS_NAME;
  }

  // ---------- Dados de demonstração
  const demo = {
    services: [
      { id: 1, name: "Corte de cabelo", description: null, duration_minutes: 45, price_eur: 10 },
    ],
    hours: [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [[d, "10:00", "12:00"], [d, "14:00", "16:00"]])
      .map(([weekday, open_time, close_time]) => ({ weekday, open_time, close_time })),
  };

  window.App = {
    C, TZ, DEMO, sb, demo,
    time, longDate, dayKey, todayKey, addDays, isoWeekday, keyToDate, lisbonInstant,
    euro, esc, fnError, bindConfig,
  };
})();
