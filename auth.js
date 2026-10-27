(async () => {
  const { sb, ready, $ } = Sky;
  if (!ready) { document.body.innerHTML = '<div class="setup"><h1>✈ Almost there</h1><p>Open <code>config.js</code>, paste your Supabase Project URL and anon key, and run <code>supabase/schema.sql</code>. See <code>README.md</code>.</p></div>'; return; }

  const { data: { session } } = await sb.auth.getSession();
  if (session) { location.replace("home.html"); return; }

  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  const norm = v => v.trim().toLowerCase();
  let mode = "up";
  let pending = null; // { email, kind: "signup" | "recovery" } while waiting for the emailed code
  const msg = (t, bad = true) => { $("#msg").textContent = t; $("#msg").className = bad ? "err" : "okmsg"; };
  const cmsg = (t, bad = true) => { $("#cmsg").textContent = t; $("#cmsg").className = bad ? "err" : "okmsg"; };

  function setMode(m) {
    mode = m;
    $("#tabUp").className = m === "up" ? "on" : "";
    $("#tabIn").className = m === "in" ? "on" : "";
    $("#nameRow").hidden = $("#termsRow").hidden = m === "in";
    $("#forgot").hidden = m === "up";
    $("#submit").textContent = m === "up" ? "Create account" : "Log in";
    $("#password").autocomplete = m === "up" ? "new-password" : "current-password";
    msg("");
  }
  $("#tabUp").onclick = () => setMode("up");
  $("#tabIn").onclick = () => setMode("in");
  if (location.hash === "#login") setMode("in");

  let timer = null;
  function cooldown(sec = 60) {
    clearInterval(timer);
    const b = $("#resend");
    let s = sec;
    b.disabled = true;
    const tick = () => { b.textContent = s > 0 ? `Resend code (${s}s)` : "Resend code"; if (s-- <= 0) { clearInterval(timer); b.disabled = false; } };
    tick(); timer = setInterval(tick, 1000);
  }

  function showCode(kind, email) {
    pending = { kind, email };
    $("#authForm").hidden = true;
    $("#tabs").hidden = true;
    $("#codeForm").hidden = false;
    $("#pwRow").hidden = kind !== "recovery";
    $("#codeTitle").textContent = kind === "signup" ? "Verify your email" : "Reset your password";
    $("#codeHelp").textContent = `We sent a code to ${email}. Enter it below${kind === "recovery" ? " and choose a new password" : ""}. Check spam if you can't see it.`;
    $("#codeBtn").textContent = kind === "signup" ? "Verify & continue" : "Update password";
    $("#code").value = ""; $("#newpw").value = ""; cmsg("");
    cooldown(); $("#code").focus();
  }
  function backToForm() {
    pending = null; clearInterval(timer);
    $("#codeForm").hidden = true; $("#authForm").hidden = false; $("#tabs").hidden = false;
  }
  $("#back").onclick = backToForm;

  async function sendRecovery(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: base + "reset.html" });
    return error;
  }

  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const email = norm($("#email").value), password = $("#password").value;
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return msg("Enter a valid email and a password of at least 8 characters.");
    $("#submit").disabled = true;
    try {
      if (mode === "up") {
        if (!$("#terms").checked) return msg("Please tick the box to continue.");
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { full_name: $("#name").value.trim() }, emailRedirectTo: base + "home.html" }
        });
        if (error) return msg(error.message);
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMode("in");
          return msg("That email already has an account. Log in instead, or use “Forgot your password?”.");
        }
        if (!data.session) return showCode("signup", email);
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          if (/not confirmed/i.test(error.message)) {
            const r = await sb.auth.resend({ type: "signup", email });
            if (!r.error) return showCode("signup", email);
          }
          return msg(/invalid login/i.test(error.message) ? "Wrong email or password." : error.message);
        }
      }
      location.replace("home.html");
    } finally { $("#submit").disabled = false; }
  };

  $("#forgot").onclick = async () => {
    const email = norm($("#email").value);
    if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Enter your email above first.");
    const error = await sendRecovery(email);
    if (error) return msg(error.message);
    showCode("recovery", email);
  };

  $("#resend").onclick = async () => {
    if (!pending) return;
    cooldown();
    const error = pending.kind === "signup" ? (await sb.auth.resend({ type: "signup", email: pending.email })).error : await sendRecovery(pending.email);
    cmsg(error ? error.message : "A new code is on its way.", !!error);
  };

  $("#codeForm").onsubmit = async e => {
    e.preventDefault();
    if (!pending) return;
    const token = $("#code").value.replace(/\s+/g, "");
    if (!/^\d{6,8}$/.test(token)) return cmsg("Enter the numeric code from the email.");
    if (pending.kind === "recovery" && $("#newpw").value.length < 8) return cmsg("Choose a new password of at least 8 characters.");
    $("#codeBtn").disabled = true;
    try {
      const { error } = await sb.auth.verifyOtp({ email: pending.email, token, type: pending.kind });
      if (error) return cmsg(/expired|invalid/i.test(error.message) ? "That code is wrong or has expired. Request a new one." : error.message);
      if (pending.kind === "recovery") {
        const u = await sb.auth.updateUser({ password: $("#newpw").value });
        if (u.error) return cmsg(u.error.message);
      }
      location.replace("home.html");
    } finally { $("#codeBtn").disabled = false; }
  };
})();
