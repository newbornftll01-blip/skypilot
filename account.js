(async () => {
  try { await Sky.boot(); } catch { return; }
  const { sb, $, esc, money, when, toast, rpc } = Sky;
  const flash = (el, text, bad) => { el.textContent = text; el.className = bad ? "err" : "okmsg"; };
  let orders = [];

  // ---- wallet ----
  const paintBal = p => { $("#bal").textContent = money(p?.balance); };
  paintBal(Sky.profile); Sky.on("profile", p => { paintBal(p); loadTx(); });

  const payLink = () => {
    const a = Number($("#amount").value);
    const base = Sky.PAYPAL.replace(/\/+$/, "");
    return a >= 1 ? `${base}/${a.toFixed(2)}USD` : base;
  };
  const syncPay = () => {
    $("#paypalBtn").href = payLink();
    let h = $("#curHint");
    if (!h) { h = document.createElement("small"); h.id = "curHint"; h.className = "muted"; $("#amount").insertAdjacentElement("afterend", h); }
    const a = Number($("#amount").value);
    h.textContent = Sky.cur.code === "USD" ? "" : ` ≈ ${money(a || 0)} · PayPal charges in USD.`;
  };
  $("#amount").oninput = syncPay; syncPay();

  $("#topupForm").onsubmit = async e => {
    e.preventDefault();
    $("#topupBtn").disabled = true;
    try {
      await rpc("request_topup", { p_amount: Number($("#amount").value), p_method: "paypal", p_reference: $("#ref").value.trim() });
      flash($("#topupMsg"), "Submitted ✓ We'll verify your payment and credit your wallet shortly.");
      $("#ref").value = "";
      loadTopups();
    } catch (err) { flash($("#topupMsg"), err.message, true); }
    finally { $("#topupBtn").disabled = false; }
  };

  const TOP = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  async function loadTopups() {
    const { data } = await sb.from("topups").select("*").eq("user_id", Sky.session.user.id).order("created_at", { ascending: false }).limit(20);
    $("#topupRows").innerHTML = data?.length
      ? data.map(t => `<tr><td>${when(t.created_at)}</td><td>${Sky.usd(t.amount)}</td><td>${esc(t.reference)}</td><td><span class="st st-${t.status === "approved" ? "completed" : t.status === "rejected" ? "cancelled" : "pending"}">${TOP[t.status]}</span>${t.note ? `<br><small>${esc(t.note)}</small>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">No top-ups yet.</td></tr>`;
  }
  async function loadTx() {
    const { data } = await sb.from("transactions").select("*").eq("user_id", Sky.session.user.id).order("created_at", { ascending: false }).limit(30);
    $("#txRows").innerHTML = data?.length
      ? data.map(t => `<tr><td>${when(t.created_at)}</td><td>${esc(t.kind)}</td><td>${esc(t.note || t.ref || "")}</td><td class="${t.amount < 0 ? "neg" : "pos"}">${t.amount < 0 ? "−" : "+"}${money(Math.abs(t.amount))}</td><td>${money(t.balance_after)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">No transactions yet.</td></tr>`;
  }

  // ---- orders ----
  async function loadOrders() {
    const { data } = await sb.from("orders").select("*, services(platform,name)").order("created_at", { ascending: false }).limit(100);
    orders = data || [];
    $("#orderRows").innerHTML = orders.length
      ? orders.map(o => `<tr><td>${o.id}</td><td>${when(o.created_at)}</td><td>${esc(o.services.platform)} ${esc(o.services.name)}</td><td>${o.qty.toLocaleString()}</td><td>${money(o.total)}</td><td>${Sky.badge(o.status)}</td><td><button class="btn ghost small" data-id="${o.id}">Details</button></td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">No orders yet. <a href="home.html#calculator">Place your first order →</a></td></tr>`;
  }
  $("#orderRows").onclick = async e => {
    const id = e.target.dataset?.id;
    if (!id) return;
    const o = orders.find(x => String(x.id) === id);
    const { data: ev } = await sb.from("order_events").select("*").eq("order_id", o.id).order("id");
    $("#orderDetail").innerHTML = `<h3>Order #${o.id} ${Sky.badge(o.status)}</h3>
      <p><b>${esc(o.services.platform)} ${esc(o.services.name)}</b> × ${o.qty.toLocaleString()} — ${money(o.total)}${Number(o.refunded) ? ` <small>(refunded ${money(o.refunded)})</small>` : ""}</p>
      <p class="muted">${esc(o.link)}</p>
      <p><b>Tracking ID:</b> SP-${String(o.id).padStart(6, "0")}${o.status === "pending" ? ` · <small>queued, delivery starts automatically</small>` : ""}</p>
      ${(() => {
        const done = o.status === "completed" ? o.qty : o.remains != null ? Math.max(0, o.qty - o.remains) : 0;
        const pct = Math.min(100, Math.round(done / o.qty * 100));
        return `<div class="track"><div style="width:${pct}%;height:10px;border-radius:6px;background:linear-gradient(90deg,#1e63ff,#f5c451)"></div></div><small class="muted">${done.toLocaleString()} / ${o.qty.toLocaleString()} delivered (${pct}%)</small>`;
      })()}
      ${o.start_count != null ? `<p class="muted">Start count: ${o.start_count.toLocaleString()}${o.remains != null ? ` · Remaining: ${o.remains.toLocaleString()}` : ""}</p>` : ""}
      <ul class="timeline">${(ev || []).map(x => `<li><b>${esc(Sky.STATUS[x.status] || x.status)}</b> <small>${when(x.created_at)}</small>${x.note ? `<br>${esc(x.note)}` : ""}</li>`).join("")}</ul>
      <div class="cta"><button class="btn" id="inv" type="button">Invoice</button><button class="btn ghost" id="closeDlg" type="button">Close</button></div>`;
    $("#inv").onclick = () => Sky.invoice(o, Sky.profile);
    $("#closeDlg").onclick = () => $("#orderDlg").close();
    $("#orderDlg").showModal();
  };

  // ---- profile ----
  $("#pEmail").value = Sky.profile.email || ""; $("#pName").value = Sky.profile.full_name || ""; $("#pPhone").value = Sky.profile.phone || "";
  $("#profileForm").onsubmit = async e => {
    e.preventDefault();
    try { await rpc("update_profile", { p_name: $("#pName").value, p_phone: $("#pPhone").value }); flash($("#profMsg"), "Saved ✓"); }
    catch (err) { flash($("#profMsg"), err.message, true); }
  };
  $("#pwForm").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("#newpw").value });
    flash($("#pwMsg"), error ? error.message : "Password updated ✓", !!error);
    if (!error) $("#newpw").value = "";
  };

  // ---- support ----
  async function loadSupport() {
    const { data } = await sb.from("support_requests").select("*").eq("user_id", Sky.session.user.id).order("created_at", { ascending: false }).limit(10);
    $("#supRows").innerHTML = data?.length
      ? data.map(r => `<tr><td>${when(r.created_at)}</td><td>${esc(r.message)}</td><td>${esc(r.status)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">No requests yet.</td></tr>`;
  }
  $("#supForm").onsubmit = async e => {
    e.preventDefault();
    try { await rpc("create_support_request", { p_message: $("#supText").value }); $("#supText").value = ""; flash($("#supMsg"), "Sent ✓ We'll get back to you."); loadSupport(); }
    catch (err) { flash($("#supMsg"), err.message, true); }
  };

  Sky.on("orders", loadOrders);
  Sky.on("topups", loadTopups);
  loadTopups(); loadTx(); loadOrders(); loadSupport();
})();
