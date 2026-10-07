// Página pública de marcações.
(function () {
  const A = window.App;
  const $ = (s) => document.querySelector(s);
  const WEEKDAYS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

  const state = { services: [], hours: [], service: null, day: null, slot: null };

  A.bindConfig();
  if (A.DEMO) $("#demo-banner").hidden = false;

  // ------------------------------------------------------------ dados
  async function loadServices() {
    if (A.DEMO) return A.demo.services;
    const { data, error } = await A.sb.from("services")
      .select("id,name,description,duration_minutes,price_eur")
      .eq("active", true).order("sort_order");
    if (error) throw error;
    return data;
  }
  async function loadHours() {
    if (A.DEMO) return A.demo.hours;
    const { data, error } = await A.sb.from("business_hours")
      .select("weekday,open_time,close_time").order("weekday").order("open_time");
    if (error) throw error;
    return data;
  }
  async function loadSlots(day, serviceId) {
    if (A.DEMO) return demoSlots(day);
    const { data, error } = await A.sb.rpc("available_slots", { p_day: day, p_service_id: serviceId });
    if (error) throw error;
    return data.map((r) => r.slot_start);
  }
  function demoSlots(day) {
    const dur = state.service.duration_minutes;
    const out = [];
    const minStart = Date.now() + 2 * 3600e3;
    state.hours.filter((h) => h.weekday === A.isoWeekday(day)).forEach((h) => {
      const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
      for (let m = toMin(h.open_time); m + dur <= toMin(h.close_time); m += dur) {
        const hhmm = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
        const inst = A.lisbonInstant(day, hhmm);
        // finge que algumas horas já estão ocupadas
        const busy = (m * 7 + Number(day.slice(-2)) * 13) % 5 === 0;
        if (inst.getTime() >= minStart && !busy) out.push(inst.toISOString());
      }
    });
    return new Promise((r) => setTimeout(() => r(out), 250));
  }

  // ------------------------------------------------------------ horário (painel lateral)
  function renderHours() {
    const byDay = {};
    state.hours.forEach((h) => (byDay[h.weekday] ||= []).push(h.open_time.slice(0, 5) + "–" + h.close_time.slice(0, 5)));
    // agrupa dias seguidos com o mesmo horário: "Terça a sexta"
    const rows = [];
    for (let d = 1; d <= 7; d++) {
      const txt = byDay[d] ? byDay[d].join(", ") : "Fechado";
      const last = rows[rows.length - 1];
      if (last && last.txt === txt && last.to === d - 1) last.to = d;
      else rows.push({ from: d, to: d, txt });
    }
    $("#hours").innerHTML = rows.map((r) => {
      const label = r.from === r.to ? WEEKDAYS[r.from]
        : WEEKDAYS[r.from] + (r.to - r.from > 1 ? " a " : " e ") + WEEKDAYS[r.to].toLowerCase();
      return `<li${r.txt === "Fechado" ? ' class="closed"' : ""}><span>${label}</span><span>${A.esc(r.txt)}</span></li>`;
    }).join("");
  }

  // ------------------------------------------------------------ passo 1: serviço
  // Com um só serviço, este passo fica escondido e o serviço é escolhido sozinho.
  function renderServices() {
    const list = state.services;
    if (!list.length) {
      $("#lead").textContent = "De momento não há marcações disponíveis.";
      return;
    }
    if (list.length === 1) {
      const s = list[0];
      $("#lead").textContent = `${s.name}, ${A.euro(s.price_eur)}. Escolhe o dia e a hora.`;
      chooseService(s, false);
      return;
    }
    $("#lead").textContent = "Escolhe o serviço, o dia e a hora.";
    $("#step-service").hidden = false;
    $("#services").innerHTML = list.map((s) => `
      <label class="choice">
        <input type="radio" name="service" value="${s.id}">
        <span class="choice-name">${A.esc(s.name)}<small>${s.duration_minutes} min</small></span>
        <span class="choice-price">${A.euro(s.price_eur)}</span>
      </label>`).join("");
  }

  $("#services").addEventListener("change", (e) => {
    chooseService(state.services.find((s) => String(s.id) === e.target.value), true);
  });

  function chooseService(s, scroll) {
    state.service = s;
    unlock("#step-day");
    renderDays();
    if (state.day) selectDay(state.day); // recalcula horas para a nova duração
    else if (scroll && window.matchMedia("(max-width: 900px)").matches) scrollToStep("#step-day");
    updateSummary();
  }

  // ------------------------------------------------------------ passo 2: dia
  function renderDays() {
    const openDays = new Set(state.hours.map((h) => h.weekday));
    const today = A.todayKey();
    const days = [];
    for (let i = 0; i < Math.min(A.C.DAYS_AHEAD || 28, 60); i++) days.push(A.addDays(today, i));

    let lastMonth = "";
    $("#days").innerHTML = days.map((key) => {
      const d = A.keyToDate(key);
      const open = openDays.has(A.isoWeekday(key));
      const wd = new Intl.DateTimeFormat("pt-PT", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
      const month = new Intl.DateTimeFormat("pt-PT", { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
      const showMonth = month !== lastMonth; lastMonth = month;
      const full = new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
      return `<li>
        <label class="day${open ? "" : " day-closed"}" title="${open ? full : full + " — fechado"}">
          <input type="radio" name="day" value="${key}" ${open ? "" : "disabled"} ${state.day === key ? "checked" : ""} aria-label="${full}${open ? "" : ", fechado"}">
          <span class="day-wd">${key === today ? "hoje" : wd}</span>
          <span class="day-n">${d.getUTCDate()}</span>
          <span class="day-m">${showMonth ? month : "&nbsp;"}</span>
        </label></li>`;
    }).join("");
  }

  $("#days").addEventListener("change", (e) => selectDay(e.target.value));

  document.querySelectorAll(".strip-nav").forEach((b) =>
    b.addEventListener("click", () => {
      const strip = $("#days");
      strip.scrollBy({ left: Number(b.dataset.dir) * strip.clientWidth * 0.8, behavior: "smooth" });
    }));

  let slotReq = 0;
  async function selectDay(key) {
    state.day = key;
    state.slot = null;
    lock("#step-details");
    unlock("#step-time");
    updateSummary();
    const box = $("#times");
    box.innerHTML = `<p class="muted">A ver horas livres…</p>`;
    const req = ++slotReq;
    try {
      const slots = await loadSlots(key, state.service.id);
      if (req !== slotReq) return; // o cliente já mudou de dia
      if (!slots.length) {
        box.innerHTML = `<p class="muted">Não há horas livres neste dia para este serviço. Experimenta outro dia.</p>`;
        return;
      }
      const morning = slots.filter((s) => +A.time(s).slice(0, 2) < 13);
      const afternoon = slots.filter((s) => +A.time(s).slice(0, 2) >= 13);
      const group = (title, list) => list.length ? `
        <div class="time-group"><h3>${title}</h3><div class="time-grid">
        ${list.map((s) => `<label class="slot"><input type="radio" name="slot" value="${s}"><span>${A.time(s)}</span></label>`).join("")}
        </div></div>` : "";
      box.innerHTML = group("Manhã", morning) + group("Tarde", afternoon);
      if (window.matchMedia("(max-width: 900px)").matches) scrollToStep("#step-time");
    } catch (err) {
      console.error(err);
      if (req === slotReq) box.innerHTML = `<p class="form-error">Não foi possível carregar as horas. Atualiza a página e tenta outra vez.</p>`;
    }
  }

  // ------------------------------------------------------------ passo 3: hora
  $("#times").addEventListener("change", (e) => {
    state.slot = e.target.value;
    unlock("#step-details");
    updateSummary();
    scrollToStep("#step-details");
  });

  // ------------------------------------------------------------ resumo + envio
  function updateSummary() {
    const s = state.service;
    if (!s || !state.slot) { $("#summary").innerHTML = ""; return; }
    $("#summary").innerHTML = `
      <span class="sum-what">${A.esc(s.name)}</span>
      <span class="sum-when">${A.longDate(state.slot)}, às ${A.time(state.slot)}</span>
      <span class="sum-price">${A.euro(s.price_eur)}</span>`;
  }

  const form = $("#booking-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#form-error");
    err.hidden = true;
    const f = new FormData(form);
    const payload = {
      service_id: state.service?.id,
      starts_at: state.slot,
      name: (f.get("name") || "").trim(),
      email: (f.get("email") || "").trim(),
      phone: (f.get("phone") || "").trim(),
      notes: (f.get("notes") || "").trim(),
      website: f.get("website") || "",
    };

    const problem =
      !payload.service_id ? "Escolhe um serviço." :
      !payload.starts_at ? "Escolhe o dia e a hora." :
      payload.name.length < 2 ? "Indica o teu nome." :
      !/^[+\d][\d\s-]{5,24}$/.test(payload.phone) ? "Indica um número de telemóvel válido." :
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email) ? "Indica um email válido para receberes a confirmação." : "";
    if (problem) return showError(problem);

    const btn = $("#submit");
    btn.disabled = true;
    btn.textContent = "A enviar…";
    try {
      if (A.DEMO) {
        await new Promise((r) => setTimeout(r, 600));
      } else {
        const { error } = await A.sb.functions.invoke("book", { body: payload });
        if (error) {
          const msg = await A.fnError(error);
          if (error.context?.status === 409) selectDay(state.day); // horário ocupado: atualiza horas
          return showError(msg);
        }
      }
      showDone(payload);
    } catch (e2) {
      console.error(e2);
      showError("Não foi possível enviar. Verifica a ligação à internet e tenta outra vez.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Pedir marcação";
    }
  });

  function showError(msg) {
    const err = $("#form-error");
    err.textContent = msg;
    err.hidden = false;
  }

  function showDone(p) {
    form.hidden = true;
    const done = $("#done");
    $("#done-text").innerHTML =
      `Pediste <b>${A.esc(state.service.name)}</b> para <b>${A.longDate(state.slot)}, às ${A.time(state.slot)}</b>. ` +
      `Quando for aprovado, recebes a confirmação em <b>${A.esc(p.email)}</b>.`;
    done.hidden = false;
    done.focus();
    window.scrollTo({ top: done.offsetTop - 20, behavior: "smooth" });
  }

  $("#again").addEventListener("click", () => {
    form.reset();
    Object.assign(state, { service: null, day: null, slot: null });
    ["#step-day", "#step-time", "#step-details"].forEach(lock);
    $("#times").innerHTML = "";
    if (state.services.length === 1) chooseService(state.services[0], false);
    updateSummary();
    $("#done").hidden = true;
    form.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ------------------------------------------------------------ utilitários
  function unlock(sel) { $(sel).removeAttribute("data-locked"); }
  function lock(sel) { $(sel).setAttribute("data-locked", ""); }
  function scrollToStep(sel) {
    const el = $(sel);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }), 60);
  }

  // ------------------------------------------------------------ arranque
  (async function init() {
    try {
      [state.services, state.hours] = await Promise.all([loadServices(), loadHours()]);
      renderServices();
      renderHours();
    } catch (err) {
      console.error(err);
      $("#lead").innerHTML = `<span class="form-error">Não foi possível carregar a página. Atualiza e tenta outra vez.</span>`;
      $("#hours").innerHTML = "";
    }
  })();
})();
