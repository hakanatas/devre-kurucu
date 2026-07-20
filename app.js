/* Devre Kurucu — Levha VIII
   Gerçek devre çözücü (Modified Nodal Analysis). Pil, ampul, anahtar, kablo.
   Teller/kapalı anahtarlar union-find ile birleşir; kalan ağ MNA ile çözülür.
   Bağımlılık yok. */

const { min, max, hypot, abs, PI, round } = Math;
const TAU = 2 * PI;

/* elektriksel değerler */
const V_BATT = 1.5, R_INT = 0.3, R_BULB = 1.5;
const I_REF = V_BATT / (R_INT + R_BULB);   // tek pil + tek ampul akımı (referans parlaklık)

/* ---------- durum ---------- */
let comps = [];   // {id, type:'battery'|'bulb'|'switch', x, y, on}
let wires = [];   // {a:[compId,term], b:[compId,term]}
let seq = 0;
const state = { mode: "wire", drag: null, wiring: null, hover: null };
const done = { light: false, switch: false, two: false, parallel: false, series: false };

/* ---------- kanvas ---------- */
const board = document.getElementById("board");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1;
  W = board.clientWidth;
  H = max(420, Math.round(window.innerHeight - board.getBoundingClientRect().top - 150));
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.height = H + "px";
}
window.addEventListener("resize", resize);

/* ---------- bileşen geometrisi ---------- */
const SIZE = { battery: [86, 44], bulb: [52, 52], switch: [74, 40] };
function termPos(c, i) {
  const [w] = SIZE[c.type];
  const dx = w / 2 + 10;
  return i === 0 ? [c.x - dx, c.y] : [c.x + dx, c.y];
}
function compAt(x, y) {
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i], [w, h] = SIZE[c.type];
    if (abs(x - c.x) < w / 2 + 4 && abs(y - c.y) < h / 2 + 4) return c;
  }
  return null;
}
function termAt(x, y) {
  for (const c of comps) for (let i = 0; i < 2; i++) {
    const [tx, ty] = termPos(c, i);
    if (hypot(x - tx, y - ty) < 15) return { comp: c, term: i, pos: [tx, ty] };
  }
  return null;
}
function wireAt(x, y) {
  for (let k = wires.length - 1; k >= 0; k--) {
    const wobj = wires[k];
    const a = termPos(byId(wobj.a[0]), wobj.a[1]);
    const b = termPos(byId(wobj.b[0]), wobj.b[1]);
    if (distToSeg(x, y, a, b) < 8) return k;
  }
  return -1;
}
function distToSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = max(0, min(1, t));
  return hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const byId = (id) => comps.find((c) => c.id === id);

