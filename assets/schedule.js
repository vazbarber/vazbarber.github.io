// Calendário de horário da agenda: a dona escolhe, dia a dia, se abre
// o dia todo, só de manhã, só à tarde ou se fecha.
(function () {
  const A = window.App;
  const $ = (s) => document.querySelector(s);
  const MONTHS_AHEAD = 2;                       // pode definir até 2 meses à frente
  const CYCLE = ["none", "both", "manha", "tarde"];
  const LABEL = { none: "Fechado", both: "Dia todo", manha: "Manhã", tarde: "Tarde" };
  const toSet = (st) => st === "both" ? ["manha", "tarde"] : st === "none" ? [] : [st];
  const toState = (set) => set.length === 2 ? "both" : set[0] || "none";

  let started = false;
  let viewMonth;                                // "AAAA-MM"
  let avail = new Map();                        // "AAAA-MM-DD" -> Set("manha","tarde")
  let periods = [];

  // ------------------------------------------------------------ dados
  const demo = { avail: new Map(), periods: [
    { key: "manha", label: "Manhã", start_time: "10:00:00", end_time: "12:00:00" },
    { key: "tarde", label: "Tarde", start_time: "14:00:00", end_time: "16:00:00" },
  ] };

  const store = A.DEMO ? {
    periods: async () => demo.periods,
    avail: async (from, to) => [...demo.avail].filter(([d]) => d >= from && d <= to)
      .flatMap(([day, set]) => [...set].map((period) => ({ day, period }))),
    add: async (rows) => rows.forEach((r) => (demo.avail.get(r.day) || demo.avail.set(r.day, new Set()).get(r.day)).add(r.period)),
    remove: async (day, ps) => ps.forEach((p) => demo.avail.get(day)?.delete(p)),
    removeRange: async (from, to) => [...demo.avail.keys()].forEach((d) => d >= from && d <= to && demo.avail.delete(d)),
    savePeriod: async (key, start, end) => Object.assign(demo.periods.find((p) => p.key === key), { start_time: start, end_time: end }),
  } : {
    periods: async () => {
      const { data, error } = await A.sb.from("periods").select("*").order("start_time");
      if (error) throw error;
      return data;
    },
    avail: async (from, to) => {
      const { data, error } = await A.sb.from("availability").select("day, period").gte("day", from).lte("day", to);
      if (error) throw error;
      return data;
    },
    add: async (rows) => {
      if (!rows.length) return;
      const { error } = await A.sb.from("availability").upsert(rows, { onConflict: "day,period", ignoreDuplicates: true });
      if (error) throw error;
    },
    remove: async (day, ps) => {
      if (!ps.length) return;
      const { error } = await A.sb.from("availability").delete().eq("day", day).in("period", ps);
      if (error) throw error;
    },
    removeRange: async (from, to) => {
      const { error } = await A.sb.from("availability").delete().gte("day", from).lte("day", to);
      if (error) throw error;
    },
    savePeriod: async (key, start, end) => {
      const { error } = await A.sb.from("periods").update({ start_time: start, end_time: end }).eq("key", key);
      if (error) throw error;
    },
  };

  // ------------------------------------------------------------ datas
  const today = () => A.todayKey();
  const monthOf = (key) => key.slice(0, 7);
  function addMonths(month, n) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }
  const lastDay = (month) => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  };
  const monthName = (month, withYear = true) => new Intl.DateTimeFormat("pt-PT",
    { month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })
    .format(new Date(month + "-15T12:00:00Z"));
  const minMonth = () => monthOf(today());
  const maxMonth = () => addMonths(minMonth(), MONTHS_AHEAD);
  const hhmm = (t) => t.slice(0, 5);

  // marcações ativas que caem num dia (e opcionalmente num turno)
  function bookingsOn(day, periodKeys) {
    const list = (window.Agenda?.activeBookings() || []).filter((b) => A.dayKey(b.starts_at) === day);
    if (!periodKeys) return list;
    return list.filter((b) => {
      const t = A.time(b.starts_at);
      return periodKeys.some((k) => {
        const p = periods.find((x) => x.key === k);
        return p && t >= hhmm(p.start_time) && t < hhmm(p.end_time);
      });
    });
  }

  // ------------------------------------------------------------ carregar
  async function load(month) {
    viewMonth = month;
    const from = month + "-01", to = lastDay(month);
    const rows = await store.avail(from, to);
    avail = new Map();
    rows.forEach((r) => (avail.get(r.day) || avail.set(r.day, new Set()).get(r.day)).add(r.period));
    render();
  }

  // ------------------------------------------------------------ desenhar
  function render() {
    $("#cal-title").textContent = monthName(viewMonth);
    $("#cal-prev").disabled = viewMonth <= minMonth();
    $("#cal-next").disabled = viewMonth >= maxMonth();

    const first = viewMonth + "-01";
    const offset = A.isoWeekday(first) - 1;          // segunda = 0
    const last = Number(lastDay(viewMonth).slice(-2));
    const t = today();
    let html = "<span></span>".repeat(offset);
    let open = 0;

    for (let d = 1; d <= last; d++) {
      const key = `${viewMonth}-${String(d).padStart(2, "0")}`;
      const st = toState([...(avail.get(key) || [])]);
      const past = key < t;
      if (st !== "none" && !past) open++;
      const has = bookingsOn(key).length;
      const full = A.longDate(key + "T12:00:00Z");
      html += `<button type="button" class="cal-day st-${st}${past ? " is-past" : ""}${key === t ? " is-today" : ""}"
        data-day="${key}" ${past ? "disabled" : ""}
        aria-label="${full}: ${LABEL[st]}${has ? `, ${has} marcação(ões)` : ""}">
        <span class="cal-n">${d}</span>
        <span class="cal-st">${st === "none" ? "" : LABEL[st]}</span>
        ${has ? `<span class="cal-dot" aria-hidden="true"></span>` : ""}
      </button>`;
    }
    $("#cal-days").innerHTML = html;
    $("#cal-summary").textContent = open
      ? `${open} ${open === 1 ? "dia aberto" : "dias abertos"} em ${monthName(viewMonth, false)}.`
      : `Nenhum dia aberto em ${monthName(viewMonth, false)}: os clientes ainda não podem marcar para este mês.`;
    renderBanner();
  }

  async function renderBanner() {
    const next = addMonths(minMonth(), 1);
    const dayOfMonth = Number(today().slice(-2));
    let show = false;
    if (dayOfMonth >= 15) {
      const rows = viewMonth === next ? [...avail.keys()] : await store.avail(next + "-01", lastDay(next));
      show = rows.length === 0;
    }
    const b = $("#schedule-banner");
    b.hidden = !show;
    if (show) $("#schedule-banner-text").textContent = `Ainda não definiste o horário de ${monthName(next, false)}.`;
  }

  // ------------------------------------------------------------ mudar um dia
  async function setDay(day, newState) {
    const before = new Set(avail.get(day) || []);
    const want = new Set(toSet(newState));
    const toAdd = [...want].filter((p) => !before.has(p));
    const toRemove = [...before].filter((p) => !want.has(p));

    const hit = bookingsOn(day, toRemove);
    if (hit.length && !confirm(`Há ${hit.length} marcação(ões) neste turno. Fechar na mesma? As marcações não são canceladas automaticamente: cancela-as em "Próximas marcações" se for preciso.`)) return;

    avail.set(day, want);                     // atualiza já no ecrã
    render();
    try {
      await store.add(toAdd.map((period) => ({ day, period })));
      await store.remove(day, toRemove);
    } catch (e) {
      console.error(e);
      avail.set(day, before);
      render();
      window.Agenda?.toast("Não foi possível guardar. Verifica a ligação.", true);
    }
  }

  async function setMonth(state) {
    const t = today();
    const from = (viewMonth === monthOf(t) ? t : viewMonth + "-01");
    const to = lastDay(viewMonth);
    if (state === "none") {
      const hits = (window.Agenda?.activeBookings() || []).filter((b) => { const k = A.dayKey(b.starts_at); return k >= from && k <= to; });
      const msg = hits.length
        ? `Fechar todos os dias de ${monthName(viewMonth, false)}? Há ${hits.length} marcação(ões) neste mês, que não são canceladas automaticamente.`
        : `Fechar todos os dias de ${monthName(viewMonth, false)}?`;
      if (!confirm(msg)) return;
    }
    try {
      if (state === "none") {
        await store.removeRange(from, to);
      } else {
        const rows = [];
        for (let k = from; k <= to; k = A.addDays(k, 1)) rows.push({ day: k, period: "manha" }, { day: k, period: "tarde" });
        await store.add(rows);
      }
      await load(viewMonth);
      window.Agenda?.toast(state === "none" ? "Mês fechado." : "Todos os dias abertos. Agora toca nos dias que queres mudar.");
    } catch (e) {
      console.error(e);
      window.Agenda?.toast("Não foi possível guardar. Verifica a ligação.", true);
    }
  }

  // ------------------------------------------------------------ turnos
  function renderPeriods() {
    $("#periods-form").innerHTML = periods.map((p) => `
      <fieldset class="period-row">
        <legend>${A.esc(p.label)}</legend>
        <label class="field"><span>Das</span><input type="time" name="${p.key}_start" value="${hhmm(p.start_time)}" required></label>
        <label class="field"><span>Às</span><input type="time" name="${p.key}_end" value="${hhmm(p.end_time)}" required></label>
      </fieldset>`).join("") +
      `<button class="btn-primary" type="submit">Guardar horas</button>`;
    $("#periods-desc").textContent = periods.map((p) => `${p.label} das ${hhmm(p.start_time)} às ${hhmm(p.end_time)}`).join("; ") + ".";
  }

  async function savePeriods(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const changes = periods.map((p) => ({ key: p.key, start: f.get(p.key + "_start"), end: f.get(p.key + "_end") }));
    if (changes.some((c) => !c.start || !c.end || c.end <= c.start))
      return window.Agenda?.toast("Em cada turno, a hora de fim tem de ser depois da de início.", true);
    try {
      for (const c of changes) await store.savePeriod(c.key, c.start, c.end);
      periods = await store.periods();
      renderPeriods();
      window.Agenda?.toast("Horas dos turnos guardadas.");
    } catch (err) {
      console.error(err);
      window.Agenda?.toast("Não foi possível guardar as horas.", true);
    }
  }

  // ------------------------------------------------------------ arranque
  async function init() {
    if (started) return render();
    started = true;

    $("#cal-days").addEventListener("click", (e) => {
      const btn = e.target.closest(".cal-day");
      if (!btn || btn.disabled) return;
      const day = btn.dataset.day;
      const st = toState([...(avail.get(day) || [])]);
      setDay(day, CYCLE[(CYCLE.indexOf(st) + 1) % CYCLE.length]);
    });
    $("#cal-prev").addEventListener("click", () => load(addMonths(viewMonth, -1)));
    $("#cal-next").addEventListener("click", () => load(addMonths(viewMonth, 1)));
    $("#cal-all").addEventListener("click", () => setMonth("both"));
    $("#cal-none").addEventListener("click", () => setMonth("none"));
    $("#periods-form").addEventListener("submit", savePeriods);
    $("#schedule-banner-btn").addEventListener("click", () => goToNextMonth());

    try {
      periods = await store.periods();
      renderPeriods();
      if (A.DEMO) seedDemo();
      await load(minMonth());
      if (location.hash === "#horario") goToNextMonth();
    } catch (e) {
      console.error(e);
      window.Agenda?.toast("Não foi possível carregar o horário.", true);
    }
  }

  async function goToNextMonth() {
    await load(addMonths(minMonth(), 1));
    $("#horario").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function seedDemo() {
    // resto deste mês aberto, com alguns dias só de manhã/tarde e folgas
    const t = today();
    for (let k = t, i = 0; k <= lastDay(monthOf(t)); k = A.addDays(k, 1), i++) {
      demo.avail.set(k, new Set(toSet(i % 7 === 5 ? "none" : i % 4 === 2 ? "manha" : i % 5 === 3 ? "tarde" : "both")));
    }
  }

  window.Schedule = { init };
})();
