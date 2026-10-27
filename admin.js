(async () => {
  try { await Sky.boot({ admin: true }); } catch { return; }
  const { sb, $, esc, usd: money, when, toast, rpc } = Sky;
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, true); } };
  let users = {}, orders = [], services = [];
  const who = id => users[id]?.email || id.slice(0, 8);

  // ---- tabs ----
  $("#atabs").onclick = e => {
    const t = e.target.dataset?.t; if (!t) return;
    document.querySelectorAll("#atabs button").forEach(b => b.className = b.dataset.t === t ? "on" : "");
    document.querySelectorAll(".apanel").forEach(p => p.hidden = p.id !== "p-" + t);
  };

  async function loadUsers() {
    const { data } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
    users = Object.fromEntries((data || []).map(u => [u.id, u]));
    renderUsers();
    $("#bTo").innerHTML = `<option value="">Everyone</option>` + (data || []).map(u => `<option value="${u.id}">${esc(u.email)}</option>`).join("");
  }
  function renderUsers() {
    const q = $("#usearch").value.toLowerCase();
    $("#uRows").innerHTML = Object.values(users).filter(u => !q || (u.email + " " + u.full_name).toLowerCase().includes(q)).map(u =>
      `<tr><td>${esc(u.email)}${u.is_admin ? " 👑" : ""}<br><small>${esc(u.full_name)} ${esc(u.phone)}</small></td><td>${money(u.balance)}</td><td>${when(u.created_at)}</td>
       <td><button class="btn ghost small" data-adj="${u.id}">Adjust balance</button></td></tr>`).join("");
  }
  $("#usearch").oninput = renderUsers;
  $("#uRows").onclick = e => {
    const id = e.target.dataset?.adj; if (!id) return;
    const v = prompt(`Amount to add (negative to deduct) for ${who(id)}:`); if (v === null) return;
    const note = prompt("Reason (shown in their ledger):", "Manual adjustment") ?? "";
    run(async () => { await rpc("admin_adjust_balance", { p_user: id, p_amount: Number(v), p_note: note }); await loadUsers(); }, "Balance updated");
  };

  // ---- orders ----
  async function loadOrders() {
    let q = sb.from("orders").select("*, services(platform,name,provider_service_id)").order("created_at", { ascending: false }).limit(200);
    if ($("#ostatus").value) q = q.eq("status", $("#ostatus").value);
    const { data } = await q; orders = data || [];
    $("#oRows").innerHTML = orders.map(o => {
      const closed = ["cancelled", "refunded"].includes(o.status);
      return `<tr><td>${o.id}</td><td>${esc(who(o.user_id))}</td><td>${esc(o.services.platform)} ${esc(o.services.name)}</td>
        <td class="lnk">${esc(o.link)}</td><td>${o.qty.toLocaleString()}</td><td>${money(o.total)}</td>
        <td>${Sky.badge(o.status)}${o.provider_order_id ? `<br><small>supplier #${esc(o.provider_order_id)}</small>` : ""}</td>
        <td>${closed ? "" : `<select data-st="${o.id}"><option value="">Set status…</option><option>processing</option><option>completed</option><option>partial</option><option>cancelled</option></select>`}</td></tr>`;
    }).join("") || `<tr><td colspan="8" class="empty">No orders.</td></tr>`;
    stats();
  }
  $("#ostatus").onchange = loadOrders;
  $("#oRows").onchange = e => {
    const id = e.target.dataset?.st, status = e.target.value; if (!id || !status) return;
    const o = orders.find(x => String(x.id) === id);
    const note = prompt(`Note shown to the customer for #${id} → ${status} (optional):`, "") ?? "";
    let refund = 0;
    if (status === "partial") {
      refund = Number(prompt(`Partial: how much to refund? (max ${money(o.total - o.refunded)})`, ""));
      if (!(refund > 0)) { e.target.value = ""; return; }
    }
    if (status === "cancelled" && !confirm(`Cancel #${id} and refund ${money(o.total - o.refunded)} to the customer?`)) { e.target.value = ""; return; }
    run(async () => { await rpc("admin_set_order_status", { p_id: Number(id), p_status: status, p_note: note || null, p_refund: refund }); await loadOrders(); await loadUsers(); }, `Order #${id} → ${status}`);
  };

  // ---- supplier (edge function) ----
  async function provider(action) {
    $("#provMsg").textContent = "Working…";
    const { data, error } = await sb.functions.invoke("provider", { body: { action } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} $("#provMsg").textContent = m; return toast(m, true); }
    $("#provMsg").textContent = data.summary; toast(data.summary);
    loadOrders(); loadUsers();
  }
  $("#sendAll").onclick = () => provider("submit");
  $("#syncAll").onclick = () => provider("sync");

  // ---- top-ups ----
  async function loadTopups() {
    const { data } = await sb.from("topups").select("*").order("created_at", { ascending: false }).limit(100);
    $("#tRows").innerHTML = (data || []).map(t => `<tr><td>${when(t.created_at)}</td><td>${esc(who(t.user_id))}</td><td>${money(t.amount)}</td><td>${esc(t.reference)}</td>
      <td>${esc(t.status)}</td><td>${t.status === "pending" ? `<button class="btn small" data-ok="${t.id}">Approve</button> <button class="btn ghost small" data-no="${t.id}">Reject</button>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="6" class="empty">No top-ups.</td></tr>`;
    stats(data);
  }
  $("#tRows").onclick = e => {
    const ok = e.target.dataset?.ok, no = e.target.dataset?.no, id = ok || no; if (!id) return;
    let note = null;
    if (ok && !confirm("Only approve after you've seen this payment in PayPal. Credit the wallet?")) return;
    if (no) { note = prompt("Reason shown to the customer:", "We could not find this payment in PayPal."); if (note === null) return; }
    run(async () => { await rpc("admin_review_topup", { p_id: Number(id), p_approve: !!ok, p_note: note }); await Promise.all([loadTopups(), loadUsers()]); }, ok ? "Wallet credited" : "Rejected");
  };

  // ---- services ----
  async function loadServices() {
    const { data } = await sb.from("services").select("*").order("id"); services = data || [];
    const row = s => `<tr data-id="${s?.id ?? ""}"><td><input value="${esc(s?.platform)}" data-f="platform"></td><td><input value="${esc(s?.name)}" data-f="name"></td>
      <td><input value="${s?.rate ?? ""}" data-f="rate" type="number" step="0.01" class="num"></td><td><input value="${s?.min_qty ?? ""}" data-f="min" type="number" class="num"></td>
      <td><input value="${s?.max_qty ?? ""}" data-f="max" type="number" class="num"></td><td><input value="${esc(s?.provider_service_id)}" data-f="prov" class="num"></td>
      <td><input type="checkbox" data-f="active" ${!s || s.active ? "checked" : ""}></td><td><button class="btn small" data-save>${s ? "Save" : "Add"}</button></td></tr>`;
    $("#sRows").innerHTML = services.map(row).join("") + row(null);
  }
  $("#sRows").onclick = e => {
    if (!e.target.hasAttribute("data-save")) return;
    const tr = e.target.closest("tr"), f = k => tr.querySelector(`[data-f=${k}]`);
    const s = services.find(x => String(x.id) === tr.dataset.id);
    run(async () => {
      await rpc("admin_save_service", { p_id: s ? s.id : null, p_platform: f("platform").value.trim(), p_name: f("name").value.trim(), p_desc: s?.description ?? "",
        p_rate: Number(f("rate").value), p_min: Number(f("min").value), p_max: Number(f("max").value), p_active: f("active").checked, p_provider: f("prov").value.trim() });
      await loadServices();
    }, "Service saved");
  };

  // ---- support ----
  async function loadSupport() {
    const { data } = await sb.from("support_requests").select("*").order("created_at", { ascending: false }).limit(100);
    $("#qRows").innerHTML = (data || []).map(r => `<tr><td>${when(r.created_at)}</td><td>${esc(who(r.user_id))}</td><td>${esc(r.message)}</td><td>${esc(r.status)}</td>
      <td>${r.status === "open" ? `<button class="btn ghost small" data-reply="${r.user_id}" data-id="${r.id}">Reply &amp; close</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No requests.</td></tr>`;
    stats(null, data);
  }
  $("#qRows").onclick = e => {
    const uid = e.target.dataset?.reply; if (!uid) return;
    const text = prompt("Reply (sent to the customer as a notification):"); if (!text) return;
    run(async () => { await rpc("admin_notify", { p_user: uid, p_title: "Support reply", p_body: text }); await rpc("admin_close_support", { p_id: Number(e.target.dataset.id) }); await loadSupport(); }, "Reply sent");
  };

  // ---- broadcast ----
  $("#bForm").onsubmit = e => {
    e.preventDefault();
    run(async () => { await rpc("admin_notify", { p_user: $("#bTo").value || null, p_title: $("#bTitle").value, p_body: $("#bBody").value }); $("#bTitle").value = $("#bBody").value = ""; }, "Sent");
  };

  // ---- overview ----
  const S = { users: 0, pending: 0, topups: 0, open: 0, revenue: 0 };
  function stats(t, q) {
    S.users = Object.keys(users).length;
    S.pending = orders.filter(o => o.status === "pending").length;
    S.revenue = orders.filter(o => !["cancelled", "refunded"].includes(o.status)).reduce((a, o) => a + Number(o.total) - Number(o.refunded), 0);
    if (t) S.topups = t.filter(x => x.status === "pending").length;
    if (q) S.open = q.filter(x => x.status === "open").length;
    $("#stats").innerHTML = [["Users", S.users], ["Pending orders", S.pending], ["Pending top-ups", S.topups], ["Open support", S.open], ["Revenue (shown orders)", money(S.revenue)]]
      .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
  }

  Sky.on("orders", () => { loadOrders(); });
  Sky.on("topups", () => { loadTopups(); });
  await loadUsers();
  await Promise.all([loadOrders(), loadTopups(), loadServices(), loadSupport()]);
})();