/* ---------- union-find ---------- */
function solve() {
  // her (comp,term) bir terminal düğümü; teller ve kapalı anahtarlar birleştirir
  const key = (cid, t) => cid + ":" + t;
  const parent = {};
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { parent[find(a)] = find(b); };
  for (const c of comps) for (let t = 0; t < 2; t++) parent[key(c.id, t)] = key(c.id, t);
  for (const wobj of wires) uni(key(wobj.a[0], wobj.a[1]), key(wobj.b[0], wobj.b[1]));
  for (const c of comps) if (c.type === "switch" && c.on) uni(key(c.id, 0), key(c.id, 1));

  // süper düğümleri numarala
  const nodeIndex = {}; let N = 0;
  const nodeOf = (cid, t) => {
    const r = find(key(cid, t));
    if (!(r in nodeIndex)) nodeIndex[r] = N++;
    return nodeIndex[r];
  };
  // elemanları topla
  const bulbs = comps.filter((c) => c.type === "bulb").map((c) => ({ c, a: nodeOf(c.id, 0), b: nodeOf(c.id, 1) }));
  const batts = comps.filter((c) => c.type === "battery").map((c) => ({ c, nm: nodeOf(c.id, 0), np: nodeOf(c.id, 1) }));

  const result = { bulbI: new Map(), battI: new Map(), short: false };
  if (batts.length === 0 || N === 0) return result;

  // MNA: her pil için gizli düğüm h (ideal kaynak nm->h, iç direnç h->np)
  let extra = N;
  for (const b of batts) b.h = extra++;
  const nodes = extra;           // toplam düğüm (0 = referans/toprak)
  const M = batts.length;        // gerilim kaynağı sayısı
  const sz = (nodes - 1) + M;
  const A = Array.from({ length: sz }, () => new Array(sz + 1).fill(0));
  const gi = (n) => n - 1;       // düğüm -> matris indeksi (toprak hariç)
  const stampR = (p, q, g) => {
    for (const [x, s] of [[p, 1], [q, 1]]) if (x > 0) A[gi(x)][gi(x)] += g;
    if (p > 0 && q > 0) { A[gi(p)][gi(q)] -= g; A[gi(q)][gi(p)] -= g; }
  };
  // sızıntı (tekil matrisi önler)
  for (let n = 1; n < nodes; n++) A[gi(n)][gi(n)] += 1e-9;
  // ampuller
  for (const bl of bulbs) stampR(bl.a, bl.b, 1 / R_BULB);
  // piller: iç direnç + ideal kaynak
  batts.forEach((b, k) => {
    stampR(b.h, b.np, 1 / R_INT);           // iç direnç h--np
    const row = (nodes - 1) + k;            // kaynak akım denklemi satırı
    // kaynak nm(-) -> h(+):  V(h) - V(nm) = V_BATT
    if (b.h > 0) { A[row][gi(b.h)] += 1; A[gi(b.h)][row] += 1; }
    if (b.nm > 0) { A[row][gi(b.nm)] -= 1; A[gi(b.nm)][row] -= 1; }
    A[row][sz] = V_BATT;
  });
  const x = gauss(A, sz);
  if (!x) return result;
  const volt = (n) => (n === 0 ? 0 : x[gi(n)]);
  for (const bl of bulbs) result.bulbI.set(bl.c.id, abs(volt(bl.a) - volt(bl.b)) / R_BULB);
  batts.forEach((b, k) => {
    const j = abs(x[(nodes - 1) + k]);
    result.battI.set(b.c.id, j);
    if (j > 2.4 * I_REF) result.short = true;   // ampulsüz düşük dirençli yol
  });
  return result;
}
function gauss(A, n) {
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (abs(A[r][col]) > abs(A[piv][col])) piv = r;
    if (abs(A[piv][col]) < 1e-12) continue;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k <= n; k++) A[r][k] -= f * A[col][k];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = abs(A[i][i]) < 1e-12 ? 0 : A[i][n] / A[i][i];
  return x;
}

