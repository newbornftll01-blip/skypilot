(async () => {
  try { await Sky.boot(); } catch { return; }
  const { sb, $, esc, money, toast, rpc } = Sky;
  $("#yr").textContent = new Date().getFullYear();

  const { data: services, error } = await sb.from("services").select("*").eq("active", true).order("id");
  if (error || !services?.length) { $("#grid").innerHTML = `<p class="empty">Services are unavailable right now.</p>`; return; }
  Sky.services = services;
  const catalog = {};
  services.forEach(s => (catalog[s.platform] ||= []).push(s));
  let active = Object.keys(catalog)[0];

  const first = (Sky.profile.full_name || Sky.profile.email || "").split(/[ @]/)[0];
  $("#hello").textContent = first ? `Welcome back, ${first}` : "Welcome aboard";

  function renderTabs() {
    $("#tabs").innerHTML = "";
    Object.keys(catalog).forEach(p => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = p; b.className = p === active ? "on" : "";
      b.onclick = () => { active = p; renderTabs(); renderGrid(); };
      $("#tabs").append(b);
    });
  }
  function renderGrid() {
    $("#grid").innerHTML = "";
    catalog[active].forEach(s => {
      const c = document.createElement("div");
      c.className = "card";
      c.innerHTML = `<h3>${esc(s.platform)} ${esc(s.name)}</h3><p>${esc(s.description)}</p>
        <div class="p">${money(s.rate)} / 1,000</div>`;
      const b = document.createElement("button");
      b.className = "btn small"; b.type = "button"; b.textContent = "Order";
      b.onclick = () => { $("#platform").value = s.platform; fillServices(); $("#service").value = s.id; $("#qty").value = ""; sync(); $("#calculator").scrollIntoView(); };
      c.append(b);
      $("#grid").append(c);
    });
  }

  const current = () => services.find(s => String(s.id) === $("#service").value);
  function fillServices() {
    $("#service").innerHTML = catalog[$("#platform").value].map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    $("#qty").value = "";
    sync();
  }
  function sync(fromRange) {
    const s = current();
    $("#qty").min = s.min_qty; $("#qty").max = s.max_qty;
    $("#range").min = s.min_qty; $("#range").max = s.max_qty; $("#range").step = s.min_qty >= 500 ? 100 : 10;
    let q = Number(fromRange ? $("#range").value : $("#qty").value) || s.min_qty;
    q = Math.min(s.max_qty, Math.max(s.min_qty, Math.round(q)));
    $("#qty").value = q; $("#range").value = q;
    $("#total").textContent = money(q / 1000 * s.rate);
    $("#meta").textContent = `min ${s.min_qty.toLocaleString()} · max ${s.max_qty.toLocaleString()}`;
    $("#desc").textContent = s.description;
  }

  $("#platform").innerHTML = Object.keys(catalog).map(p => `<option>${esc(p)}</option>`).join("");
  $("#platform").onchange = fillServices;
  $("#service").onchange = () => { $("#qty").value = ""; sync(); };
  $("#qty").onchange = () => sync();
  $("#range").oninput = () => sync(true);

  $("#calc").onsubmit = async e => {
    e.preventDefault();
    const s = current(), qty = Number($("#qty").value), msg = $("#msg");
    const cost = Math.round(qty / 1000 * s.rate * 100) / 100;
    msg.className = "";
    if (cost > Number(Sky.profile.balance)) {
      msg.innerHTML = `Not enough balance (${money(Sky.profile.balance)}). <a href="account.html#wallet">Add funds →</a>`;
      msg.className = "err";
      return;
    }
    $("#orderBtn").disabled = true;
    try {
      const o = await rpc("place_order", { p_platform: s.platform, p_name: s.name, p_link: $("#link").value.trim(), p_qty: qty });
      msg.textContent = `Order #${o.id} placed ✓ Track it below.`;
      msg.className = "okmsg";
      $("#link").value = "";
      toast(`Order #${o.id} placed`);
      loadOrders();
    } catch (err) { msg.textContent = err.message; msg.className = "err"; }
    finally { $("#orderBtn").disabled = false; }
  };

  async function loadOrders() {
    const [{ data }, { count }] = await Promise.all([
      sb.from("orders").select("*, services(platform,name)").order("created_at", { ascending: false }).limit(5),
      sb.from("orders").select("id", { count: "exact", head: true })
    ]);
    $("#statOrders").textContent = (count ?? 0).toLocaleString();
    $("#orderRows").innerHTML = data?.length
      ? data.map(o => `<tr><td>${o.id}</td><td>${esc(o.services.platform)} ${esc(o.services.name)}</td><td>${o.qty.toLocaleString()}</td><td>${money(o.total)}</td><td>${Sky.badge(o.status)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">No orders yet. Place your first one above.</td></tr>`;
  }

  const paintBal = p => { $("#statBal").textContent = money(p?.balance); };
  paintBal(Sky.profile);
  Sky.on("profile", paintBal);
  Sky.on("orders", loadOrders);

  renderTabs(); renderGrid(); fillServices(); loadOrders();
})();
