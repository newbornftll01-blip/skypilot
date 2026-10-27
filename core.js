// Shared client: Supabase session guard, header, wallet chip, notifications bell, realtime.
window.Sky = (() => {
  const cfg = window.SKY_CONFIG || {};
  const ready = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = ready ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Every amount in the database is USD. Customers SEE their own currency: Nigeria -> NGN, Canada -> CAD, everyone else -> USD.
  const SYM = { USD: "US$", CAD: "CA$", NGN: "₦" };
  const cur = { code: "USD", rate: 1, approx: false };
  const usd = n => "$" + Number(n || 0).toFixed(2);
  const money = n => {
    const v = Number(n || 0) * cur.rate, d = cur.code === "NGN" ? 0 : 2;
    return SYM[cur.code] + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const CAD_ZONES = /^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Glace_Bay|Goose_Bay|Whitehorse|Iqaluit|Yellowknife|Montreal|Nipigon|Thunder_Bay|Rainy_River|Cambridge_Bay|Rankin_Inlet|Resolute|Inuvik|Dawson|Dawson_Creek|Fort_Nelson|Swift_Current|Blanc-Sablon|Atikokan|Creston|Pangnirtung)$/;
  const codeFor = cc => (cc === "NG" ? "NGN" : cc === "CA" ? "CAD" : "USD");
  async function getJson(u, ms = 4000) {
    const r = await fetch(u, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  async function initCurrency() {
    const KEY = "sky_cur_v1", TTL = 6 * 3600e3;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { /* ignore */ }
    if (saved && Date.now() - saved.t < TTL) { cur.code = saved.code; cur.rate = saved.rate; return; }

    let code = null;
    try { code = codeFor((await getJson("https://ipapi.co/json/")).country_code); } catch { /* try next */ }
    if (!code) { try { code = codeFor((await getJson("https://api.country.is/")).country); } catch { /* try timezone */ } }
    if (!code) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      code = tz === "Africa/Lagos" ? "NGN" : CAD_ZONES.test(tz) ? "CAD" : saved?.code || "USD";
    }
    let rate = null;
    if (code !== "USD") {
      try { const d = await getJson("https://open.er-api.com/v6/latest/USD", 6000); if (d.result === "success" && d.rates?.[code] > 0) rate = d.rates[code]; } catch { /* use fallback */ }
      if (!rate) { rate = saved?.code === code ? saved.rate : code === "NGN" ? 1500 : 1.38; cur.approx = true; }
    } else rate = 1;
    cur.code = code; cur.rate = rate;
    if (!cur.approx) localStorage.setItem(KEY, JSON.stringify({ code, rate, t: Date.now() }));
  }
  const when = d => new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const hooks = {};
  const on = (e, f) => (hooks[e] ||= []).push(f);
  const emit = (e, d) => (hooks[e] || []).forEach(f => f(d));
  const S = { ready, sb, cfg, $, esc, money, usd, cur, when, on, emit, session: null, profile: null, notes: [] };
  S.curNote = () => cur.code === "USD" ? "" : `Prices are shown in ${cur.code} at today's rate${cur.approx ? " (approximate)" : ""}. Your wallet and payments are in USD.`;

  function toast(msg, bad) {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.append(box); }
    const t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    t.textContent = msg;
    box.append(t);
    setTimeout(() => t.classList.add("out"), 4200);
    setTimeout(() => t.remove(), 4800);
  }

  function setupScreen() {
    document.body.innerHTML = `<div class="setup"><h1>✈ Almost there</h1>
      <p>Sky Pilot needs its database. Open <code>config.js</code>, paste your Supabase <b>Project URL</b> and <b>anon key</b>,
      and run <code>supabase/schema.sql</code> once. Full steps are in <code>README.md</code>.</p></div>`;
  }

  async function loadProfile() {
    const { data } = await sb.from("profiles").select("*").eq("id", S.session.user.id).single();
    S.profile = data;
    const chip = $("#walletChip");
    if (chip) chip.textContent = money(data?.balance);
    emit("profile", data);
  }

  async function loadNotes() {
    const uid = S.session.user.id;
    const { data } = await sb.from("notifications").select("*")
      .or(`user_id.is.null,user_id.eq.${uid}`).order("created_at", { ascending: false }).limit(25);
    S.notes = data || [];
    renderBell();
  }

  const seenKey = () => "sky_seen_" + S.session.user.id;
  function renderBell() {
    const seen = Number(localStorage.getItem(seenKey()) || 0);
    const unread = S.notes.filter(n => new Date(n.created_at).getTime() > seen).length;
    const badge = $("#bellCount");
    if (badge) { badge.textContent = unread; badge.hidden = !unread; }
    const list = $("#bellList");
    if (list) list.innerHTML = S.notes.length
      ? S.notes.map(n => `<div class="note"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${when(n.created_at)}</small></div>`).join("")
      : `<p class="empty">No notifications yet.</p>`;
  }

  function renderHeader() {
    const bar = $("#topbar");
    if (!bar) return;
    const page = location.pathname.split("/").pop() || "home.html";
    const link = (href, label) => `<a href="${href}"${page === href.split("#")[0] ? ' class="on"' : ""}>${label}</a>`;
    bar.className = "nav";
    bar.innerHTML = `
      <a class="logo" href="home.html">✈ Sky<b>Pilot</b></a>
      <nav>${link("home.html", "Home")}<a href="home.html#services">Services</a>${link("account.html", "Wallet &amp; Orders")}
        ${S.profile?.is_admin ? link("admin.html", "Admin") : ""}</nav>
      <div class="navr">
        <a class="chip" href="account.html#wallet" title="Wallet balance">💳 <span id="walletChip">${money(S.profile?.balance)}</span></a>
        <div class="bellwrap"><button class="iconbtn" id="bellBtn" aria-label="Notifications">🔔<span id="bellCount" class="badge" hidden>0</span></button>
          <div class="bellpanel" id="bellPanel" hidden><div id="bellList"></div></div></div>
        <button class="btn ghost small" id="logoutBtn" type="button">Log out</button>
      </div>`;
    $("#bellBtn").onclick = e => {
      e.stopPropagation();
      const p = $("#bellPanel");
      p.hidden = !p.hidden;
      if (!p.hidden) { localStorage.setItem(seenKey(), Date.now()); renderBell(); }
    };
    document.addEventListener("click", e => { if (!e.target.closest(".bellwrap")) $("#bellPanel").hidden = true; });
    $("#logoutBtn").onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };
    renderBell();
  }

  function subscribe() {
    const uid = S.session.user.id;
    sb.channel("sky-live-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${uid}` }, () => loadProfile())
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, p => emit("orders", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "topups" }, p => emit("topups", p))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, p => {
        const n = p.new;
        if (n.user_id && n.user_id !== uid) return;
        S.notes.unshift(n); renderBell(); toast("🔔 " + n.title);
      })
      .subscribe();
  }

  // Redirects to the sign-up page when logged out; to Home when a non-admin opens admin.
  S.boot = async ({ auth = true, admin = false } = {}) => {
    if (!ready) { setupScreen(); throw new Error("Sky Pilot is not configured"); }
    S.session = (await sb.auth.getSession()).data.session;
    if (!S.session) {
      if (auth) { location.replace("index.html"); throw new Error("redirecting"); }
      return null;
    }
    await initCurrency().catch(() => {});
    await loadProfile();
    if (admin && !S.profile?.is_admin) { location.replace("home.html"); throw new Error("redirecting"); }
    renderHeader();
    loadNotes();
    subscribe();
    sb.auth.onAuthStateChange((e, s) => {
      if (e === "SIGNED_OUT") location.replace("index.html");
      // another tab signed in as a different customer: never show one account's data under another
      else if (S.session && s?.user && s.user.id !== S.session.user.id) location.reload();
    });
    emit("ready", S.profile);
    if (!admin) {
      S.fulfil();
      setInterval(() => { if (!document.hidden) S.fulfil(); }, 45000);
    }
    return S.profile;
  };

  // Sends this customer's paid orders to delivery and pulls fresh tracking. Safe to call repeatedly.
  let busy = false;
  S.fulfil = async () => {
    if (busy || !S.session) return null;
    busy = true;
    try {
      const { data, error } = await sb.functions.invoke("fulfil", { body: {} });
      if (error || !data) return null;
      if (data.started || data.tracked) emit("orders", data);
      return data;
    } catch { return null; } finally { busy = false; }
  };

  S.toast = toast;
  S.rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    if (S.session && /^(place_order|request_topup|admin_)/.test(fn)) loadProfile();
    if (fn === "place_order") S.fulfil();
    return data;
  };
  S.STATUS = { pending: "Pending", processing: "Processing", completed: "Completed", partial: "Partially delivered", cancelled: "Cancelled", refunded: "Refunded" };
  S.badge = s => `<span class="st st-${esc(s)}">${esc(S.STATUS[s] || s)}</span>`;
  S.PAYPAL = cfg.PAYPAL_ME || "https://paypal.me/SKYDESIGN01";

  S.invoice = (o, user) => {
    const w = window.open("", "_blank");
    if (!w) return toast("Allow pop-ups to print the invoice.", true);
    w.document.write(`<!doctype html><title>Invoice SP-${o.id}</title><style>
      body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;color:#0b1633}
      h1{margin:0}h1 b{color:#d99a1f}table{width:100%;border-collapse:collapse;margin-top:24px}
      td,th{padding:10px;border-bottom:1px solid #e3e9f8;text-align:left}.tot{font-size:1.4rem;text-align:right;margin-top:20px}
      small{color:#6b7aa6}@media print{button{display:none}}</style>
      <h1>✈ Sky<b>Pilot</b></h1><p><small>Invoice SP-${o.id} · ${esc(when(o.created_at))}</small></p>
      <p>Billed to: <b>${esc(user?.full_name || user?.email || "")}</b><br><small>${esc(user?.email || "")}</small></p>
      <table><tr><th>Service</th><th>Link</th><th>Qty</th><th>Amount</th></tr>
      <tr><td>${esc(o.services?.platform)} ${esc(o.services?.name)}</td><td>${esc(o.link)}</td><td>${Number(o.qty).toLocaleString()}</td><td>${money(o.total)}</td></tr></table>
      ${Number(o.refunded) > 0 ? `<p class="tot"><small>Refunded: -${money(o.refunded)}</small></p>` : ""}
      <p class="tot">Total: <b>${money(Number(o.total) - Number(o.refunded))}</b> · ${esc(S.STATUS[o.status] || o.status)}</p>
      <p><small>Paid from wallet balance. Thank you for flying with Sky Pilot.</small></p>
      <button onclick="print()">Print / Save PDF</button>`);
    w.document.close();
  };

  return S;
})();
