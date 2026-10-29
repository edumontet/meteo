// Rennes en direct : plan du réseau STAR avec la position de tous les bus (GPS temps réel)
// et des rames de métro (estimée d'après les heures de passage en station).
"use strict";

const API = "https://data.explore.star.fr/api/explore/v2.1/catalog/datasets/";
const BUS_MS = 10000;        // positions des bus : mises à jour toutes les ~10 s côté STAR
const METRO_MS = 20000;      // heures de passage du métro
const ANIM_MS = 2500;        // glissement d'une position à la suivante
const CACHE_DAYS = 7;
const HIDDEN_FAMILIES = ["Transport scolaire", "Evènementiel", "Covoiturage", "BreizhGo", "Spéciale"];

// ---------- Outils ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Les heures STAR arrivent parfois en « 2026-10-29 05:43:24+0100 » : on les remet au format ISO.
function parseTime(s) {
  if (!s) return NaN;
  return Date.parse(String(s).trim().replace(" ", "T").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
}
async function exportJson(ds, params) {
  const res = await fetch(API + ds + "/exports/json?" + new URLSearchParams(params || {}), { cache: "no-store" });
  if (!res.ok) { const e = new Error("HTTP " + res.status); e.status = res.status; throw e; }
  return res.json();
}
function cacheGet(k) {
  try { const c = JSON.parse(localStorage.getItem("carte." + k)); if (c && Date.now() - c.t < CACHE_DAYS * 864e5) return c.v; } catch (e) {}
  return null;
}
function cacheSet(k, v) { try { localStorage.setItem("carte." + k, JSON.stringify({ t: Date.now(), v })); } catch (e) {} }
const hhmmss = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Géométrie en mètres (projection locale, suffisante à l'échelle de Rennes)
const LAT0 = 48.11, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
const toXY = (lon, lat) => [lon * KX, lat * KY];

function simplify(pts, tol) { // Douglas-Peucker sur [lon, lat], tolérance en mètres
  if (pts.length < 3) return pts;
  const xy = pts.map(p => toXY(p[0], p[1]));
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
}

// Tracé prêt pour la projection : points en mètres et distances cumulées
function makeRoute(coords) {
  const xy = coords.map(p => toXY(p[0], p[1]));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  return { coords, xy, cum, length: cum[cum.length - 1] };
}
// Point le plus proche sur le tracé : distance au tracé, abscisse, cap (degrés depuis le nord)
function project(route, lon, lat) {
  const [px, py] = toXY(lon, lat);
  let best = { d: Infinity };
  for (let i = 1; i < route.xy.length; i++) {
    const [ax, ay] = route.xy[i - 1], [bx, by] = route.xy[i];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (d < best.d) best = { d, s: route.cum[i - 1] + t * Math.sqrt(L2), i };
  }
  if (best.i) best.heading = headingAt(route, best.s);
  return best;
}
// Position et cap à une abscisse donnée (cap lissé sur ~40 m pour éviter les à-coups dans les virages)
function pointAt(route, s) {
  s = Math.max(0, Math.min(route.length, s));
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i] < s) i++;
  const seg = route.cum[i] - route.cum[i - 1] || 1, t = (s - route.cum[i - 1]) / seg;
  const a = route.coords[i - 1], b = route.coords[i];
  return [a[1] + t * (b[1] - a[1]), a[0] + t * (b[0] - a[0])];
}
function headingAt(route, s) {
  const p1 = pointAt(route, s - 20), p2 = pointAt(route, s + 20);
  const dx = (p2[1] - p1[1]) * KX, dy = (p2[0] - p1[0]) * KY;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

// ---------- Carte ----------
const map = L.map("map", { zoomControl: false, minZoom: 10, maxZoom: 19 }).setView([48.1115, -1.6800], 13);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, className: "osm-tiles",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Données STAR / Rennes Métropole (ODbL)'
}).addTo(map);
map.createPane("busLines").style.zIndex = 410;
map.createPane("metroLines").style.zIndex = 420;
map.createPane("buses").style.zIndex = 610;
map.createPane("trains").style.zIndex = 620;
const busCanvas = L.canvas({ pane: "busLines", padding: 0.3, tolerance: 4 });
const metroCanvas = L.canvas({ pane: "metroLines", padding: 0.3 });
function onZoom() { map.getContainer().classList.toggle("zoom-far", map.getZoom() < 13); }
map.on("zoomend", onZoom); onZoom();

