'use strict';
/* Mon plan : on photographie un plan, on le redresse, on indique où on est et où on va.
   Calage : on marche jusqu'à un repère et on le touche sur le plan. Le vecteur parcouru
   (pas × boussole) comparé au vecteur sur le plan donne l'échelle (m/px) et l'orientation.
   Ensuite chaque pas fait avancer le triangle dans la direction de la boussole. */

const $ = (s) => document.querySelector(s);
const STEP_M = 0.7;          // longueur de pas supposée : elle s'annule au calage (même valeur pour mesurer et pour avancer)
const STEP_SEUIL = 1.1;      // m/s² au-dessus de la moyenne pour compter un pas
const ARRIVEE_M = 10;
const DEMO = new URLSearchParams(location.search).has('demo');
const RAD = Math.PI / 180;
const wrapRad = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const wrapDeg = (a) => ((a % 360) + 540) % 360 - 180;

/* ---------- Stockage (IndexedDB) ---------- */
const db = {
  open() {
    return this._p || (this._p = new Promise((res, rej) => {
      const r = indexedDB.open('mon-plan', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('plans', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async run(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction('plans', mode);
      const req = fn(t.objectStore('plans'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.run('readonly', (s) => s.getAll()); },
  put(p) { return this.run('readwrite', (s) => s.put(p)); },
  del(id) { return this.run('readwrite', (s) => s.delete(id)); },
};

/* ---------- Petits outils d'interface ---------- */
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}
let toastTimer;
function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function busy(on, txt) { $('#busy').hidden = !on; if (txt) $('#busy-t').textContent = txt; }
const toBlob = (c, q) => new Promise((res) => c.toBlob(res, 'image/jpeg', q));
const ICON_TRASH = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

/* ---------- Accueil ---------- */
async function renderList() {
  let plans = [];
  try { plans = (await db.all()).sort((a, b) => b.date - a.date); } catch (e) { console.warn(e); }
  const ul = $('#liste'); ul.textContent = '';
  $('#liste-vide').hidden = plans.length > 0;
  for (const p of plans) {
    const li = document.createElement('li');
    const btn = document.createElement('button'); btn.className = 'plan-item';
    const img = document.createElement('img'); img.alt = ''; img.src = URL.createObjectURL(p.thumb || p.image);
    const txt = document.createElement('span'); txt.className = 'plan-txt';
    const n = document.createElement('strong'); n.textContent = p.name;
    const st = document.createElement('small'); st.textContent = p.cal ? 'Calé · prêt à guider' : 'Pas encore calé';
    txt.append(n, st); btn.append(img, txt);
    btn.addEventListener('click', () => openPlan(p));
    const del = document.createElement('button'); del.className = 'del';
    del.setAttribute('aria-label', 'Supprimer ' + p.name); del.innerHTML = ICON_TRASH;
    del.addEventListener('click', async () => {
      if (!confirm(`Supprimer « ${p.name} » ?`)) return;
      await db.del(p.id); renderList();
    });
    li.append(btn, del); ul.append(li);
  }
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
for (const inp of [$('#in-photo'), $('#in-galerie')]) {
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; inp.value = '';
    if (!f) return;
    busy(true, 'Ouverture de la photo…');
    try { startRectify(await loadImage(f)); }
    catch (e) { console.error(e); toast('Impossible d’ouvrir cette image.'); }
    finally { busy(false); }
  });
}

/* ---------- Redresser (homographie 4 coins) ---------- */
const R = { src: null, q: null, fit: null, drag: -1, ctx: $('#rcv').getContext('2d') };

function startRectify(c) {
  R.src = c; const w = c.width, h = c.height, m = 0.06;
  R.q = [[w * m, h * m], [w * (1 - m), h * m], [w * (1 - m), h * (1 - m)], [w * m, h * (1 - m)]];
  $('#nom').value = '';
  show('redresser');
  requestAnimationFrame(rResize);
}
function rResize() {
  if (!R.src || $('#redresser').hidden) return;
  const cv = $('#rcv'), r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  R.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = 22, k = Math.min((r.width - 2 * pad) / R.src.width, (r.height - 2 * pad) / R.src.height);
  R.fit = { k, ox: (r.width - R.src.width * k) / 2, oy: (r.height - R.src.height * k) / 2, w: r.width, h: r.height };
  rDraw();
}
const rToScreen = ([x, y]) => [R.fit.ox + x * R.fit.k, R.fit.oy + y * R.fit.k];
const rToImg = (x, y) => [
  Math.min(R.src.width, Math.max(0, (x - R.fit.ox) / R.fit.k)),
  Math.min(R.src.height, Math.max(0, (y - R.fit.oy) / R.fit.k))];

function rDraw() {
  const c = R.ctx, f = R.fit; if (!f) return;
  c.clearRect(0, 0, f.w, f.h);
  c.drawImage(R.src, f.ox, f.oy, R.src.width * f.k, R.src.height * f.k);
  const pts = R.q.map(rToScreen);
  // assombrir hors du quadrilatère
  c.beginPath(); c.rect(0, 0, f.w, f.h);
  pts.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.closePath();
  c.fillStyle = 'rgba(0,0,0,.5)'; c.fill('evenodd');
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.closePath();
  c.lineWidth = 2; c.strokeStyle = '#FFD43B'; c.stroke();
  pts.forEach((p, i) => {
    c.beginPath(); c.arc(p[0], p[1], i === R.drag ? 16 : 13, 0, 7);
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#FFD43B'; c.stroke();
  });
  if (R.drag >= 0) { // loupe pour placer précisément
    const p = pts[R.drag], S = 120, Z = 3, src = S / (f.k * Z);
    const lx = p[0] < f.w / 2 ? f.w - S - 12 : 12, ly = 12;
    c.save(); c.beginPath(); c.arc(lx + S / 2, ly + S / 2, S / 2, 0, 7); c.clip();
    c.fillStyle = '#000'; c.fillRect(lx, ly, S, S);
    const [ix, iy] = R.q[R.drag];
    c.drawImage(R.src, ix - src / 2, iy - src / 2, src, src, lx, ly, S, S);
    c.strokeStyle = '#FFD43B'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(lx + S / 2, ly + 10); c.lineTo(lx + S / 2, ly + S - 10);
    c.moveTo(lx + 10, ly + S / 2); c.lineTo(lx + S - 10, ly + S / 2); c.stroke();
    c.restore();
    c.beginPath(); c.arc(lx + S / 2, ly + S / 2, S / 2, 0, 7); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
  }
}
{
  const cv = $('#rcv');
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 50;
    R.q.forEach((q, i) => { const [sx, sy] = rToScreen(q), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    R.drag = best; cv.setPointerCapture(e.pointerId); rDraw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (R.drag < 0) return;
    const r = cv.getBoundingClientRect();
    R.q[R.drag] = rToImg(e.clientX - r.left, e.clientY - r.top); rDraw();
  });
  const up = () => { if (R.drag >= 0) { R.drag = -1; rDraw(); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}

function solve(A, b) { // Gauss avec pivot partiel
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}
function warp(src, q) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.max(d(q[0], q[1]), d(q[3], q[2])), H = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const k = Math.min(1, 2600 / Math.max(W, H)); W = Math.max(2, Math.round(W * k)); H = Math.max(2, Math.round(H * k));
  const h = homography([[0, 0], [W, 0], [W, H], [0, H]], q); // sortie -> photo
  const sw = src.width, sh = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'), od = octx.createImageData(W, H), o = od.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = h[6] * x + h[7] * y + 1;
      const sx = (h[0] * x + h[1] * y + h[2]) / den, sy = (h[3] * x + h[4] * y + h[5]) / den;
      const i = (y * W + x) * 4, x0 = Math.floor(sx), y0 = Math.floor(sy);
      o[i + 3] = 255;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[i] = o[i + 1] = o[i + 2] = 255; continue; }
      const fx = sx - x0, fy = sy - y0, p = (y0 * sw + x0) * 4, p2 = p + sw * 4;
      for (let c = 0; c < 3; c++) {
        o[i + c] = (sd[p + c] * (1 - fx) + sd[p + 4 + c] * fx) * (1 - fy) + (sd[p2 + c] * (1 - fx) + sd[p2 + 4 + c] * fx) * fy;
      }
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

async function finishImport(canvas) {
  const name = $('#nom').value.trim() || 'Plan du ' + new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const t = document.createElement('canvas'), k = 160 / Math.max(canvas.width, canvas.height);
  t.width = Math.round(canvas.width * k); t.height = Math.round(canvas.height * k);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  const plan = { id: Date.now().toString(36), name, date: Date.now(), image: await toBlob(canvas, 0.88), thumb: await toBlob(t, 0.8), cal: null };
  try { await db.put(plan); } catch (e) { console.warn(e); toast('Le plan n’a pas pu être enregistré, mais vous pouvez l’utiliser.'); }
  openPlan(plan, canvas);
}
$('#r-retour').addEventListener('click', () => { show('accueil'); renderList(); });
$('#r-ok').addEventListener('click', () => {
  busy(true, 'Redressement…');
  setTimeout(async () => {
    try { await finishImport(warp(R.src, R.q)); }
    catch (e) { console.error(e); toast('Le redressement a échoué.'); }
    finally { busy(false); }
  }, 40);
});
$('#r-tel').addEventListener('click', () => finishImport(R.src));

/* ---------- Capteurs : boussole et pas ---------- */
const S = {
  plan: null, img: null, view: { k: 1, tx: 0, ty: 0 }, kmin: 0.1, kmax: 8,
  mode: '', temp: null, start: null, dest: null, pos: null, lastFix: null,
  cal: null, heading: null, steps: 0, calSteps: 0, calW: [0, 0], segW: [0, 0],
  trail: [], follow: true, arrived: false,
};
let sensorsOn = false, wake = null;

async function startSensors() {
  if (sensorsOn) return true;
  if (DEMO) { sensorsOn = true; S.heading = +$('#demo-cap').value; $('#demo').hidden = false; return true; }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('refus');
    }
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      if (await DeviceMotionEvent.requestPermission() !== 'granted') throw new Error('refus');
    }
  } catch (e) {
    toast('Autorisez l’accès « Mouvements et orientation » pour que l’appli suive vos pas (Réglages › Safari, ou rouvrez la page).', 7000);
    return false;
  }
  if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', onOrient);
  else addEventListener('deviceorientation', onOrient);
  addEventListener('devicemotion', onMotion);
  sensorsOn = true; keepAwake();
  setTimeout(() => { if (S.heading == null) toast('La boussole ne répond pas. Ouvrez l’appli dans Safari et vérifiez l’autorisation « Mouvements et orientation ».', 7000); }, 3000);
  return true;
}
async function keepAwake() { try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* pas grave */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sensorsOn && !DEMO) keepAwake(); });

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  if (S.heading == null) S.heading = h;
  else S.heading = (S.heading + 0.25 * wrapDeg(h - S.heading) + 360) % 360; // lissage circulaire
  schedule();
}
const SD = { fast: null, slow: null, armed: true, last: 0 };
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const m = Math.hypot(a.x, a.y, a.z), t = performance.now();
  if (SD.fast == null) { SD.fast = SD.slow = m; return; }
  SD.fast += 0.35 * (m - SD.fast);
  SD.slow += 0.02 * (m - SD.slow);
  const d = SD.fast - SD.slow;
  if (SD.armed && d > STEP_SEUIL && t - SD.last > 300) { SD.armed = false; SD.last = t; onStep(); }
  else if (!SD.armed && d < 0.2) SD.armed = true;
}

