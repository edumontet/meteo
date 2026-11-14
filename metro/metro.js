// Métro Rennes : dans combien de temps arrive la prochaine rame, à la station et dans la direction choisies.
// Données : jeu « Prochains passages applicables des lignes de métro du réseau STAR » (temps réel), STAR Data Explore.
"use strict";

// Les heures STAR arrivent parfois en « 2026-10-29 05:43:24+0100 », que Safari ne sait pas lire.
function parseTime(s) {
  if (!s) return NaN;
  return Date.parse(String(s).trim().replace(" ", "T").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
}

const DATASET = "tco-metro-circulation-passages-tr";
const API = "https://data.explore.star.fr/api/explore/v2.1/catalog/datasets/" + DATASET;
const REFRESH_MS = 30000;

// Stations dans l'ordre de la ligne (premier et dernier = terminus).
const LINES = {
  A: ["J.F. Kennedy", "Villejean-Université", "Pontchaillou", "Anatole France", "Sainte-Anne", "République",
      "Charles de Gaulle", "Gares", "Jacques Cartier", "Clemenceau", "Henri Fréville", "Italie", "Triangle",
      "Le Blosne", "La Poterie"],
  B: ["Saint-Jacques - Gaîté", "La Courrouze", "Cleunay", "Mabilais", "Colombier", "Gares", "Saint-Germain",
      "Sainte-Anne", "Jules Ferry", "Gros-Chêne", "Les Gayeulles", "Joliot-Curie - Chateaubriand",
      "Beaulieu - Université", "Atalante", "Cesson - Viasilva"]
};
const DEFAULT_STATION = { A: "République", B: "Gares" };

const $ = id => document.getElementById(id);
const debugOn = /[?&]debug/.test(location.search);
const metroVisible = () => document.visibilityState === "visible" && document.body.dataset.tab !== "bus";

const state = {
  line: "A",
  station: null,
  dir: null,          // terminus vers lequel on roule (déduit de la station d'arrivée)
  dest: null,         // station où l'on descend
  passages: [],       // { line, station, dest, time (ms), precision }
  extras: { A: [], B: [] }, // stations vues dans les données mais absentes de la liste ci-dessus
  lastOk: 0,
  loading: false,
  error: null
};

// ---------- Outils ----------
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function same(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 5 && l.includes(s);
}
const indexIn = (line, name) => LINES[line].findIndex(s => same(s, name));

function store(k, v) { try { localStorage.setItem("metro." + k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem("metro." + k); } catch (e) { return null; } }

function pick(r, names) {
  for (const n of names) if (r[n] !== undefined && r[n] !== null && r[n] !== "") return r[n];
  return null;
}
function pickLike(r, re) {
  for (const k of Object.keys(r)) if (re.test(k) && typeof r[k] === "string" && r[k]) return r[k];
  return null;
}

// ---------- Lecture des données STAR ----------
function parseRecord(r) {
  const station = pick(r, ["nomarret", "arret", "nomstation", "station"]) || pickLike(r, /arret|station/i);
  const dest = pick(r, ["destination", "nomdestination", "direction", "terminus"]) || pickLike(r, /dest|termin/i);
  const rawTime = pick(r, ["arrivee", "depart", "heurearrivee", "heuredepart", "arrival", "departure"]) || pickLike(r, /arriv|depart/i);
  const time = rawTime ? parseTime(rawTime) : NaN;
  if (!station || isNaN(time)) return null;

  let line = null;
  const rawLine = pick(r, ["nomcourtligne", "ligne", "nomligne", "idligne"]);
  if (rawLine) {
    const m = String(rawLine).trim().toUpperCase().match(/(?:^|\s)([AB])$/);
    if (m) line = m[1];
  }
  if (!line) { // sinon on déduit la ligne de la destination, puis de la station
    const inA = indexIn("A", dest) >= 0, inB = indexIn("B", dest) >= 0;
    if (inA !== inB) line = inA ? "A" : "B";
    else {
      const sA = indexIn("A", station) >= 0, sB = indexIn("B", station) >= 0;
      if (sA !== sB) line = sA ? "A" : "B";
    }
  }
  if (!line) return null;
  const precision = pick(r, ["precision", "type"]);
  return { line, station, dest, time, precision };
}

async function fetchAll() {
  // 1) export complet (une seule requête)
  try {
    const res = await fetch(API + "/exports/json?timezone=Europe%2FParis", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    }
  } catch (e) { /* on tente l'autre méthode */ }
  // 2) pages de 100 enregistrements
  const all = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const res = await fetch(API + "/records?limit=100&offset=" + offset + "&timezone=Europe%2FParis", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const list = data.results || data.records || [];
    all.push(...list.map(x => x.record ? (x.record.fields || x.record) : (x.fields || x)));
    if (list.length < 100) break;
  }
  return all;
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  $("status").classList.add("spin");
  try {
    const raw = await fetchAll();
    state.passages = raw.map(parseRecord).filter(Boolean);
    state.lastOk = Date.now();
    state.error = null;
    collectExtras();
    if (debugOn) showDebug(raw);
  } catch (e) {
    state.error = e;
  } finally {
    state.loading = false;
    $("status").classList.remove("spin");
    render();
  }
}

function collectExtras() {
  const before = JSON.stringify(state.extras);
  for (const line of ["A", "B"]) {
    const seen = new Set();
    for (const p of state.passages) {
      if (p.line !== line || indexIn(line, p.station) >= 0) continue;
      seen.add(p.station);
    }
    state.extras[line] = [...seen].sort((a, b) => a.localeCompare(b, "fr"));
  }
  if (JSON.stringify(state.extras) !== before) fillStations();
}

function showDebug(raw) {
  const d = $("debug");
  d.hidden = false;
  const keys = raw[0] ? Object.keys(raw[0]).join(", ") : "(aucun)";
  d.textContent = raw.length + " enregistrements, " + state.passages.length + " lus\nChamps : " + keys +
    "\n\n" + JSON.stringify(raw.slice(0, 3), null, 2);
}

// ---------- Direction d'un passage ----------
// Renvoie le terminus (premier ou dernier de la liste) vers lequel va la rame.
function directionOf(p) {
  const list = LINES[p.line];
  const first = list[0], last = list[list.length - 1];
  if (same(p.dest, first)) return first;
  if (same(p.dest, last)) return last;
  // Terminus partiel (rame qui s'arrête avant le bout) : on compare les positions.
  const di = indexIn(p.line, p.dest), si = indexIn(p.line, p.station);
  if (di >= 0 && si >= 0 && di !== si) return di > si ? last : first;
  return null;
}

// ---------- Interface ----------
function fillStations() {
  const sel = $("station");
  const names = LINES[state.line].concat(state.extras[state.line]);
  sel.innerHTML = names.map(n => `<option>${escapeHtml(n)}</option>`).join("");
  if (!state.station || !names.some(n => n === state.station)) {
    const saved = load("station." + state.line);
    state.station = names.includes(saved) ? saved : DEFAULT_STATION[state.line];
  }
  sel.value = state.station;
}

// Liste « Je descends à » : toutes les autres stations de la ligne, la direction s'en déduit.
function fillDests() {
  const list = LINES[state.line];
  const ends = [list[0], list[list.length - 1]];
  const si = indexIn(state.line, state.station);
  const choices = list.filter((n, i) => i !== si);
  const sel = $("dest");
  sel.innerHTML = choices.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  if (!choices.includes(state.dest)) {
    const saved = load("dest." + state.line);
    if (choices.includes(saved)) state.dest = saved;
    else { // sinon le terminus de l'ancienne direction, ou le terminus le plus loin
      const oldDir = ends.includes(state.dir) ? state.dir : load("dir." + state.line);
      state.dest = choices.includes(oldDir) ? oldDir : (si >= 0 && si > (list.length - 1) / 2 ? ends[0] : ends[1]);
    }
  }
  sel.value = state.dest;
  updateDir();
}

function updateDir() {
  const list = LINES[state.line];
  const ends = [list[0], list[list.length - 1]];
  const si = indexIn(state.line, state.station), di = indexIn(state.line, state.dest);
  state.dir = si >= 0 && di >= 0 ? (di > si ? ends[1] : ends[0]) : (state.dest === ends[0] ? ends[0] : ends[1]);
  $("dir-hint").textContent = "Direction " + state.dir;
  renderTrain();
}

// ---------- Où monter dans la rame ----------
// Position de l'escalator de sortie, par ligne → station d'arrivée → terminus de la direction.
// Valeur : 0 = porte de tête … DOORS-1 = porte de queue. Tu complètes au fil des trajets.
// Ce que tu touches dans l'appli est gardé sur le téléphone et passe avant ce tableau.
const DOORS = 4;
const SORTIES = {
  A: {
    // "Clemenceau": { "La Poterie": 0, "J.F. Kennedy": 3 },
  },
  B: {
  }
};
const DOOR_WORDS = ["tout à l'avant", "vers l'avant", "vers l'arrière", "tout à l'arrière"];

function exitDoor(line, station, dir) {
  const mine = load(`sortie.${line}.${station}.${dir}`);
  if (mine !== null && mine !== "" && !isNaN(+mine)) return +mine;
  const st = Object.keys(SORTIES[line] || {}).find(k => same(k, station));
  const v = st ? SORTIES[line][st][Object.keys(SORTIES[line][st]).find(k => same(k, dir))] : undefined;
  return typeof v === "number" ? v : null;
}

function trainSvg(door) {
  // Rame de 2 voitures, la tête à droite (sens de la marche).
  const carW = 140, carH = 46, gap = 8, x0 = 10, y0 = 18;
  const doorX = i => { // 2 portes par voiture ; i = 0 en tête (à droite)
    const car = i < 2 ? 1 : 0, k = i % 2;
    const cx = x0 + car * (carW + gap);
    return cx + (k === 0 ? carW * 0.68 : carW * 0.32);
  };
  let g = "";
  for (let c = 0; c < 2; c++) {
    const cx = x0 + c * (carW + gap);
    const nose = c === 1;
    g += nose
      ? `<path d="M${cx} ${y0} h${carW - 18} q18 0 18 18 v${carH - 18} h-${carW} z" class="t-car"/>`
      : `<rect x="${cx}" y="${y0}" width="${carW}" height="${carH}" rx="8" class="t-car"/>`;
    // fenêtres
    for (let w = 0; w < 3; w++) g += `<rect x="${cx + 10 + w * 44}" y="${y0 + 8}" width="30" height="13" rx="3" class="t-win"/>`;
  }
  g += `<rect x="${x0 + carW}" y="${y0 + 12}" width="${gap}" height="${carH - 22}" class="t-joint"/>`;
  for (let i = 0; i < DOORS; i++) {
    const x = doorX(i);
    g += `<rect x="${x - 9}" y="${y0 + 24}" width="18" height="${carH - 24}" rx="2" class="t-door${i === door ? " on" : ""}" data-door="${i}"/>`;
    g += `<rect x="${x - 16}" y="${y0 - 6}" width="32" height="${carH + 22}" class="t-hit" data-door="${i}"/>`;
  }
  if (door !== null) {
    const x = doorX(door);
    g += `<circle cx="${x}" cy="${y0 + carH + 12}" r="11" class="t-pulse"/><circle cx="${x}" cy="${y0 + carH + 12}" r="6" class="t-dot"/>`;
  }
  // sens de la marche
  const ax = x0 + 2 * carW + gap + 12;
  g += `<path d="M${ax} ${y0 + carH / 2} l14 0 m-6 -6 l6 6 l-6 6" class="t-arrow"/>`;
  g += `<line x1="0" y1="${y0 + carH + 2}" x2="330" y2="${y0 + carH + 2}" class="t-rail"/>`;
  return `<svg viewBox="0 0 330 92" role="img" aria-label="Rame vue de côté, la tête à droite">${g}</svg>`;
}

function renderTrain() {
  const card = $("train-card");
  if (!state.station || !state.dest || !state.dir) { card.hidden = true; return; }
  card.hidden = false;
  const door = exitDoor(state.line, state.dest, state.dir);
  $("train-title").textContent = "Où monter pour sortir vite à " + state.dest;
  $("train").innerHTML = trainSvg(door);
  if (door === null) {
    $("train-text").textContent = "Position pas encore connue";
    $("train-help").textContent = `À ton prochain passage à ${state.dest}, touche la porte la plus proche de l'escalator : l'appli s'en souviendra.`;
  } else {
    $("train-text").textContent = "Monte " + DOOR_WORDS[door] + " de la rame";
    $("train-help").textContent = "La rame avance vers la droite. Touche une autre porte pour corriger.";
  }
}

$("train").addEventListener("click", e => {
  const t = e.target.closest("[data-door]");
  if (!t) return;
  const i = +t.dataset.door;
  const key = `sortie.${state.line}.${state.dest}.${state.dir}`;
  if (exitDoor(state.line, state.dest, state.dir) === i && load(key) !== null) {
    try { localStorage.removeItem("metro." + key); } catch (err) {}
  } else store(key, String(i));
  renderTrain();
});

function setLine(line) {
  state.line = line;
  state.station = null;
  state.dir = null;
  state.dest = null;
  store("line", line);
  document.body.classList.toggle("line-b", line === "B");
  $("btn-a").classList.toggle("on", line === "A");
  $("btn-b").classList.toggle("on", line === "B");
  $("btn-a").setAttribute("aria-pressed", line === "A");
  $("btn-b").setAttribute("aria-pressed", line === "B");
  fillStations();
  fillDests();
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, "0");
  return m > 0 ? `${m} min ${r} s` : `${s % 60} s`;
}
function fmtShort(sec) {
  const m = Math.round(sec / 60);
  return m < 1 ? "moins d'1 min" : m + " min";
}
const hhmm = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function upcoming() {
  const now = Date.now();
  return state.passages
    .filter(p => p.line === state.line && same(p.station, state.station) && p.time > now - 20000 && directionOf(p) === state.dir)
    .sort((a, b) => a.time - b.time);
}

function render() {
  const main = $("r-main"), next = $("r-next"), note = $("r-note"), label = $("r-label");
  const status = $("status"), statusText = $("status-text");

  // Ligne d'état
  status.classList.toggle("err", !!state.error);
  if (state.error && !state.lastOk) statusText.textContent = "Données STAR injoignables · toucher pour réessayer";
  else if (state.error) statusText.textContent = "Mise à jour impossible · données de " + hhmm(state.lastOk);
  else if (state.lastOk) statusText.textContent = "Temps réel STAR · mis à jour à " + hhmm(state.lastOk);

  main.classList.remove("small", "now");
  if (!state.lastOk) {
    label.textContent = "Prochain métro dans";
    main.textContent = "…";
    if (state.error) {
      label.textContent = "";
      main.classList.add("small");
      main.textContent = "Pas de connexion aux données";
    }
    next.textContent = ""; note.textContent = "";
    return;
  }

  const atTerminus = same(state.station, state.dest);
  const list = upcoming();
  if (atTerminus) {
    label.textContent = "";
    main.classList.add("small");
    main.textContent = "Tu es déjà au terminus";
    next.textContent = "Choisis une autre station d'arrivée.";
    note.textContent = "";
    return;
  }
  if (!list.length) {
    label.textContent = "";
    main.classList.add("small");
    main.textContent = "Aucun métro annoncé";
    next.textContent = "Hors service (nuit) ou trafic interrompu.";
    note.textContent = "";
    return;
  }

  const now = Date.now();
  const first = list[0];
  const d = (first.time - now) / 1000;
  if (d <= 0) {
    label.textContent = "Prochain métro";
    main.textContent = "À quai";
    main.classList.add("now");
  } else {
    label.textContent = "Prochain métro dans";
    main.textContent = fmt(d);
    if (d < 30) main.classList.add("now");
  }

  const rest = list.slice(1, 3).map(p => fmtShort((p.time - now) / 1000));
  next.textContent = rest.length ? "Puis dans " + rest.join(", puis ") : "";

  const bits = [];
  if (!same(first.dest, state.dir)) bits.push("Terminus de cette rame : " + first.dest);
  if (first.precision && !/temps\s*r/i.test(first.precision)) bits.push("horaire " + String(first.precision).toLowerCase());
  bits.push("arrivée prévue " + hhmm(first.time).slice(0, 5));
  note.textContent = bits.join(" · ");
}
const _render = render;
render = function () { _render(); if (window.favUpdate) window.favUpdate(); };

// ---------- Démarrage ----------
$("btn-a").addEventListener("click", () => setLine("A"));
$("btn-b").addEventListener("click", () => setLine("B"));
$("station").addEventListener("change", e => {
  state.station = e.target.value;
  store("station." + state.line, state.station);
  fillDests();
  render();
});
$("dest").addEventListener("change", e => {
  state.dest = e.target.value;
  store("dest." + state.line, state.dest);
  updateDir();
  render();
});
$("status").addEventListener("click", refresh);
document.addEventListener("visibilitychange", () => {
  if (metroVisible() && Date.now() - state.lastOk > 10000) refresh();
});

setLine(load("line") === "B" ? "B" : "A");
refresh();
setInterval(render, 1000);
setInterval(() => { if (metroVisible()) refresh(); }, REFRESH_MS);
window.metroRefresh = () => { if (Date.now() - state.lastOk > 10000) refresh(); };
// Pour les favoris
window.metroGet = () => ({ line: state.line, station: state.station, dir: state.dir, dest: state.dest });
window.metroSet = (line, station, dir, dest) => {
  store("station." + line, station);
  store("dir." + line, dir);
  store("dest." + line, dest || dir);
  setLine(line);
  window.metroRefresh();
};