const S = {
  lines: {},          // idligne -> { short, color, text, fam }
  routes: {},         // "idligne|sens" -> [route] (bus, parcours principaux)
  metro: [],          // directions : { idligne, sens, letter, color, route, stops: [{ id, name, s }] }
  buses: new Map(),   // idbus -> état d'affichage
  trains: new Map(),
  passages: [],       // métro : { idarret, sens, arr, dep }
  busOk: 0, metroOk: 0, busErr: null, metroErr: null
};

// ---------- Lignes ----------
async function loadLines() {
  let rows = cacheGet("lines");
  if (!rows) {
    const [b, m] = await Promise.all([
      exportJson("tco-bus-topologie-lignes-td", { select: "id,nomcourt,nomfamillecommerciale,couleurligne,couleurtexteligne" }),
      exportJson("tco-metro-topologie-lignes-td", { select: "id,nomcourt,nomfamillecommerciale,couleurligne,couleurtexteligne" })
    ]);
    rows = b.concat(m);
    cacheSet("lines", rows);
  }
  for (const r of rows) S.lines[r.id] = {
    short: String(r.nomcourt || r.id).toUpperCase(), color: r.couleurligne || "#5F6B85",
    text: r.couleurtexteligne || "#ffffff", fam: r.nomfamillecommerciale || ""
  };
}

const WIDTH = { CHRONOSTAR: 4.5, Urbaine: 3, "Inter-quartiers": 2.5, Express: 2.5 };
async function loadBusShapes() {
  let rows = cacheGet("bus-shapes");
  if (!rows) {
    const raw = await exportJson("tco-bus-topologie-parcours-td", {
      select: "id,idligne,sens,parcours", where: 'estversionactive="Oui" and type="Principal"'
    });
    rows = raw.filter(r => r.parcours && r.parcours.geometry && r.parcours.geometry.type === "LineString")
      .map(r => ({ id: r.id, l: r.idligne, s: r.sens, c: simplify(r.parcours.geometry.coordinates, 3) }));
    cacheSet("bus-shapes", rows);
  }
  const order = l => (WIDTH[(S.lines[l] || {}).fam] || 2);
  rows.sort((a, b) => order(a.l) - order(b.l));
  for (const r of rows) {
    const k = r.l + "|" + r.s;
    (S.routes[k] || (S.routes[k] = [])).push(makeRoute(r.c));
    const info = S.lines[r.l];
    if (!info || HIDDEN_FAMILIES.includes(info.fam)) continue;
    L.polyline(r.c.map(p => [p[1], p[0]]), {
      renderer: busCanvas, color: info.color, weight: WIDTH[info.fam] || 2, opacity: 0.75, lineCap: "round", lineJoin: "round"
    }).bindTooltip(`<span class="badge" style="background:${esc(info.color)};color:${esc(info.text)}">${esc(info.short)}</span>`, { sticky: true, className: "tip", direction: "top", offset: [0, -6] })
      .addTo(map);
  }
}

