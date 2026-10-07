// Página pública de marcações.
(function () {
  const A = window.App;
  const $ = (s) => document.querySelector(s);

  const state = { services: [], periods: [], open: new Map(), service: null, day: null, slot: null };
  const MAX_DAYS = 75;                              // igual ao limite na base de dados

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
  async function loadPeriods() {
    if (A.DEMO) return A.demo.periods;
    const { data, error } = await A.sb.from("periods").select("key,label,start_time,end_time").order("start_time");
    if (error) throw error;
    return data;
  }
  /** Dias abertos (definidos pela dona no calendário da agenda). */
  async function loadOpenDays() {
    const from = A.todayKey(), to = A.addDays(from, MAX_DAYS);
    let rows;
    if (A.DEMO) {
      rows = [];
      for (let i = 0; i < 40; i++) {
        const day = A.addDays(from, i);
        if (i % 7 === 3) continue;                              // finge folgas
        if (i % 5 !== 2) rows.push({ day, period: "manha" });
        if (i % 4 !== 1) rows.push({ day, period: "tarde" });
      }
    } else {
      const { data, error } = await A.sb.from("availability").select("day,period").gte("day", from).lte("day", to);
      if (error) throw error;
      rows = data;
    }
    const map = new Map();
    rows.forEach((r) => (map.get(r.day) || map.set(r.day, []).get(r.day)).push(r.period));
    return map;
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
    const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    state.periods.filter((p) => (state.open.get(day) || []).includes(p.key)).forEach((p) => {
      for (let m = toMin(p.start_time); m + dur <= toMin(p.end_time); m += dur) {
        const hhmm = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
        const inst = A.lisbonInstant(day, hhmm);
        const busy = (m * 7 + Number(day.slice(-2)) * 13) % 5 === 0;   // finge horas ocupadas
        if (inst.getTime() >= minStart && !busy) out.push(inst.toISOString());
      }
    });
    return new Promise((r) => setTimeout(() => r(out), 250));
  }

  // ------------------------------------------------------------ horário (rodapé)
  function renderHours() {
    $("#hours").innerHTML = state.periods.map((p) =>
      `<li><span>${A.esc(p.label)}</span><span>${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}</span></li>`).join("") +
      `<li><span>Dias</span><span>Os dias abertos aparecem acima</span></li>`;
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
    const today = A.todayKey();
    const openKeys = [...state.open.keys()].sort();
    if (!openKeys.length) {
      $("#days").innerHTML = `<li class="muted no-days">De momento não há dias disponíveis. Volta a espreitar em breve.</li>`;
      return;
    }
    // mostra de hoje até ao último dia aberto (pelo menos 2 semanas)
    const end = openKeys[openKeys.length - 1] > A.addDays(today, 13) ? openKeys[openKeys.length - 1] : A.addDays(today, 13);
    const days = [];
    for (let k = today; k <= end && days.length <= MAX_DAYS; k = A.addDays(k, 1)) days.push(k);

    let lastMonth = "";
    $("#days").innerHTML = days.map((key) => {
      const d = A.keyToDate(key);
      const ps = state.open.get(key) || [];
      const open = ps.length > 0;
      const wd = new Intl.DateTimeFormat("pt-PT", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
      const month = new Intl.DateTimeFormat("pt-PT", { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
      const showMonth = month !== lastMonth; lastMonth = month;
      const full = new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
      const part = ps.length === 1 ? (ps[0] === "manha" ? "manhã" : "tarde") : "";
      return `<li>
        <label class="day${open ? "" : " day-closed"}" title="${open ? full : full + ": fechado"}">
          <input type="radio" name="day" value="${key}" ${open ? "" : "disabled"} ${state.day === key ? "checked" : ""} aria-label="${full}${open ? (part ? ", só " + part : "") : ", fechado"}">
          <span class="day-wd">${key === today ? "hoje" : wd}</span>
          <span class="day-n">${d.getUTCDate()}</span>
          <span class="day-m">${part || (showMonth ? month : "&nbsp;")}</span>
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
      [state.services, state.periods, state.open] = await Promise.all([loadServices(), loadPeriods(), loadOpenDays()]);
      renderServices();
      renderHours();
    } catch (err) {
      console.error(err);
      $("#lead").innerHTML = `<span class="form-error">Não foi possível carregar a página. Atualiza e tenta outra vez.</span>`;
      $("#hours").innerHTML = "";
    }
  })();
})();