function onStep() {
  if (S.heading == null || !S.plan) return;
  S.steps++;
  const h = S.heading * RAD, e = STEP_M * Math.sin(h), n = STEP_M * Math.cos(h);
  if (S.mode === 'calage' || S.mode === 'repere') { S.calSteps++; S.calW[0] += e; S.calW[1] += n; }
  if (S.cal && S.pos && ['nav', 'fix', 'newdest'].includes(S.mode)) {
    S.segW[0] += e; S.segW[1] += n;
    const a = h + S.cal.off, d = STEP_M / S.cal.s;
    S.pos = [S.pos[0] + d * Math.sin(a), S.pos[1] - d * Math.cos(a)];
    S.trail.push(S.pos.slice());
    if (S.follow) centerOn(S.pos);
  }
  schedule();
}

/* Calage : à partir d'un point de départ A, d'un repère B touché sur le plan et du vecteur marché W (est, nord en mètres). */
function computeCal(A, B, W) {
  const px = Math.hypot(B[0] - A[0], B[1] - A[1]), m = Math.hypot(W[0], W[1]);
  if (px < 8 || m < 8) return null;
  const bp = Math.atan2(B[0] - A[0], -(B[1] - A[1])); // direction sur le plan (sens horaire depuis le haut)
  const bw = Math.atan2(W[0], W[1]);                   // direction réelle (sens horaire depuis le nord)
  return { s: m / px, off: wrapRad(bp - bw) };
}