async function loadMetro() {
  let data = cacheGet("metro-topo");
  if (!data) {
    const [par, des, pts] = await Promise.all([
      exportJson("tco-metro-topologie-parcours-td", { select: "id,idligne,sens,parcours" }),
      exportJson("tco-metro-topologie-dessertes-td", { select: "idparcours,idarret,nomarret,ordre" }),
      exportJson("tco-metro-topologie-pointsarret-td", { select: "id,nom,coordonnees" })
    ]);
    data = { par: par.map(p => ({ id: p.id, l: p.idligne, s: p.sens, c: p.parcours.geometry.coordinates })), des, pts };
    cacheSet("metro-topo", data);
  }
  const ptById = {};
  for (const p of data.pts) if (p.coordonnees) ptById[p.id] = p;
  for (const p of data.par) {
    const info = S.lines[p.l] || { short: "?", color: "#E5484D", text: "#fff" };
    const route = makeRoute(p.c);
    const stops = data.des.filter(d => d.idparcours === p.id).sort((a, b) => a.ordre - b.ordre).map(d => {
      const pt = ptById[d.idarret];
      const s = pt ? project(route, pt.coordonnees.lon, pt.coordonnees.lat).s : NaN;
      return { id: String(d.idarret), name: d.nomarret, s, lat: pt && pt.coordonnees.lat, lon: pt && pt.coordonnees.lon };
    }).filter(st => !isNaN(st.s));
    S.metro.push({ idligne: p.l, sens: p.s, letter: info.short, color: info.color, text: info.text, route, stops });
    if (p.s === 0) { // un seul tracé par ligne (les deux sens se superposent)
      L.polyline(p.c.map(c => [c[1], c[0]]), { renderer: metroCanvas, color: "#fff", weight: 11, opacity: 0.9 }).addTo(map);
      L.polyline(p.c.map(c => [c[1], c[0]]), { renderer: metroCanvas, color: info.color, weight: 7, opacity: 1 }).addTo(map);
    }
  }
  // Stations (une pastille par nom, même si plusieurs quais)
  const seen = new Set();
  for (const dir of S.metro) for (const st of dir.stops) {
    if (seen.has(st.name)) continue;
    seen.add(st.name);
    L.circleMarker([st.lat, st.lon], { renderer: metroCanvas, radius: 4.5, color: dir.color, weight: 2.5, fillColor: "#fff", fillOpacity: 1 })
      .bindTooltip(`<b>${esc(st.name)}</b>`, { className: "tip", direction: "top", offset: [0, -4] }).addTo(map);
  }
}

