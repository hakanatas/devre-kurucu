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
const done = { light: false, switch: false, two: false, parallel: false, series: false, measure: false };

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
  comps.forEach((c) => { c.x = max(50, min(W - 50, c.x)); c.y = max(40, min(H - 40, c.y)); }); // viewport içinde tut
}
window.addEventListener("resize", resize);

/* ---------- bileşen geometrisi ---------- */
const SIZE = { battery: [86, 44], bulb: [52, 52], switch: [74, 40], ammeter: [50, 50] };
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
function termAt(x, y, rad = 22) {
  let best = null, bd = rad;
  for (const c of comps) for (let i = 0; i < 2; i++) {
    const [tx, ty] = termPos(c, i);
    const d = hypot(x - tx, y - ty);
    if (d < bd) { bd = d; best = { comp: c, term: i, pos: [tx, ty] }; }
  }
  return best;
}
// bir terminalin bağlı olup olmadığı (dolu göstermek için)
function isConnected(cid, term) {
  return wires.some((w) => (w.a[0] === cid && w.a[1] === term) || (w.b[0] === cid && w.b[1] === term));
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
  const ammeters = comps.filter((c) => c.type === "ammeter").map((c) => ({ c, na: nodeOf(c.id, 0), nb: nodeOf(c.id, 1) }));

  const result = { bulbI: new Map(), battI: new Map(), ammI: new Map(), short: false };
  if (batts.length === 0 || N === 0) return result;

  // MNA: her pil için gizli düğüm h (ideal kaynak nm->h, iç direnç h->np)
  let extra = N;
  for (const b of batts) b.h = extra++;
  const nodes = extra;                       // toplam düğüm (0 = referans/toprak)
  const M = batts.length + ammeters.length;  // gerilim kaynağı sayısı (pil + 0V ampermetre)
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
  // ampermetreler: 0V gerilim kaynağı (ideal tel + akım ölçer)
  ammeters.forEach((am, k) => {
    const row = (nodes - 1) + batts.length + k;
    if (am.na > 0) { A[row][gi(am.na)] += 1; A[gi(am.na)][row] += 1; }
    if (am.nb > 0) { A[row][gi(am.nb)] -= 1; A[gi(am.nb)][row] -= 1; }
    A[row][sz] = 0;
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
  ammeters.forEach((am, k) => result.ammI.set(am.c.id, abs(x[(nodes - 1) + batts.length + k])));
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

  // teller (dik açılı / Manhattan)
  for (let k = 0; k < wires.length; k++) {
    const wobj = wires[k];
    const pts = wirePath(termPos(byId(wobj.a[0]), wobj.a[1]), termPos(byId(wobj.b[0]), wobj.b[1]));
    ctx.strokeStyle = state.delWire === k ? "#b5432c" : "#3a4657";
    ctx.lineWidth = state.delWire === k ? 5 : 4;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    drawFlowDots(pts, res);
  }
  // kablo çekiliyor (uç hedefe yapışır)
  if (state.wiring) {
    const tgt = state.wiring.target;
    const end = tgt ? tgt.pos : state.wiring.cur;
    ctx.strokeStyle = "#b5432c"; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(state.wiring.pos[0], state.wiring.pos[1]);
    ctx.lineTo(end[0], end[1]); ctx.stroke(); ctx.setLineDash([]);
  }
  // bileşenler
  for (const c of comps) drawComp(c, res);
  // terminaller (bağlı = dolu; kablo hedefi = yeşil vurgu)
  const wt = state.wiring && state.wiring.target;
  for (const c of comps) for (let i = 0; i < 2; i++) {
    const [tx, ty] = termPos(c, i);
    const isTarget = wt && wt.comp === c && wt.term === i;
    const isSource = state.wiring && state.wiring.comp === c && state.wiring.term === i;
    const hot = isTarget || isSource || (!state.wiring && state.hover && state.hover.comp === c && state.hover.term === i);
    const conn = isConnected(c.id, i);
    ctx.beginPath(); ctx.arc(tx, ty, isTarget ? 10 : hot ? 8 : 5.5, 0, TAU);
    ctx.fillStyle = isTarget ? "#3f7d6d" : conn ? "#3a4657" : "#faf8f1";
    ctx.fill();
    ctx.strokeStyle = isTarget ? "#3f7d6d" : hot ? "#b5432c" : "#51607a";
    ctx.lineWidth = isTarget ? 3 : 2; ctx.stroke();
  }
}
function wirePath(a, b) {
  const mx = (a[0] + b[0]) / 2;
  return [a, [mx, a[1]], [mx, b[1]], b];
}
function drawFlowDots(pts, res) {
  if (!res) return;
  let anyI = 0; res.bulbI.forEach((v) => anyI = max(anyI, v)); res.battI.forEach((v) => anyI = max(anyI, v));
  if (anyI < 0.05) return;
  const segs = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); total += d; }
  if (total < 1) return;
  const n = max(2, Math.round(total / 60));
  ctx.fillStyle = "#b5432c";
  for (let i = 0; i < n; i++) {
    let dist = ((flow + i / n) % 1) * total, s = 0;
    while (s < segs.length - 1 && dist > segs[s]) { dist -= segs[s]; s++; }
    const t = segs[s] ? dist / segs[s] : 0;
    ctx.beginPath();
    ctx.arc(pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t, 2.4, 0, TAU);
    ctx.fill();
  }
}
function drawComp(c, res) {
  const [w, h] = SIZE[c.type];
  ctx.save(); ctx.translate(c.x, c.y);
  // kısa devrede pil titrer
  const shortB = res && res.short && c.type === "battery";
  if (shortB) ctx.translate((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4);
  // terminal bağlantı çubukları
  ctx.strokeStyle = "#3a4657"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2 - 10, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2 + 10, 0); ctx.stroke();

  if (c.type === "battery") {
    ctx.fillStyle = shortB ? "#f6d7cf" : "#faf8f1"; ctx.strokeStyle = shortB ? "#b5432c" : "#22334f"; ctx.lineWidth = 2;
    rr(-w / 2, -h / 2, w, h, 6); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#22334f"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-10, -h / 2 + 7); ctx.lineTo(-10, h / 2 - 7); ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(10, -h / 2 + 13); ctx.lineTo(10, h / 2 - 13); ctx.stroke();
    ctx.fillStyle = "#22334f"; ctx.font = '700 15px Inter'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("+", -24, 0); ctx.fillText("–", 26, 0);
    if (shortB) { // kıvılcımlar
      ctx.strokeStyle = "#f0a500"; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * TAU, r0 = h / 2, r1 = h / 2 + 6 + Math.random() * 10;
        ctx.beginPath(); ctx.moveTo(r0 * Math.cos(a), r0 * Math.sin(a)); ctx.lineTo(r1 * Math.cos(a), r1 * Math.sin(a)); ctx.stroke();
      }
    }
  } else if (c.type === "bulb") {
    const I = res ? (res.bulbI.get(c.id) || 0) : 0;
    const br = min(1.3, I / I_REF);
    if (br > 0.05) {
      const fl = 1 + 0.04 * Math.sin(flow * 30); // hafif titreşen ışık
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 40 * fl);
      g.addColorStop(0, `rgba(255,210,80,${0.6 * br})`); g.addColorStop(1, "rgba(255,210,80,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 40 * fl, 0, TAU); ctx.fill();
      // ışınlar
      ctx.strokeStyle = `rgba(240,165,0,${0.5 * br})`; ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(24 * Math.cos(a), 24 * Math.sin(a)); ctx.lineTo(30 * Math.cos(a), 30 * Math.sin(a)); ctx.stroke(); }
    }
    // duy (vida)
    ctx.fillStyle = "#9aa0ad"; ctx.strokeStyle = "#22334f"; ctx.lineWidth = 1.5;
    rr(-7, 13, 14, 12, 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#6b7280"; ctx.lineWidth = 1;
    for (let y = 16; y <= 22; y += 3) { ctx.beginPath(); ctx.moveTo(-7, y); ctx.lineTo(7, y); ctx.stroke(); }
    // cam (armut)
    ctx.beginPath(); ctx.arc(0, -2, 17, 0, TAU);
    ctx.fillStyle = br > 0.05 ? `rgb(255,${round(210 + 35 * br)},${round(110 + 90 * br)})` : "#e8e4d6";
    ctx.fill(); ctx.strokeStyle = "#22334f"; ctx.lineWidth = 2; ctx.stroke();
    // filaman
    ctx.strokeStyle = br > 0.05 ? "#c0392b" : "#8b8e96"; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(-3, -8); ctx.lineTo(0, 2); ctx.lineTo(3, -8); ctx.lineTo(8, 4); ctx.stroke();
    // cam parlaması
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(-6, -8, 3, 0, TAU); ctx.fill();
    // parlaklık etiketi
    ctx.fillStyle = br > 0.05 ? "#b5432c" : "#8b8e96"; ctx.font = '600 10px "IBM Plex Mono"';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("%" + round(min(100, br * 100)), 0, 34);
  } else if (c.type === "ammeter") {
    const I = res ? (res.ammI.get(c.id) || 0) : 0;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU);
    ctx.fillStyle = "#faf8f1"; ctx.fill(); ctx.strokeStyle = "#22334f"; ctx.lineWidth = 2; ctx.stroke();
    // kadran yayı
    ctx.strokeStyle = "#c9c3b4"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 4, 15, PI * 1.15, PI * 1.85); ctx.stroke();
    // ibre (akıma göre döner)
    const frac = min(1, I / (2.2 * I_REF));
    const ang = PI * 1.15 + frac * (PI * 0.7);
    ctx.strokeStyle = "#b5432c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(14 * Math.cos(ang), 4 + 14 * Math.sin(ang)); ctx.stroke();
    ctx.fillStyle = "#22334f"; ctx.beginPath(); ctx.arc(0, 4, 2.5, 0, TAU); ctx.fill();
    // A harfi + değer
    ctx.fillStyle = "#22334f"; ctx.font = '700 12px Inter'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("A", 0, -11);
    ctx.fillStyle = "#b5432c"; ctx.font = '600 10px "IBM Plex Mono"';
    ctx.fillText(I.toFixed(2) + " A", 0, 33);
  } else { // switch
    ctx.fillStyle = "#faf8f1"; ctx.strokeStyle = "#22334f"; ctx.lineWidth = 2;
    rr(-w / 2, -h / 2, w, h, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#22334f";
    ctx.beginPath(); ctx.arc(-16, 0, 3.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(16, 0, 3.5, 0, TAU); ctx.fill();
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
  let ammMax = 0; res.ammI.forEach((v) => ammMax = max(ammMax, v));
  if (ammMax > 0.1) markCh("measure");

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
  if (state.wiring) {
    state.wiring.cur = [x, y]; state.wiring.moved = true;
    const t = termAt(x, y, 26);   // hedef: kaynaktan farklı en yakın terminal
    state.wiring.target = (t && !(t.comp === state.wiring.comp && t.term === state.wiring.term)) ? t : null;
    state.hover = null;
  } else if (state.drag) {
    state.drag.c.x = max(50, min(W - 50, x - state.drag.dx));
    state.drag.c.y = max(40, min(H - 40, y - state.drag.dy));
    if (hypot(x - state.drag.down[0], y - state.drag.down[1]) > 4) state.drag.moved = true;
  } else {
    state.hover = termAt(x, y);
  }
  if (state.mode === "del") state.delWire = wireAt(x, y);
}
function wireExists(a0, a1, b0, b1) {
  return wires.some((w) => (w.a[0] === a0 && w.a[1] === a1 && w.b[0] === b0 && w.b[1] === b1) ||
                           (w.a[0] === b0 && w.a[1] === b1 && w.b[0] === a0 && w.b[1] === a1));
}
function up(ev) {
  if (state.wiring) {
    const t = state.wiring.target;   // son move'da belirlenen hedef (dokunmatik uyumlu)
    const s = state.wiring;
    if (t && !wireExists(s.comp.id, s.term, t.comp.id, t.term)) {
      wires.push({ a: [s.comp.id, s.term], b: [t.comp.id, t.term] });
      document.getElementById("hint").style.display = "none";
    }
    state.wiring = null; return;
  }
  if (state.drag) {
    const c = state.drag.c;
    if (!state.drag.moved && c.type === "switch") c.on = !c.on;
    else if (state.drag.moved) { c.x = Math.round(c.x / 22) * 22; c.y = Math.round(c.y / 22) * 22; } // ızgaraya yasla
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
