// Página de gestão (agenda da barbearia).
(function () {
  const A = window.App;
  const $ = (s) => document.querySelector(s);
  const show = (sel, on = true) => { $(sel).hidden = !on; };

  A.bindConfig();
  let demoData = null;

  // ------------------------------------------------------------ sessão
  async function start() {
    if (A.DEMO) {
      show("#demo-banner");
      demoData = makeDemo();
      return enterAgenda();
    }
    A.sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") { show("#login", false); show("#agenda", false); show("#newpass"); }
      if (event === "SIGNED_OUT") { show("#agenda", false); show("#logout", false); show("#login"); }
    });
    const { data } = await A.sb.auth.getSession();
    if (data.session && !location.hash.includes("type=recovery")) enterAgenda();
    else if (!location.hash.includes("type=recovery")) show("#login");
  }

  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    show("#login-error", false);
    const { error } = await A.sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
    if (error) {
      $("#login-error").textContent = "Email ou palavra-passe errados.";
      return show("#login-error");
    }
    enterAgenda();
  });

  $("#forgot").addEventListener("click", async () => {
    const email = new FormData($("#login")).get("email");
    if (!email) {
      $("#login-error").textContent = "Escreve primeiro o teu email e carrega outra vez.";
      return show("#login-error");
    }
    await A.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast("Se o email estiver registado, vais receber um link para mudar a palavra-passe.");
  });

  $("#newpass").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await A.sb.auth.updateUser({ password: new FormData(e.target).get("password") });
    if (error) return toast(error.message, true);
    history.replaceState(null, "", location.pathname);
    toast("Palavra-passe guardada.");
    show("#newpass", false);
    enterAgenda();
  });

  $("#logout").addEventListener("click", async () => {
    if (A.DEMO) return toast("No modo demonstração não há sessão.");
    await A.sb.auth.signOut();
  });

  async function enterAgenda() {
    show("#login", false);
    show("#logout");
    show("#agenda");
    await refresh();
  }

  // ------------------------------------------------------------ dados
  async function fetchAll() {
    if (A.DEMO) return demoData;
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const [active, hist, off] = await Promise.all([
      A.sb.from("bookings").select("*, services(name)")
        .in("status", ["pending", "confirmed"]).gte("starts_at", since).order("starts_at"),
      A.sb.from("bookings").select("*, services(name)")
        .or(`starts_at.lt.${since},status.in.(rejected,cancelled)`)
        .order("starts_at", { ascending: false }).limit(50),
      A.sb.from("time_off").select("*").gte("ends_at", new Date().toISOString()).order("starts_at"),
    ]);
    for (const r of [active, hist, off]) if (r.error) throw r.error;
    return { active: active.data, history: hist.data, timeOff: off.data };
  }

  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const d = await fetchAll();
      render(d);
    } catch (err) {
      console.error(err);
      if (String(err.message || "").match(/JWT|token/i)) return A.sb.auth.signOut();
      toast("Não foi possível carregar a agenda. Verifica a ligação.", true);
    } finally {
      busy = false;
    }
  }
  setInterval(() => !$("#agenda").hidden && refresh(), 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && !$("#agenda").hidden && refresh());

  // ------------------------------------------------------------ desenhar
  function card(b, actions) {
    const s = new Date(b.starts_at), e = new Date(b.ends_at);
    const tel = b.customer_phone.replace(/\s/g, "");
    const wa = tel.replace(/^\+/, "").replace(/^(9\d{8})$/, "351$1");
    return `<article class="bk${b.status === "pending" ? " bk-pending" : ""}" data-id="${b.id}">
      <div class="bk-time">${A.time(s)}<small>até ${A.time(e)}</small></div>
      <div>
        <div class="bk-who">${A.esc(b.customer_name)}</div>
        <div class="bk-svc">${A.esc(b.services?.name ?? "")}${actions === "history" ? ` <span class="tag tag-${b.status}">${label(b.status)}</span>` : ""}</div>
        <div class="bk-contact">
          <a href="tel:${A.esc(tel)}">${A.esc(b.customer_phone)}</a>
          <a href="https://wa.me/${A.esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
          <a href="mailto:${A.esc(b.customer_email)}">${A.esc(b.customer_email)}</a>
        </div>
      </div>
      <div class="bk-actions">${
        actions === "pending"
          ? `<button class="btn-ok" data-act="confirm">Confirmar</button><button class="btn-no" data-act="reject">Recusar</button>`
          : actions === "upcoming" ? `<button class="btn-no" data-act="cancel">Cancelar</button>` : ""
      }</div>
      ${b.notes ? `<p class="bk-note">${A.esc(b.notes)}</p>` : ""}
    </article>`;
  }
  const label = (s) => ({ pending: "Por aprovar", confirmed: "Confirmada", rejected: "Recusada", cancelled: "Cancelada" })[s] || s;

  function groupByDay(list, mode) {
    let html = "", last = "";
    for (const b of list) {
      const k = A.dayKey(b.starts_at);
      if (k !== last) {
        const today = A.todayKey(), tomorrow = A.addDays(today, 1);
        const name = k === today ? "Hoje" : k === tomorrow ? "Amanhã" : A.longDate(b.starts_at);
        html += `<h3 class="day-heading">${name}${k === today || k === tomorrow ? ", " + A.longDate(b.starts_at).split(",").slice(1).join(",").trim() : ""}</h3>`;
        last = k;
      }
      html += card(b, mode);
    }
    return html;
  }

  function render(d) {
    const pending = d.active.filter((b) => b.status === "pending");
    const upcoming = d.active.filter((b) => b.status === "confirmed");

    $("#n-pending").textContent = pending.length;
    $("#n-pending").dataset.n = pending.length;
    document.title = (pending.length ? `(${pending.length}) ` : "") + "Agenda · " + (A.C.BUSINESS_NAME || "");

    $("#pending").innerHTML = pending.length ? groupByDay(pending, "pending")
      : `<p class="empty">Nenhum pedido à espera. Quando um cliente pedir marcação, aparece aqui e recebes um email.</p>`;
    $("#upcoming").innerHTML = upcoming.length ? groupByDay(upcoming, "upcoming")
      : `<p class="empty">Ainda não há marcações confirmadas.</p>`;
    $("#history").innerHTML = d.history.length ? d.history.map((b) =>
      `<h3 class="day-heading">${A.longDate(b.starts_at)}</h3>` + card(b, "history")).join("")
      : `<p class="empty">Sem histórico.</p>`;

    $("#timeoff").innerHTML = d.timeOff.map((t) => `
      <li data-id="${t.id}">
        <span><b>${cap(describeRange(t.starts_at, t.ends_at))}</b>${t.reason ? ` <span class="muted">(${A.esc(t.reason)})</span>` : ""}</span>
        <button class="linkish" data-del-off="${t.id}">Remover</button>
      </li>`).join("");
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function describeRange(a, b) {
    const s = new Date(a), e = new Date(b);
    const wholeDays = A.time(s) === "00:00" && A.time(e) === "00:00";
    if (wholeDays) {
      const lastDay = new Date(e.getTime() - 1);
      return A.dayKey(s) === A.dayKey(lastDay) ? A.longDate(s) : `${A.longDate(s)} a ${A.longDate(lastDay)}`;
    }
    return A.dayKey(s) === A.dayKey(e)
      ? `${A.longDate(s)}, ${A.time(s)} às ${A.time(e)}`
      : `${A.longDate(s)} ${A.time(s)} a ${A.longDate(e)} ${A.time(e)}`;
  }

  // ------------------------------------------------------------ ações nas marcações
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const act = btn.dataset.act;

    let message = "";
    if (act === "reject") {
      const m = prompt("Recusar este pedido. Queres deixar uma mensagem ao cliente? (opcional)\nEx.: Nesse dia já estou cheia, experimenta sábado.", "");
      if (m === null) return;
      message = m;
    }
    if (act === "cancel") {
      const m = prompt("Cancelar esta marcação confirmada? O cliente recebe um email.\nMensagem opcional:", "");
      if (m === null) return;
      message = m;
    }

    const buttons = btn.parentElement.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      if (A.DEMO) {
        const b = demoData.active.find((x) => x.id === id);
        b.status = { confirm: "confirmed", reject: "rejected", cancel: "cancelled" }[act];
        if (b.status !== "confirmed") {
          demoData.active = demoData.active.filter((x) => x.id !== id);
          demoData.history.unshift(b);
        }
        toast({ confirm: "Confirmada. (Na versão real o cliente recebe email.)", reject: "Recusada.", cancel: "Cancelada." }[act]);
        return render(demoData);
      }
      const { data, error } = await A.sb.functions.invoke("manage-booking", { body: { id, action: act, message } });
      if (error) {
        toast(await A.fnError(error), true);
      } else {
        const done = { confirm: "Confirmada", reject: "Recusada", cancel: "Cancelada" }[act];
        toast(data.emailSent ? `${done}. O cliente foi avisado por email.` : `${done}, mas o email ao cliente falhou. Avisa-o por telefone.`, !data.emailSent);
      }
      await refresh();
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });

  // ------------------------------------------------------------ folgas
  $("#timeoff-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const fromDay = f.get("from_day"), toDay = f.get("to_day") || fromDay;
    const starts = A.lisbonInstant(fromDay, f.get("from_time") || "00:00");
    const ends = f.get("to_time") ? A.lisbonInstant(toDay, f.get("to_time")) : A.lisbonInstant(A.addDays(toDay, 1), "00:00");
    if (ends <= starts) return toast("O fim tem de ser depois do início.", true);

    const row = { starts_at: starts.toISOString(), ends_at: ends.toISOString(), reason: f.get("reason") || null };
    if (A.DEMO) {
      demoData.timeOff.push({ id: Date.now(), ...row });
    } else {
      const { error } = await A.sb.from("time_off").insert(row);
      if (error) return toast("Não foi possível guardar.", true);
    }
    e.target.reset();

    const d = A.DEMO ? demoData : await fetchAll();
    const clash = d.active.filter((b) => new Date(b.starts_at) < ends && new Date(b.ends_at) > starts);
    toast(clash.length
      ? `Bloqueado. Atenção: há ${clash.length} marcação(ões) nesse período que continuam ativas. Cancela-as se for preciso.`
      : "Bloqueado. Os clientes já não veem essas horas.", clash.length > 0);
    render(d);
  });

  // datas por defeito no formulário de folgas
  $("#timeoff-form [name=from_day]").addEventListener("change", (e) => {
    const to = $("#timeoff-form [name=to_day]");
    if (!to.value || to.value < e.target.value) to.value = e.target.value;
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del-off]");
    if (!btn || !confirm("Remover este bloqueio? As horas voltam a ficar disponíveis.")) return;
    const id = btn.dataset.delOff;
    if (A.DEMO) {
      demoData.timeOff = demoData.timeOff.filter((t) => String(t.id) !== id);
      return render(demoData);
    }
    const { error } = await A.sb.from("time_off").delete().eq("id", id);
    if (error) return toast("Não foi possível remover.", true);
    refresh();
  });

  // ------------------------------------------------------------ toast
  let toastTimer;
  function toast(msg, isError = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " toast-error" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), isError ? 7000 : 4000);
  }

  // ------------------------------------------------------------ demo
  function makeDemo() {
    const today = A.todayKey();
    const at = (dayOffset, hhmm, mins) => {
      let k = A.addDays(today, dayOffset);
      const s = A.lisbonInstant(k, hhmm);
      return { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + mins * 60000).toISOString() };
    };
    const mk = (i, status, d, h, svc, mins, name, extra = {}) => ({
      id: "demo-" + i, status, ...at(d, h, mins), services: { name: svc },
      customer_name: name, customer_phone: "91" + (2345670 + i), customer_email: name.split(" ")[0].toLowerCase() + "@exemplo.pt",
      notes: null, ...extra,
    });
    return {
      active: [
        mk(1, "pending", 1, "10:00", "Corte de cabelo", 45, "Tiago Martins", { notes: "Pode ser um pouco mais curto dos lados." }),
        mk(2, "pending", 3, "14:00", "Corte de cabelo", 45, "Ricardo Sousa"),
        mk(3, "confirmed", 1, "11:00", "Corte de cabelo", 45, "Miguel Ferreira"),
        mk(4, "confirmed", 1, "15:00", "Corte de cabelo", 45, "Pedro Almeida"),
        mk(5, "confirmed", 2, "11:00", "Corte de cabelo", 45, "Leonor Costa", { notes: "É a primeira vez, queria um degradê." }),
      ].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      history: [
        mk(6, "confirmed", -1, "14:45", "Corte de cabelo", 45, "André Lopes"),
        mk(7, "rejected", 2, "10:45", "Corte de cabelo", 45, "Bruno Dias"),
      ],
      timeOff: [{ id: 1, ...(() => { const s = A.lisbonInstant(A.addDays(today, 14), "00:00"); return { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 86400e3).toISOString() }; })(), reason: "Feriado" }],
    };
  }

  start();
})();