// ---------- Marqueurs de véhicules ----------
function vehicleIcon(kind, label, color, text, size) {
  return L.divIcon({
    className: "veh-icon " + kind, iconSize: [size, size],
    html: `<div class="veh ${kind} noarrow" style="--c:${esc(color)};--t:${esc(text)}"><div class="arrow"></div><div class="dot">${esc(label)}</div></div>`
  });
}
function setHeading(v, heading) {
  const el = v.marker.getElement();
  if (!el) return;
  const veh = el.firstElementChild;
  if (heading == null || isNaN(heading)) { veh.classList.add("noarrow"); return; }
  veh.classList.remove("noarrow");
  // Rotation par le plus court chemin pour que la flèche ne fasse pas un tour complet.
  if (v.rot == null) v.rot = heading;
  else v.rot += ((heading - v.rot) % 360 + 540) % 360 - 180;
  veh.firstElementChild.style.transform = `rotate(${v.rot}deg)`;
}
function moveTo(v, lat, lon, animate) {
  const cur = v.marker.getLatLng();
  v.from = animate ? [cur.lat, cur.lng] : [lat, lon];
  v.to = [lat, lon];
  v.t0 = performance.now();
}
function animate() {
  const now = performance.now();
  for (const store of [S.buses, S.trains]) for (const v of store.values()) {
    if (!v.to) continue;
    const k = Math.min(1, (now - v.t0) / v.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    v.marker.setLatLng([v.from[0] + (v.to[0] - v.from[0]) * e, v.from[1] + (v.to[1] - v.from[1]) * e]);
    if (k >= 1) v.to = null;
  }
  requestAnimationFrame(animate);
}

// ---------- Bus ----------
async function refreshBuses() {
  try {
    const rows = await exportJson("tco-bus-vehicules-position-tr", { where: 'etat="En ligne"' });
    const seen = new Set();
    for (const b of rows) {
      if (!b.coordonnees || !b.idligne) continue;
      const id = String(b.idbus);
      seen.add(id);
      const { lat, lon } = b.coordonnees;
      const info = S.lines[b.idligne] || { short: b.nomcourtligne || "?", color: "#5F6B85", text: "#fff" };
      let v = S.buses.get(id);
      if (!v || v.line !== b.idligne) {
        if (v) v.marker.remove();
        v = { line: b.idligne, dur: ANIM_MS };
        v.marker = L.marker([lat, lon], { pane: "buses", icon: vehicleIcon("bus", info.short, info.color, info.text, 24), keyboard: false })
          .bindTooltip("", { className: "tip", direction: "top", offset: [0, -14] }).addTo(map);
        S.buses.set(id, v);
      } else if (v.lat !== lat || v.lon !== lon) {
        moveTo(v, lat, lon, true);
      }
      // Sens de marche : le tracé de la ligne donne le cap le long de la rue ; le déplacement réel
      // depuis la position précédente tranche quand la ligne passe deux fois dans la même rue.
      let routeH = null, moveH = null, best = null;
      for (const r of S.routes[b.idligne + "|" + b.sens] || []) {
        const p = project(r, lon, lat);
        if (!best || p.d < best.d) best = p;
      }
      if (best && best.d < 60) routeH = best.heading;
      if (v.lat != null) {
        const dx = (lon - v.lon) * KX, dy = (lat - v.lat) * KY, dist = Math.hypot(dx, dy);
        if (dist > 20 && dist < 1500) moveH = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      }
      const gap = (x, y) => Math.abs(((x - y) % 360 + 540) % 360 - 180);
      let heading;
      if (moveH != null) heading = routeH != null && gap(routeH, moveH) < 75 ? routeH : moveH;
      else if (routeH != null) heading = v.heading != null && gap(routeH, v.heading) > 120 ? v.heading : routeH;
      else heading = v.heading;
      v.lat = lat; v.lon = lon; v.heading = heading;
      setHeading(v, heading);
      const late = b.ecartsecondes;
      const lateTxt = typeof late === "number" && Math.abs(late) >= 60 ? `<br>Écart à l'horaire : ${late > 0 ? "+" : "−"}${Math.round(Math.abs(late) / 60)} min` : "";
      v.marker.setTooltipContent(`<span class="badge" style="background:${esc(info.color)};color:${esc(info.text)}">${esc(info.short)}</span> vers <b>${esc(b.destination || "?")}</b>${lateTxt}`);
    }
    for (const [id, v] of S.buses) if (!seen.has(id)) { v.marker.remove(); S.buses.delete(id); }
    S.busOk = Date.now(); S.busErr = null;
  } catch (e) {
    S.busErr = e;
  }
  updatePanel();
}

// ---------- Métro (positions estimées) ----------
async function refreshMetroPassages() {
  try {
    let rows;
    const sel = { select: "idligne,sens,idarret,arrivee,depart", timezone: "Europe/Paris" };
    try {
      rows = await exportJson("tco-metro-circulation-passages-tr", Object.assign({ where: "depart < now(minutes=25) or (depart is null and arrivee < now(minutes=25))" }, sel));
    } catch (e) {
      rows = await exportJson("tco-metro-circulation-passages-tr", sel);
    }
    S.passages = rows.map(r => {
      const arr = parseTime(r.arrivee), dep = parseTime(r.depart);
      return { idarret: String(r.idarret), sens: r.sens, arr: isNaN(arr) ? dep : arr, dep: isNaN(dep) ? arr : dep };
    }).filter(p => !isNaN(p.dep));
    S.metroOk = Date.now(); S.metroErr = null;
  } catch (e) {
    S.metroErr = e;
  }
  updatePanel();
}

// Pour chaque sens : une rame se trouve entre la station i-1 et la station i quand son prochain passage
// en i arrive avant le prochain départ de i-1 (la rame suivante, elle, n'a pas encore quitté i-1).
function computeTrains() {
  const now = Date.now();
  const out = [];
  for (const dir of S.metro) {
    const at = dir.stops.map(st => S.passages
      .filter(p => p.idarret === st.id && p.sens === dir.sens && p.dep > now - 1000)
      .sort((a, b) => a.dep - b.dep));
    const n = dir.stops.length;
    for (let i = 0; i < n; i++) {
      const f = at[i][0];
      if (!f) continue;
      const st = dir.stops[i];
      if (i === 0) { // au terminus de départ, à quai
        if (f.dep - now < 150 && (!at[1][0] || at[1][0].arr > f.dep)) out.push({ dir, s: st.s, key: dir.idligne + dir.sens + "-0" });
        continue;
      }
      const prev = at[i - 1][0];
      if (prev && prev.dep <= f.arr) continue; // cette rame n'a pas encore quitté la station précédente
      let s;
      if (now >= f.arr) s = st.s; // à quai
      else {
        const p = dir.stops[i - 1];
        const second = at[i][1];
        let T = second && prev ? (second.arr - prev.dep) / 1000 : NaN;
        if (!(T >= 30 && T <= 300)) T = (st.s - p.s) / 9 + 10;
        const left = (f.arr - now) / 1000;
        if (left > T + 60) continue; // trou dans les données : on n'invente pas de rame
        const frac = Math.max(0, Math.min(1, 1 - left / T));
        s = p.s + frac * (st.s - p.s);
      }
      out.push({ dir, s, key: dir.idligne + dir.sens + "-" + i, next: st.name, eta: f.arr });
    }
  }
  return out;
}

function renderTrains() {
  const list = computeTrains();
  // Associe chaque rame calculée à un marqueur existant du même sens, au plus près (pour un mouvement continu).
  const free = new Map(S.trains);
  const next = new Map();
  for (const t of list) {
    let pick = null, bestD = Infinity;
    for (const [k, v] of free) {
      if (v.dirKey !== t.dir.idligne + "|" + t.dir.sens) continue;
      const d = t.s - v.s; // une rame n'avance que dans un sens
      if (d >= -30 && d < 1500 && d < bestD) { bestD = d; pick = k; }
    }
    let v;
    if (pick) { v = free.get(pick); free.delete(pick); }
    else {
      const [lat, lon] = pointAt(t.dir.route, t.s);
      v = { dirKey: t.dir.idligne + "|" + t.dir.sens, dur: 1000, s: t.s };
      v.marker = L.marker([lat, lon], { pane: "trains", icon: vehicleIcon("metro", t.dir.letter, t.dir.color, t.dir.text, 28), keyboard: false })
        .bindTooltip("", { className: "tip", direction: "top", offset: [0, -16] }).addTo(map);
    }
    v.s = Math.max(v.s, t.s); // jamais de marche arrière
    const [lat, lon] = pointAt(t.dir.route, v.s);
    moveTo(v, lat, lon, true);
    setHeading(v, headingAt(t.dir.route, v.s));
    const term = t.dir.stops[t.dir.stops.length - 1].name;
    const etaTxt = t.eta && t.eta > Date.now() ? ` dans ${Math.max(1, Math.round((t.eta - Date.now()) / 1000))} s` : "";
    v.marker.setTooltipContent(`<span class="badge" style="background:${esc(t.dir.color)};color:${esc(t.dir.text)}">${esc(t.dir.letter)}</span> vers <b>${esc(term)}</b>` +
      (t.next ? `<br>${now0(t) ? "À quai à" : "Prochain arrêt :"} ${esc(t.next)}${now0(t) ? "" : etaTxt}` : ""));
    next.set(t.key + "#" + next.size, v);
  }
  for (const v of free.values()) v.marker.remove();
  S.trains = next;
  $("n-metro").textContent = S.metroOk ? S.trains.size : "–";
}
const now0 = t => t.eta && t.eta <= Date.now();

// ---------- Panneau ----------
function updatePanel() {
  $("n-bus").textContent = S.busOk ? S.buses.size : "–";
  const err = (S.busErr && !S.busOk) || (S.metroErr && !S.metroOk);
  const stale = S.busOk && Date.now() - S.busOk > 60000;
  const st = $("status");
  st.classList.toggle("err", !!(err || stale));
  document.querySelector(".live").classList.toggle("off", !!(err || stale));
  if (err) st.textContent = "Données STAR injoignables, nouvel essai en cours…";
  else if (stale) st.textContent = "Connexion perdue · positions de " + hhmmss(S.busOk);
  else if (S.busOk) st.textContent = "Mis à jour à " + hhmmss(S.busOk);
}

// ---------- Démarrage ----------
(async function start() {
  requestAnimationFrame(animate);
  try { await loadLines(); } catch (e) { S.busErr = e; updatePanel(); }
  refreshBuses();
  refreshMetroPassages();
  // Tracés (le premier chargement prend quelques secondes, ensuite ils sont gardés une semaine)
  loadMetro().catch(e => console.warn("métro", e));
  loadBusShapes().then(() => refreshBuses()).catch(e => console.warn("tracés bus", e));
  setInterval(() => { if (!document.hidden) refreshBuses(); }, BUS_MS);
  setInterval(() => { if (!document.hidden) refreshMetroPassages(); }, METRO_MS);
  setInterval(() => { if (!document.hidden && S.metro.length && S.metroOk) renderTrains(); }, 1000);
  setInterval(updatePanel, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshBuses(); refreshMetroPassages(); } });
})();