/* ---------- çizim ---------- */
let flow = 0;
function draw(res) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = ctx.lineCap = "round";
  flow += 0.03;

  // teller
  for (let k = 0; k < wires.length; k++) {
    const wobj = wires[k];
    const a = termPos(byId(wobj.a[0]), wobj.a[1]);
    const b = termPos(byId(wobj.b[0]), wobj.b[1]);
    ctx.strokeStyle = state.delWire === k ? "#b5432c" : "#3a4657";
    ctx.lineWidth = state.delWire === k ? 5 : 4;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    // akım noktaları (bağlı elemanlarda akım varsa)
    drawFlowDots(a, b, res);
  }
  // kablo çekiliyor
  if (state.wiring) {
    ctx.strokeStyle = "#b5432c"; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(state.wiring.pos[0], state.wiring.pos[1]);
    ctx.lineTo(state.wiring.cur[0], state.wiring.cur[1]); ctx.stroke(); ctx.setLineDash([]);
  }
  // bileşenler
  for (const c of comps) drawComp(c, res);
  // terminaller
  for (const c of comps) for (let i = 0; i < 2; i++) {
    const [tx, ty] = termPos(c, i);
    const hot = state.hover && state.hover.comp === c && state.hover.term === i;
    ctx.beginPath(); ctx.arc(tx, ty, hot ? 7 : 5, 0, TAU);
    ctx.fillStyle = "#faf8f1"; ctx.fill();
    ctx.strokeStyle = hot ? "#b5432c" : "#51607a"; ctx.lineWidth = 2; ctx.stroke();
  }
}
function drawFlowDots(a, b, res) {
  if (!res) return;
  // toplam akım varsa hareketli noktalar
  let anyI = 0; res.bulbI.forEach((v) => anyI = max(anyI, v)); res.battI.forEach((v) => anyI = max(anyI, v));
  if (anyI < 0.05) return;
  const n = 3;
  for (let i = 0; i < n; i++) {
    const t = ((flow + i / n) % 1);
    ctx.beginPath();
    ctx.arc(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 2.4, 0, TAU);
    ctx.fillStyle = "#b5432c"; ctx.fill();
  }
}
function drawComp(c, res) {
  const [w, h] = SIZE[c.type];
  ctx.save(); ctx.translate(c.x, c.y);
  // terminal bağlantı çubukları
  ctx.strokeStyle = "#3a4657"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2 - 10, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2 + 10, 0); ctx.stroke();

  if (c.type === "battery") {
    ctx.fillStyle = "#faf8f1"; ctx.strokeStyle = "#22334f"; ctx.lineWidth = 2;
    rr(-w / 2, -h / 2, w, h, 6); ctx.fill(); ctx.stroke();
    // pil plakaları
    ctx.strokeStyle = "#22334f"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-10, -h / 2 + 7); ctx.lineTo(-10, h / 2 - 7); ctx.stroke(); // uzun (+)
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(10, -h / 2 + 13); ctx.lineTo(10, h / 2 - 13); ctx.stroke(); // kısa (-)
    ctx.fillStyle = "#22334f"; ctx.font = '700 15px Inter'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("+", -24, 0); ctx.fillText("–", 26, 0);
  } else if (c.type === "bulb") {
    const I = res ? (res.bulbI.get(c.id) || 0) : 0;
    const br = min(1.3, I / I_REF);
    if (br > 0.05) { // hale
      const g = ctx.createRadialGradient(0, 0, 3, 0, 0, 34);
      g.addColorStop(0, `rgba(255,214,90,${0.55 * br})`); g.addColorStop(1, "rgba(255,214,90,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU);
    ctx.fillStyle = br > 0.05 ? `rgb(${255},${round(214 + 30 * br)},${round(90 + 60 * br)})` : "#e8e4d6";
    ctx.fill(); ctx.strokeStyle = "#22334f"; ctx.lineWidth = 2; ctx.stroke();
    // filaman
    ctx.strokeStyle = br > 0.05 ? "#b5432c" : "#8b8e96"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-8, 6); ctx.lineTo(-3, -5); ctx.lineTo(0, 5); ctx.lineTo(3, -5); ctx.lineTo(8, 6); ctx.stroke();
  } else { // switch
    ctx.fillStyle = "#faf8f1"; ctx.strokeStyle = "#22334f"; ctx.lineWidth = 2;
    rr(-w / 2, -h / 2, w, h, 6); ctx.fill(); ctx.stroke();
    // kontaklar
    ctx.fillStyle = "#22334f";
    ctx.beginPath(); ctx.arc(-16, 0, 3.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(16, 0, 3.5, 0, TAU); ctx.fill();
    // kol
    ctx.strokeStyle = c.on ? "#3f7d6d" : "#b5432c"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(c.on ? 16 : 10, c.on ? 0 : -14); ctx.stroke();
    ctx.fillStyle = c.on ? "#3f7d6d" : "#b5432c"; ctx.font = '600 9px "IBM Plex Mono"';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(c.on ? "AÇIK" : "KAPALI", 0, h / 2 + 9);
  }
  ctx.restore();
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/* ---------- görevler + durum ---------- */
function checkChallenges(res) {
  const lit = comps.filter((c) => c.type === "bulb" && (res.bulbI.get(c.id) || 0) / I_REF > 0.25);
  const bright = lit.filter((c) => (res.bulbI.get(c.id) || 0) / I_REF > 0.8);
  if (lit.length >= 1) markCh("light");
  if (lit.length >= 2) markCh("two");
  if (comps.some((c) => c.type === "switch") && lit.length >= 1 && comps.some((c) => c.type === "switch" && c.on)) markCh("switch");
  if (bright.length >= 2) markCh("parallel");
  const dim = lit.filter((c) => { const b = (res.bulbI.get(c.id) || 0) / I_REF; return b > 0.15 && b < 0.6; });
  if (dim.length >= 2) markCh("series");

  const st = document.getElementById("status");
  if (res.short) { st.textContent = "⚠ Kısa devre! Pil çabuk biter — araya ampul koy."; st.className = "status short"; }
  else if (lit.length) { st.textContent = `💡 ${lit.length} ampul yanıyor`; st.className = "status"; }
  else { st.textContent = ""; st.className = "status"; }
}
function markCh(key) {
  if (done[key]) return;
  done[key] = true;
  const el = document.querySelector(`.ch[data-ch="${key}"]`);
  el.classList.add("done"); el.textContent = "✓ " + el.textContent.slice(2);
}

/* ---------- döngü ---------- */
function loop() {
  const res = solve();
  draw(res);
  checkChallenges(res);
  requestAnimationFrame(loop);
}

/* ---------- etkileşim ---------- */
function pos(ev) {
  const r = canvas.getBoundingClientRect();
  const s = ev.touches ? ev.touches[0] : ev;
  return [s.clientX - r.left, s.clientY - r.top];
}
function down(ev) {
  ev.preventDefault();
  const [x, y] = pos(ev);
  if (state.mode === "del") {
    const wk = wireAt(x, y);
    if (wk >= 0) { wires.splice(wk, 1); return; }
    const c = compAt(x, y);
    if (c) { comps = comps.filter((k) => k !== c); wires = wires.filter((w) => w.a[0] !== c.id && w.b[0] !== c.id); }
    return;
  }
  const term = termAt(x, y);
  if (term) { state.wiring = { comp: term.comp, term: term.term, pos: term.pos, cur: [x, y], moved: false }; return; }
  const c = compAt(x, y);
  if (c) { state.drag = { c, dx: x - c.x, dy: y - c.y, moved: false, down: [x, y] }; return; }
}
function move(ev) {
  const [x, y] = pos(ev);
  state.hover = termAt(x, y);
  if (state.wiring) { state.wiring.cur = [x, y]; state.wiring.moved = true; }
  else if (state.drag) {
    state.drag.c.x = max(50, min(W - 50, x - state.drag.dx));
    state.drag.c.y = max(40, min(H - 40, y - state.drag.dy));
    if (hypot(x - state.drag.down[0], y - state.drag.down[1]) > 4) state.drag.moved = true;
  }
  if (state.mode === "del") state.delWire = wireAt(x, y);
}
function up(ev) {
  const [x, y] = pos(ev);
  if (state.wiring) {
    const term = termAt(x, y);
    if (term && !(term.comp === state.wiring.comp && term.term === state.wiring.term)) {
      wires.push({ a: [state.wiring.comp.id, state.wiring.term], b: [term.comp.id, term.term] });
      document.getElementById("hint").style.display = "none";
    }
    state.wiring = null; return;
  }
  if (state.drag) {
    if (!state.drag.moved && state.drag.c.type === "switch") state.drag.c.on = !state.drag.c.on;
    state.drag = null;
  }
}
canvas.addEventListener("mousedown", down);
canvas.addEventListener("mousemove", move);
window.addEventListener("mouseup", up);
canvas.addEventListener("touchstart", down, { passive: false });
canvas.addEventListener("touchmove", (e) => { e.preventDefault(); move(e); }, { passive: false });
canvas.addEventListener("touchend", up);

/* ---------- palet / araçlar ---------- */
let addOffset = 0;
document.querySelectorAll("[data-add]").forEach((b) =>
  b.addEventListener("click", () => {
    const type = b.dataset.add;
    addOffset = (addOffset + 1) % 5;
    comps.push({ id: ++seq, type, x: W / 2 + (addOffset - 2) * 30, y: H / 2 + (addOffset - 2) * 24, on: type === "switch" ? false : undefined });
    document.getElementById("hint").style.display = "none";
  })
);
const delBtn = document.getElementById("delBtn");
delBtn.addEventListener("click", () => {
  state.mode = state.mode === "del" ? "wire" : "del";
  delBtn.classList.toggle("active", state.mode === "del");
  canvas.style.cursor = state.mode === "del" ? "not-allowed" : "pointer";
});
document.getElementById("clearBtn").addEventListener("click", () => {
  comps = []; wires = []; state.mode = "wire"; delBtn.classList.remove("active"); canvas.style.cursor = "pointer";
  document.getElementById("hint").style.display = "";
});

/* ---------- sayfa geçişi + modal ---------- */
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("a.page-link");
  if (!a || !a.getAttribute("href") || a.target === "_blank") return;
  ev.preventDefault(); document.body.classList.add("leaving");
  setTimeout(() => (location.href = a.href), 240);
});
(() => {
  const m = document.getElementById("infoModal"), b = document.getElementById("infoBtn");
  b.addEventListener("click", () => (m.hidden = false));
  document.getElementById("infoClose").addEventListener("click", () => (m.hidden = true));
  m.addEventListener("click", (ev) => { if (ev.target === m) m.hidden = true; });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") m.hidden = true; });
})();

/* ---------- başlangıç: örnek devre (layout hazır olunca) ---------- */
function init() {
  resize();
  if (W < 60) { requestAnimationFrame(init); return; }  // layout henüz hazır değil
  comps.push(
    { id: ++seq, type: "battery", x: W / 2, y: H * 0.68 },
    { id: ++seq, type: "bulb", x: W / 2, y: H * 0.3 },
    { id: ++seq, type: "switch", x: max(80, W / 2 - 160), y: H * 0.5, on: false }
  );
  loop();
}
init();