/* ---------- Vue du plan (déplacement, zoom) ---------- */
const cv = $('#cv'), ctx = cv.getContext('2d');
let W0 = 0, H0 = 0;

async function openPlan(p, canvas) {
  S.plan = p;
  if (canvas) S.img = canvas;
  else {
    busy(true, 'Ouverture du plan…');
    try {
      const url = URL.createObjectURL(p.image), img = new Image(); img.src = url; await img.decode();
      S.img = img; URL.revokeObjectURL(url);
    } finally { busy(false); }
  }
  Object.assign(S, { temp: null, start: null, dest: null, pos: null, lastFix: null, cal: p.cal ? { ...p.cal } : null,
    calSteps: 0, calW: [0, 0], segW: [0, 0], trail: [], follow: true, arrived: false });
  show('carte');
  resize(); fitView();
  setMode('depart');
}
function iw() { return S.img.naturalWidth || S.img.width; }
function ih() { return S.img.naturalHeight || S.img.height; }
function resize() {
  if ($('#carte').hidden) return;
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  W0 = r.width; H0 = r.height;
  cv.width = Math.round(W0 * dpr); cv.height = Math.round(H0 * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  schedule();
}
function visibleBox() {
  const top = $('#banner').getBoundingClientRect().bottom, bottom = $('#sheet').getBoundingClientRect().top;
  return { top, bottom: Math.max(top + 100, bottom) };
}
function fitView() {
  const b = visibleBox(), h = b.bottom - b.top - 20, w = W0 - 20;
  const k = Math.min(w / iw(), h / ih());
  S.kmin = k * 0.6; S.kmax = Math.max(k * 12, 4);
  S.view = { k, tx: (W0 - iw() * k) / 2, ty: b.top + (b.bottom - b.top - ih() * k) / 2 };
  schedule();
}
function centerOn(p) {
  const b = visibleBox(), v = S.view;
  v.tx = W0 / 2 - p[0] * v.k; v.ty = (b.top + b.bottom) / 2 - p[1] * v.k;
}
function zoomAt(x, y, f) {
  const v = S.view, k = Math.min(Math.max(v.k * f, S.kmin), S.kmax); f = k / v.k;
  v.tx = x - (x - v.tx) * f; v.ty = y - (y - v.ty) * f; v.k = k;
}
const toPlan = (x, y) => [(x - S.view.tx) / S.view.k, (y - S.view.ty) / S.view.k];
const toScreen = (p) => [p[0] * S.view.k + S.view.tx, p[1] * S.view.k + S.view.ty];

const ptrs = new Map(); let tap = null;
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tap = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
});
cv.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  const before = [...ptrs.values()].map((p) => ({ ...p }));
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const after = [...ptrs.values()];
  if (after.length === 1) {
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) return;
    if (tap) tap.moved = true;
    S.view.tx += after[0].x - before[0].x; S.view.ty += after[0].y - before[0].y;
  } else {
    const mid = (a) => ({ x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 });
    const dist = (a) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
    const m0 = mid(before), m1 = mid(after);
    zoomAt(m0.x, m0.y, dist(after) / dist(before));
    S.view.tx += m1.x - m0.x; S.view.ty += m1.y - m0.y;
  }
  setFollow(false); schedule();
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (e.type === 'pointerup' && tap && !tap.moved && ptrs.size === 0 && performance.now() - tap.t < 500) onTap(toPlan(e.clientX, e.clientY));
  if (ptrs.size === 0) tap = null;
}
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002)); setFollow(false); schedule(); }, { passive: false });
addEventListener('resize', () => { resize(); rResize(); });

