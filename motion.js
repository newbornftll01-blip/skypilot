// Lightweight motion: no libraries, only transform/opacity updates.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // scroll reveal
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: .12 });
  document.querySelectorAll(".rv").forEach(el => io.observe(el));

  // cursor spotlight on service cards (event delegation, survives re-render)
  document.getElementById("grid").addEventListener("pointermove", e => {
    const c = e.target.closest(".card");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", e.clientX - r.left + "px");
    c.style.setProperty("--my", e.clientY - r.top + "px");
  });

  // live "example order" loop
  const num = document.getElementById("dnum"), bar = document.getElementById("dbar"),
        add = document.getElementById("dadd"), st = document.getElementById("dstate");
  const base = 1240, goal = 1000;
  const draw = k => {
    const v = Math.round(goal * k);
    num.textContent = (base + v).toLocaleString();
    add.textContent = "+" + v.toLocaleString();
    bar.style.width = k * 100 + "%";
    st.textContent = k === 0 ? "Starting" : k < 1 ? "In progress" : "Completed ✓";
  };
  if (reduce) return draw(1);
  let t0 = performance.now();
  const loop = t => {
    const s = ((t - t0) / 1000) % 9; // 1s pause, 5s climb, 3s hold
    const k = s < 1 ? 0 : s < 6 ? 1 - Math.pow(1 - (s - 1) / 5, 3) : 1;
    draw(k);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
