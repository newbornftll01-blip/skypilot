// Floating AI assistant. The AI drafts orders; money only moves when the customer clicks "Confirm".
(() => {
  if (!window.Sky?.sb) return;
  if (Sky.profile) mount(); else Sky.on("ready", mount);
  function mount() {
    const { $, esc, money, rpc, toast, sb } = Sky;
    const history = [];
    const root = document.createElement("div");
    root.className = "ai";
    root.innerHTML = `<button class="aibtn" id="aiOpen" aria-label="Open assistant">🤖<span>Ask Sky</span></button>
      <div class="aipanel" id="aiPanel" hidden>
        <div class="aihead"><b>Sky · AI assistant</b><button id="aiClose" aria-label="Close">×</button></div>
        <div class="aimsgs" id="aiMsgs"></div>
        <div class="aichips" id="aiChips"></div>
        <form id="aiForm"><input id="aiIn" placeholder="e.g. 1000 TikTok followers for @me" maxlength="500" autocomplete="off"><button class="btn small">Send</button></form>
      </div>`;
    document.body.append(root);
    const msgs = root.querySelector("#aiMsgs");

    const add = (who, html) => { const d = document.createElement("div"); d.className = "m " + who; d.innerHTML = html; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; };
    add("bot", "Hi! I can answer questions, check your orders and wallet, draft an order for you, or pass a message to support.");
    ["How do I add funds?", "Where is my last order?", "Order 1000 Instagram likes"].forEach(t => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.onclick = () => send(t); root.querySelector("#aiChips").append(b);
    });

    root.querySelector("#aiOpen").onclick = () => { if (moved) return; const p = root.querySelector("#aiPanel"); p.hidden = !p.hidden; place(); if (!p.hidden) root.querySelector("#aiIn").focus(); };
    root.querySelector("#aiClose").onclick = () => { root.querySelector("#aiPanel").hidden = true; };

    // Drag anywhere on screen by the button or the panel header; position is remembered.
    let moved = false;
    const panel = root.querySelector("#aiPanel");
    const clamp = (x, y) => {
      const w = root.offsetWidth || 130, h = root.offsetHeight || 48;
      return [Math.min(Math.max(4, x), innerWidth - w - 4), Math.min(Math.max(4, y), innerHeight - h - 4)];
    };
    const setPos = (x, y) => { [x, y] = clamp(x, y); root.style.left = x + "px"; root.style.top = y + "px"; root.style.right = "auto"; root.style.bottom = "auto"; };
    function place() {
      const r = root.getBoundingClientRect();
      panel.style.left = panel.style.right = panel.style.top = panel.style.bottom = "auto";
      if (r.left + 360 > innerWidth - 8) panel.style.right = "0"; else panel.style.left = "0";
      if (r.top > 500) panel.style.bottom = "60px"; else panel.style.top = "60px";
    }
    try { const s = JSON.parse(localStorage.getItem("sky_ai_pos") || "null"); if (s) setPos(s.x * innerWidth, s.y * innerHeight); } catch { /* default spot */ }
    addEventListener("resize", () => { const r = root.getBoundingClientRect(); setPos(r.left, r.top); place(); });
    const startDrag = e => {
      if (e.target.closest("#aiClose") || e.button > 0) return;
      const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
      moved = false;
      const mv = ev => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        moved = true; root.classList.add("dragging"); setPos(ev.clientX - dx, ev.clientY - dy); place();
      };
      const up = () => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
        root.classList.remove("dragging");
        if (moved) { const q = root.getBoundingClientRect(); localStorage.setItem("sky_ai_pos", JSON.stringify({ x: q.left / innerWidth, y: q.top / innerHeight })); setTimeout(() => { moved = false; }, 0); }
      };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    };
    root.querySelector("#aiOpen").addEventListener("pointerdown", startDrag);
    root.querySelector(".aihead").addEventListener("pointerdown", startDrag);
    root.querySelector("#aiForm").onsubmit = e => { e.preventDefault(); const i = root.querySelector("#aiIn"); const t = i.value.trim(); i.value = ""; if (t) send(t); };

    async function send(text) {
      root.querySelector("#aiChips").innerHTML = "";
      add("me", esc(text));
      history.push({ role: "user", content: text });
      const wait = add("bot", "…");
      try {
        const { data, error } = await sb.functions.invoke("sky-chat", { body: { messages: history.slice(-8), currency: { code: Sky.cur.code, rate: Sky.cur.rate } } });
        if (error) throw new Error("The assistant is unavailable right now. You can still use Support on the Wallet & Orders page.");
        if (data?.error) throw new Error(data.error);
        history.push({ role: "assistant", content: data.reply });
        wait.innerHTML = esc(data.reply);
        if (data.proposal) proposal(data.proposal);
      } catch (e) { wait.textContent = e.message; wait.classList.add("err"); history.pop(); }
    }

    function proposal(p) {
      const s = (Sky.services || []).find(x => x.platform === p.platform && x.name === p.service);
      if (!s) return add("bot", "I couldn't match that to an available service. Please pick one from the Services list.");
      const qty = Math.round(Number(p.qty));
      if (!(qty >= s.min_qty && qty <= s.max_qty)) return add("bot", `For ${esc(s.platform)} ${esc(s.name)} the quantity must be between ${s.min_qty.toLocaleString()} and ${s.max_qty.toLocaleString()}.`);
      const cost = Math.round(qty / 1000 * s.rate * 100) / 100;
      const d = add("bot", `<div class="prop"><b>Order draft</b><br>${esc(s.platform)} ${esc(s.name)} × ${qty.toLocaleString()}<br>Link: ${esc(p.link)}<br>Total: <b>${money(cost)}</b> (balance ${money(Sky.profile.balance)})</div>`);
      const b = document.createElement("button"); b.className = "btn small"; b.textContent = `Confirm & pay ${money(cost)}`;
      b.onclick = async () => {
        b.disabled = true;
        try { const o = await rpc("place_order", { p_platform: s.platform, p_name: s.name, p_link: String(p.link).trim(), p_qty: qty }); d.innerHTML = `✅ Order #${o.id} placed. Track it under Wallet &amp; Orders.`; toast(`Order #${o.id} placed`); history.push({ role: "assistant", content: `(Order #${o.id} was placed.)` }); }
        catch (e) { d.innerHTML = `⚠️ ${esc(e.message)}`; b.remove(); }
      };
      d.append(b);
    }
  }
})();