function setFollow(on) {
  S.follow = on;
  $('#recentrer').hidden = on || !S.pos || !S.cal || !['nav', 'fix', 'newdest'].includes(S.mode);
}
$('#recentrer').addEventListener('click', () => { setFollow(true); if (S.pos) centerOn(S.pos); schedule(); });

function onTap(p) {
  if (!['depart', 'dest', 'repere', 'fix', 'newdest'].includes(S.mode)) return;
  S.temp = [Math.min(iw(), Math.max(0, p[0])), Math.min(ih(), Math.max(0, p[1]))];
  const ok = $('#actions [data-confirm]'); if (ok) ok.disabled = false;
  schedule();
}

/* ---------- Dessin ---------- */
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); updateUI(); }); }

function draw() {
  if (!S.img || $('#carte').hidden) return;
  ctx.clearRect(0, 0, W0, H0);
  const v = S.view;
  ctx.save(); ctx.translate(v.tx, v.ty); ctx.scale(v.k, v.k);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(S.img, 0, 0);
  ctx.restore();

  const navLike = ['nav', 'fix', 'newdest'].includes(S.mode);
  // chemin parcouru
  if (S.trail.length > 1) {
    ctx.beginPath();
    S.trail.forEach((p, i) => { const [x, y] = toScreen(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.setLineDash([2, 9]); ctx.lineCap = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(40,50,70,.65)'; ctx.stroke(); ctx.setLineDash([]);
  }
  // ligne vers la destination (à vol d'oiseau)
  if (navLike && S.pos && S.dest && !S.arrived) {
    const [x1, y1] = toScreen(S.pos), [x2, y2] = toScreen(S.dest);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.setLineDash([10, 8]); ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(21,87,192,.85)'; ctx.stroke(); ctx.setLineDash([]);
  }
  // segment de calage
  if ((S.mode === 'repere') && S.start && S.temp) {
    const [x1, y1] = toScreen(S.start), [x2, y2] = toScreen(S.temp);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.setLineDash([7, 6]); ctx.lineWidth = 4; ctx.strokeStyle = '#1557C0'; ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.dest && S.mode !== 'newdest') drawPin(toScreen(S.dest), '#D9480F');
  if (['calage', 'repere'].includes(S.mode) && S.start) drawRing(toScreen(S.start), 9);

  // position de l'utilisateur
  const ang = S.cal && S.heading != null ? S.heading * RAD + S.cal.off : null;
  if (S.mode === 'dest' && S.start) drawUser(toScreen(S.start), null);
  else if (S.mode === 'calage' && S.start) drawUser(toScreen(S.start), null);
  else if (navLike && S.pos) drawUser(toScreen(S.pos), ang);

  // point en cours de choix
  if (S.temp) {
    if (S.mode === 'depart') drawUser(toScreen(S.temp), null);
    else if (S.mode === 'dest' || S.mode === 'newdest') drawPin(toScreen(S.temp), '#D9480F');
    else drawTarget(toScreen(S.temp));
  }
}
function drawPin([x, y], color) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-5, -10, -15, -18, -15, -29); ctx.arc(0, -29, 15, Math.PI, 0); ctx.bezierCurveTo(15, -18, 5, -10, 0, 0);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -29, 5.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
}
function drawRing([x, y], r) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1557C0'; ctx.stroke();
}
function drawTarget([x, y]) {
  ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.fillStyle = 'rgba(21,87,192,.2)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1557C0'; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fillStyle = '#1557C0'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
}
function drawUser([x, y], ang) {
  ctx.save(); ctx.translate(x, y);
  if (ang != null) {
    ctx.save(); ctx.rotate(ang);
    const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 80);
    g.addColorStop(0, 'rgba(21,87,192,.5)'); g.addColorStop(1, 'rgba(21,87,192,0)');
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 80, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45); ctx.closePath();
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.fillStyle = 'rgba(21,87,192,.2)'; ctx.fill();
  if (ang != null) {
    ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(12, 12); ctx.lineTo(0, 6); ctx.lineTo(-12, 12); ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#1557C0'; ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fillStyle = '#1557C0'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  ctx.restore();
}

/* ---------- Modes et bandeau ---------- */
const ICON_HAND = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5a1.5 1.5 0 0 1 3 0v5"/><path d="M12 10V4a1.5 1.5 0 0 1 3 0v6"/><path d="M15 10V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 13a1.5 1.5 0 0 1 2.4-1.8L9 14"/></svg>';
const ICON_WALK = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M10 21l2-6 3 3v3"/><path d="M8 12l2-4 4 1 2 4 3 1"/><path d="M10 8l-1 5 3 2"/></svg>';
const ICON_ARROW = '<svg id="b-arrow" width="44" height="44" viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"><path d="M12 2l7 18-7-4-7 4z"/></svg>';
const ICON_OK = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function setBanner(t, s, icon, ok) {
  $('#b-t').textContent = t; $('#b-s').textContent = s || '';
  const ic = $('#b-ic'); if (ic.dataset.icon !== icon) { ic.innerHTML = icon || ''; ic.dataset.icon = icon || ''; }
  $('#banner').classList.toggle('ok', !!ok);
}
function setActions(list) {
  const box = $('#actions'); box.textContent = '';
  for (const a of list) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.kind || 'secondary') + (a.full ? ' full' : '');
    b.textContent = a.label;
    if (a.confirm) { b.dataset.confirm = '1'; b.disabled = !S.temp; }
    b.addEventListener('click', a.fn);
    box.append(b);
  }
}
function setMode(m) {
  S.mode = m; S.temp = null;
  $('#stats').hidden = !(m === 'calage');
  const msg = $('#s-msg');
  switch (m) {
    case 'depart':
      setBanner('Où êtes-vous ?', 'Touchez le plan à l’endroit où vous vous trouvez.', ICON_HAND);
      msg.textContent = 'Écartez deux doigts pour zoomer.';
      setActions([{ label: 'Retour', fn: goHome }, { label: 'C’est ici', kind: 'primary', confirm: true, fn: () => { S.start = S.temp; S.pos = S.temp.slice(); setMode('dest'); } }]);
      break;
    case 'dest':
      setBanner('Où voulez-vous aller ?', 'Touchez l’endroit à rejoindre.', ICON_HAND);
      msg.textContent = '';
      setActions([{ label: 'Retour', fn: () => setMode('depart') }, { label: 'C’est parti', kind: 'primary', confirm: true, fn: async () => {
        S.dest = S.temp;
        if (!await startSensors()) return;
        if (S.cal) startNav(S.start); else setMode('calage');
      } }]);
      break;
    case 'calage':
      S.calSteps = 0; S.calW = [0, 0];
      setBanner('Calage du plan', 'Téléphone à plat devant vous, marchez jusqu’à un repère facile à reconnaître.', ICON_WALK);
      msg.innerHTML = 'Un croisement, un coin de bâtiment, une entrée… <strong>au moins 20 à 30 pas</strong>, le plus en ligne droite possible.';
      setActions([{ label: 'Annuler', fn: () => setMode('dest') }, { label: 'Je suis au repère', kind: 'primary', fn: () => setMode('repere') }]);
      break;
    case 'repere':
      setBanner('Où est ce repère ?', 'Touchez sur le plan l’endroit exact où vous êtes.', ICON_HAND);
      msg.textContent = '';
      setActions([{ label: 'Continuer à marcher', fn: () => { const st = S.calSteps, w = S.calW.slice(); setMode('calage'); S.calSteps = st; S.calW = w; schedule(); } },
        { label: 'Je suis là', kind: 'primary', confirm: true, fn: confirmRepere }]);
      break;
    case 'nav':
      msg.textContent = '';
      setActions([
        { label: 'Je suis ici', kind: 'primary', fn: () => setMode('fix') },
        { label: 'Autre destination', fn: () => setMode('newdest') },
        { label: 'Refaire le calage', kind: 'ghost', fn: recalage },
        { label: 'Arrêter', kind: 'ghost', fn: goHome }]);
      break;
    case 'fix':
      setBanner('Où êtes-vous vraiment ?', 'Touchez votre position exacte sur le plan.', ICON_HAND);
      msg.textContent = 'Votre position et le calage seront corrigés.';
      setActions([{ label: 'Annuler', fn: () => setMode('nav') }, { label: 'C’est ici', kind: 'primary', confirm: true, fn: confirmFix }]);
      break;
    case 'newdest':
      setBanner('Nouvelle destination', 'Touchez l’endroit à rejoindre.', ICON_HAND);
      msg.textContent = '';
      setActions([{ label: 'Annuler', fn: () => setMode('nav') }, { label: 'Valider', kind: 'primary', confirm: true, fn: () => { S.dest = S.temp; S.arrived = false; setMode('nav'); } }]);
      break;
  }
  setFollow(S.follow);
  requestAnimationFrame(() => schedule());
}
function confirmRepere() {
  const c = computeCal(S.start, S.temp, S.calW);
  if (!c) {
    toast(Math.hypot(...S.calW) < 8 ? 'Pas assez de pas comptés : marchez encore un peu, téléphone à plat.' : 'Le repère est trop près du départ : choisissez-en un plus loin.');
    return;
  }
  S.cal = c; S.plan.cal = { ...c };
  db.put(S.plan).catch(() => {});
  toast('Plan calé. Le triangle va maintenant suivre vos pas.');
  startNav(S.temp);
}
function startNav(p) {
  S.pos = p.slice(); S.lastFix = p.slice(); S.segW = [0, 0]; S.trail = [p.slice()]; S.arrived = false;
  // zoom confortable : environ 2,5 px d'écran par mètre
  const k = Math.min(Math.max(2.5 * S.cal.s, S.kmin), S.kmax);
  S.view.k = Math.max(k, S.view.k);
  setMode('nav'); setFollow(true);
  requestAnimationFrame(() => { centerOn(S.pos); schedule(); });
}
function confirmFix() {
  const F = S.temp, segM = Math.hypot(...S.segW);
  if (S.lastFix && segM > 15) { // affiner le calage avec le tronçon parcouru depuis le dernier recalage
    const c = computeCal(S.lastFix, F, S.segW);
    if (c) {
      const w = 0.4;
      S.cal.s = S.cal.s * (1 - w) + c.s * w;
      S.cal.off = wrapRad(S.cal.off + w * wrapRad(c.off - S.cal.off));
      S.plan.cal = { ...S.cal }; db.put(S.plan).catch(() => {});
    }
  }
  S.pos = F.slice(); S.lastFix = F.slice(); S.segW = [0, 0]; S.trail.push(F.slice());
  setMode('nav'); setFollow(true); centerOn(S.pos);
}
function recalage() {
  if (!confirm('Refaire le calage à partir de votre position actuelle ?')) return;
  S.cal = null; S.start = S.pos.slice(); S.trail = [];
  setMode('calage');
}
function goHome() {
  if (wake) { wake.release().catch(() => {}); wake = null; }
  $('#demo').hidden = true; $('#toast').hidden = true;
  show('accueil'); renderList();
}

function fmtDist(m) {
  if (m >= 1000) return (m / 1000).toFixed(1).replace('.', ',') + ' km';
  if (m >= 100) return Math.round(m / 10) * 10 + ' m';
  return Math.max(1, Math.round(m)) + ' m';
}
function updateUI() {
  if (S.mode === 'calage') {
    $('#st-pas').textContent = S.calSteps;
    $('#st-dist').textContent = '≈ ' + Math.round(Math.hypot(...S.calW)) + ' m';
    $('#st-cap').textContent = S.heading == null ? '–' : Math.round(S.heading) + '°';
  }
  if (S.mode !== 'nav' || !S.pos || !S.dest || !S.cal) return;
  const dx = S.dest[0] - S.pos[0], dy = S.dest[1] - S.pos[1], dm = Math.hypot(dx, dy) * S.cal.s;
  if (dm < ARRIVEE_M) S.arrived = true;
  if (S.arrived) {
    setBanner('Vous êtes arrivé', 'La destination est à moins de ' + ARRIVEE_M + ' m.', ICON_OK, true);
    $('#s-msg').textContent = `${S.plan.name} · ${S.steps} pas`;
    return;
  }
  const min = Math.max(1, Math.round(dm / 1.2 / 60));
  $('#s-msg').innerHTML = '';
  const strong = document.createElement('strong'); strong.textContent = fmtDist(dm) + ' à vol d’oiseau';
  $('#s-msg').append(strong, ` · environ ${min} min · ${S.steps} pas`);
  if (S.heading == null) { setBanner(fmtDist(dm), 'Boussole en attente…', ICON_ARROW); return; }
  const rel = wrapDeg((Math.atan2(dx, -dy) - (S.heading * RAD + S.cal.off)) / RAD);
  const a = Math.abs(rel), side = rel > 0 ? 'droite' : 'gauche';
  const txt = a < 20 ? 'Tout droit' : a < 60 ? 'Légèrement à ' + side : a < 140 ? 'Tournez à ' + side : 'Faites demi-tour';
  setBanner(fmtDist(dm), txt, ICON_ARROW);
  const arr = $('#b-arrow'); if (arr) arr.style.transform = `rotate(${rel}deg)`;
}

/* ---------- Mode démo (?demo) : simuler cap et pas sur ordinateur ---------- */
if (DEMO) {
  const cap = $('#demo-cap');
  cap.addEventListener('input', () => { S.heading = +cap.value; $('#demo-cap-v').textContent = cap.value + '°'; schedule(); });
  $('#demo-pas').addEventListener('click', () => onStep());
  $('#demo-10').addEventListener('click', () => { for (let i = 0; i < 10; i++) onStep(); });
}

renderList();
