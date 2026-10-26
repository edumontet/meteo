// Carte de prévision « façon Windy » : pluie, nuages et vent heure par heure sur 48 h,
// dessinés au-dessus d'un plan classique (routes, villes) avec les noms des villes par-dessus.
// Données : Open-Meteo (Météo-France AROME/ARPEGE) sur une grille de points autour du lieu.
import { getJSON, hm, esc, errorBox } from "./util.js";

const PLAY = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="#0B1220"/></svg>`;
const PAUSE = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="#0B1220"/></svg>`;

// Grille : 13 × 13 points, environ 270 km de côté
const ROWS = 13, COLS = 13, DLAT = 0.2, DLON = 0.3;
const cache = new Map(); // lieu -> { t, data }

const MODES = {
  rain: {
    label: "Pluie", unit: "mm/h",
    stops: [[0.04, [150, 205, 255, 0]], [0.1, [150, 205, 255, 0.45]], [0.5, [80, 160, 245, 0.6]], [1.5, [35, 105, 225, 0.72]], [3, [40, 175, 90, 0.78]], [6, [240, 205, 40, 0.82]], [10, [245, 125, 30, 0.86]], [20, [215, 40, 40, 0.9]]],
    legend: [["0,1", "#96CDFF"], ["0,5", "#50A0F5"], ["1,5", "#2369E1"], ["3", "#28AF5A"], ["6", "#F0CD28"], ["10", "#F57D1E"], ["20+", "#D72828"]],
    note: "Pluie prévue heure par heure (mm par heure). Les zones colorées montrent où il pleut."
  },
  clouds: {
    label: "Nuages", unit: "%",
    stops: [[10, [60, 72, 95, 0.0]], [40, [60, 72, 95, 0.28]], [70, [60, 72, 95, 0.48]], [100, [55, 65, 88, 0.66]]],
    legend: [["Peu", "rgba(60,72,95,0.25)"], ["Moyen", "rgba(60,72,95,0.5)"], ["Couvert", "rgba(55,65,88,0.75)"]],
    note: "Couverture nuageuse prévue : plus c'est foncé, plus le ciel est couvert."
  },
  wind: {
    label: "Vent", unit: "km/h",
    stops: [[0, [98, 113, 183, 0.5]], [15, [57, 161, 199, 0.5]], [30, [77, 191, 100, 0.52]], [45, [230, 200, 60, 0.56]], [60, [240, 130, 40, 0.6]], [80, [220, 50, 50, 0.64]], [100, [160, 40, 140, 0.68]]],
    legend: [["0", "#6271B7"], ["15", "#39A1C7"], ["30", "#4DBF64"], ["45", "#E6C83C"], ["60", "#F08228"], ["80", "#DC3232"], ["100+", "#A0288C"]],
    note: "Vent moyen prévu (km/h). Les flèches indiquent où il souffle."
  }
};

function colorAt(stops, v) {
  if (v == null || isNaN(v) || v < stops[0][0]) return null;
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
      return ca.map((x, k) => x + (cb[k] - x) * t);
    }
  }
  return stops[stops.length - 1][1];
}

async function loadGrid(place) {
  const key = place.lat + "," + place.lon;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60000) return hit.data;
  const lat0 = place.lat + (ROWS - 1) / 2 * DLAT, lon0 = place.lon - (COLS - 1) / 2 * DLON; // coin nord-ouest
  const lats = [], lons = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { lats.push((lat0 - r * DLAT).toFixed(3)); lons.push((lon0 + c * DLON).toFixed(3)); }
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
    `&hourly=precipitation,cloud_cover,wind_speed_10m,wind_direction_10m&forecast_hours=48&timezone=Europe%2FParis&timeformat=unixtime`, { timeout: 25000 });
  const arr = Array.isArray(j) ? j : [j];
  const times = arr[0].hourly.time;
  const grab = v => times.map((_, h) => Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => arr[r * COLS + c]?.hourly?.[v]?.[h] ?? null)));
  const data = {
    times, lat0, lon0,
    bounds: [[lat0 - (ROWS - 1) * DLAT, lon0], [lat0, lon0 + (COLS - 1) * DLON]],
    rain: grab("precipitation"), clouds: grab("cloud_cover"), wind: grab("wind_speed_10m"), dir: grab("wind_direction_10m")
  };
  cache.set(key, { t: Date.now(), data });
  return data;
}

// Image d'une heure, interpolée entre les points de la grille
function drawFrame(data, mode, h, canvas) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext("2d");
  const grid = data[mode][h], stops = MODES[mode].stops;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const gy = y / (H - 1) * (ROWS - 1), r0 = Math.floor(gy), r1 = Math.min(ROWS - 1, r0 + 1), fy = gy - r0;
    for (let x = 0; x < W; x++) {
      const gx = x / (W - 1) * (COLS - 1), c0 = Math.floor(gx), c1 = Math.min(COLS - 1, c0 + 1), fx = gx - c0;
      const a = grid[r0][c0], b = grid[r0][c1], c = grid[r1][c0], d = grid[r1][c1];
      if (a == null || b == null || c == null || d == null) continue;
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      const col = colorAt(stops, v);
      if (!col) continue;
      const i = (y * W + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3] * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (mode === "wind") { // flèches dans le sens du vent
    ctx.strokeStyle = "rgba(20,28,45,0.75)"; ctx.fillStyle = "rgba(20,28,45,0.75)"; ctx.lineWidth = 1.1;
    const dirs = data.dir[h];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const dg = dirs[r][c]; if (dg == null) continue;
      const ang = (dg + 180) * Math.PI / 180; // direction vers laquelle souffle le vent
      const cx = c / (COLS - 1) * (W - 1), cy = r / (ROWS - 1) * (H - 1), L = 5;
      const dx = Math.sin(ang) * L, dy = -Math.cos(ang) * L;
      ctx.beginPath(); ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + dx, cy + dy);
      ctx.lineTo(cx + dx - Math.sin(ang - 0.5) * 3, cy + dy + Math.cos(ang - 0.5) * 3);
      ctx.lineTo(cx + dx - Math.sin(ang + 0.5) * 3, cy + dy + Math.cos(ang + 0.5) * 3);
      ctx.closePath(); ctx.fill();
    }
  }
  return canvas.toDataURL("image/png");
}

const dayHour = t => {
  const d = new Date(t * 1000);
  return d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "Europe/Paris" }) + " " + hm(d).replace(":00", "h");
};

// ---------- Fond de carte « plan » clair façon Plans d'Apple (OpenFreeMap, sans clé) ----------
const MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
let libPromise = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = MAPLIBRE + ".css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = MAPLIBRE + ".js"; js.onload = resolve; js.onerror = reject; document.head.appendChild(js);
  });
  return libPromise;
}

const PAL = { land: "#E3F1CF", wood: "#CDE7B0", grass: "#D7EEBE", park: "#C9E6A8", water: "#9FCBF2", urban: "#EEF0E4", road: "#FFFFFF", major: "#FBE7A1", border: "#A07AA8" };
let styleCache = null;
async function lightStyle() {
  if (styleCache) return JSON.parse(JSON.stringify(styleCache));
  const st = await getJSON("https://tiles.openfreemap.org/styles/liberty", { timeout: 12000 });
  st.layers = st.layers.filter(l => l.type !== "fill-extrusion" && !/poi|housenumber|building/i.test(l.id + (l["source-layer"] || "")));
  for (const l of st.layers) {
    const sl = l["source-layer"] || "", id = l.id;
    l.paint = l.paint || {}; l.layout = l.layout || {};
    if (l.type === "background") l.paint["background-color"] = PAL.land;
    else if (l.type === "fill" && (sl === "water" || /water/.test(id))) l.paint["fill-color"] = PAL.water;
    else if (l.type === "line" && sl === "waterway") l.paint["line-color"] = PAL.water;
    else if (l.type === "fill" && sl === "landcover") l.paint["fill-color"] = /wood|forest/.test(id) ? PAL.wood : /ice|sand/.test(id) ? "#F2F2EA" : PAL.grass;
    else if (l.type === "fill" && sl === "park") l.paint["fill-color"] = PAL.park;
    else if (l.type === "fill" && sl === "landuse") { l.paint["fill-color"] = /residential|suburb|neighbourhood/.test(id) ? PAL.urban : PAL.grass; l.paint["fill-opacity"] = 0.6; }
    else if (l.type === "line" && sl === "boundary") { l.paint["line-color"] = PAL.border; }
    else if (l.type === "line" && sl === "transportation" && /motorway|trunk|primary/.test(id) && !/casing/.test(id)) l.paint["line-color"] = PAL.major;
    else if (l.type === "symbol" && sl === "place") {
      // noms de villes plus gros et bien contrastés, comme dans Plans
      const big = /city|capital/.test(id), town = /town/.test(id);
      if (big || town) l.layout["text-size"] = big ? ["interpolate", ["linear"], ["zoom"], 5, 13, 9, 19, 12, 22] : ["interpolate", ["linear"], ["zoom"], 7, 12, 10, 16, 13, 18];
      l.paint["text-color"] = "#1B2333"; l.paint["text-halo-color"] = "rgba(255,255,255,0.9)"; l.paint["text-halo-width"] = 1.6;
    }
  }
  styleCache = st;
  return JSON.parse(JSON.stringify(st));
}

export function forecastMap(box, place) {
  box.innerHTML = `
    <div class="card-head"><h2>Carte météo</h2>
      <div class="seg" role="group" aria-label="Type de carte">
        <button type="button" data-v="radar" aria-pressed="true">Pluie</button>
        <button type="button" data-v="rain" aria-pressed="false">48 h</button>
        <button type="button" data-v="clouds" aria-pressed="false">Nuages</button>
        <button type="button" data-v="wind" aria-pressed="false">Vent</button>
      </div>
    </div>
    <div class="map tall light" id="fm-map">
      <span class="map-badge" id="fm-time">Chargement…</span>
      <div class="map-btns">
        <button type="button" id="fm-me" aria-label="Centrer sur ${esc(place.name)}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>
        <button type="button" id="fm-zone" aria-label="Voir la région">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
        </button>
      </div>
    </div>
    <div class="player">
      <button type="button" class="play" id="fm-play" aria-label="Lancer l'animation">${PLAY}</button>
      <div style="flex-grow:1;display:flex;flex-direction:column;gap:4px;min-width:0">
        <input type="range" id="fm-range" min="0" max="0" value="0" aria-label="Moment affiché" style="width:100%">
        <div id="fm-ticks" style="display:flex;justify-content:space-between;font-size:11px;color:#9AA8C2;font-weight:600"></div>
      </div>
    </div>
    <div class="legend" id="fm-legend"></div>
    <p class="small" id="fm-note"></p>`;

  const $ = s => box.querySelector(s);
  const badge = $("#fm-time"), range = $("#fm-range"), play = $("#fm-play"), legend = $("#fm-legend"), note = $("#fm-note"), ticks = $("#fm-ticks");
  let map = null, mode = "radar", grid = null, radar = null, idx = 0, timer = null, alive = true, ready = false;
  const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 360;
  const frames = {};
  let firstLabel; // les couches météo passent sous les noms de villes

  const stop = () => { clearInterval(timer); timer = null; play.innerHTML = PLAY; play.setAttribute("aria-label", "Lancer l'animation"); };
  const start = () => {
    timer = setInterval(() => show((idx + 1) % (+range.max + 1)), mode === "radar" ? 500 : 700);
    play.innerHTML = PAUSE; play.setAttribute("aria-label", "Mettre en pause");
  };
  play.addEventListener("click", () => timer ? stop() : start());
  range.addEventListener("input", () => { stop(); show(+range.value); });

  const setTicks = list => { ticks.innerHTML = list.map(t => `<span>${t}</span>`).join(""); };

  function show(i) {
    idx = i; range.value = i;
    if (!ready) return;
    if (mode === "radar") return showRadar(i);
    if (!grid) return;
    const k = mode + i;
    const url = frames[k] || (frames[k] = drawFrame(grid, mode, i, canvas));
    const src = map.getSource("fc");
    const [[s, w], [n, e]] = grid.bounds;
    const coords = [[w, n], [e, n], [e, s], [w, s]];
    if (!src) {
      map.addSource("fc", { type: "image", url, coordinates: coords });
      map.addLayer({ id: "fc", type: "raster", source: "fc", paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" } }, firstLabel);
    } else src.updateImage({ url, coordinates: coords });
    badge.textContent = (i === 0 ? "Maintenant · " : "") + dayHour(grid.times[i]);
    badge.classList.toggle("future", i > 0);
  }

  // Radar : pluie mesurée la dernière heure puis prévue (LibreWXR / EUMETNET OPERA, RainViewer en secours)
  async function loadRadar() {
    if (!radar) {
      badge.textContent = "Chargement du radar…";
      const SOURCES = [
        { json: "https://api.librewxr.net/public/weather-maps.json", base: () => "https://api.librewxr.net", native: 12, attribution: '<a href="https://librewxr.net" target="_blank" rel="noopener">LibreWXR</a> / EUMETNET OPERA' },
        { json: "https://api.rainviewer.com/public/weather-maps.json", base: j => j.host, native: 7, attribution: "RainViewer" }
      ];
      for (const s of SOURCES) {
        try {
          const j = await getJSON(s.json, { timeout: 8000 });
          const past = (j.radar?.past || []).slice(-7), next = j.radar?.nowcast || [];
          if (!past.length) continue;
          radar = { frames: [...past, ...next], nPast: past.length, base: s.base(j), src: s, added: new Set() };
          break;
        } catch { /* source suivante */ }
      }
      if (!alive) return;
      if (!radar) { badge.textContent = "Radar indisponible pour le moment"; return; }
    }
    if (mode !== "radar") return;
    range.max = radar.frames.length - 1;
    const f = radar.frames, t = k => hm(new Date(f[k].time * 1000));
    setTicks([t(0), t(Math.floor((f.length - 1) / 2)), t(f.length - 1)]);
    note.textContent = "Pluie mesurée par les radars la dernière heure" + (f.length > radar.nPast ? ", puis prévue pour la suite (heure sur fond bleu). Lance l'animation pour voir les averses se déplacer." : ".");
    show(radar.nPast - 1);
  }
  function radarLayer(n) {
    const id = "rd" + n;
    if (!radar.added.has(n)) {
      radar.added.add(n);
      map.addSource(id, { type: "raster", tiles: [`${radar.base}${radar.frames[n].path}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256, maxzoom: radar.src.native, attribution: "Radar " + radar.src.attribution });
      map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-opacity-transition": { duration: 0 } } }, firstLabel);
    }
    return id;
  }
  function showRadar(i) {
    if (!radar) return;
    radar.added.forEach(n => map.setPaintProperty("rd" + n, "raster-opacity", 0));
    map.setPaintProperty(radarLayer(i), "raster-opacity", 0.8);
    if (i + 1 < radar.frames.length) radarLayer(i + 1); // préchargement
    const fut = i >= radar.nPast;
    badge.textContent = hm(new Date(radar.frames[i].time * 1000)) + (fut ? " · prévision" : i === radar.nPast - 1 ? " · maintenant" : "");
    badge.classList.toggle("future", fut);
  }

  function setLegend() {
    if (mode === "radar") {
      legend.innerHTML = `<span><i style="background:#9BD4FF"></i>Faible</span><span><i style="background:#3C9BF0"></i>Modérée</span><span><i style="background:#1F5FD0"></i>Forte</span>`;
      return;
    }
    const m = MODES[mode];
    legend.innerHTML = `<span style="font-weight:700">${m.unit}</span>` + m.legend.map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join("");
    note.textContent = m.note + " Zone d'environ 250 km autour de toi.";
  }

  async function pick(v) {
    stop();
    if ((mode === "radar") !== (v === "radar")) idx = 0;
    mode = v;
    box.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
    setLegend();
    if (!ready) return;
    if (map.getLayer("fc")) map.setPaintProperty("fc", "raster-opacity", v === "radar" ? 0 : 1);
    if (radar) radar.added.forEach(n => map.setPaintProperty("rd" + n, "raster-opacity", 0));
    if (v === "radar") return loadRadar();
    if (!grid) {
      badge.textContent = "Chargement des prévisions…";
      try { grid = await loadGrid(place); } catch { badge.textContent = "Prévisions indisponibles"; return; }
      if (!alive || mode !== v) return;
    }
    range.max = grid.times.length - 1;
    const d = k => dayHour(grid.times[k]);
    setTicks([d(0), d(12), d(24), d(36), d(47)].map(x => x.replace(/^(\S+)\.? /, "$1 ")));
    show(Math.min(idx, grid.times.length - 1));
  }
  box.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => pick(b.dataset.v)));
  setLegend();

  (async () => {
    try {
      await loadMapLibre();
      const style = await lightStyle();
      if (!alive) return;
      map = new maplibregl.Map({
        container: $("#fm-map"), style, center: [place.lon, place.lat], zoom: 7.3, minZoom: 4, maxZoom: 12,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      const dot = document.createElement("div"); dot.className = "me-dot";
      new maplibregl.Marker({ element: dot }).setLngLat([place.lon, place.lat]).addTo(map);
      $("#fm-me").addEventListener("click", () => map.easeTo({ center: [place.lon, place.lat], zoom: 9 }));
      $("#fm-zone").addEventListener("click", () => map.easeTo({ center: [place.lon, place.lat], zoom: 6.5 }));
      map.on("load", () => {
        firstLabel = map.getStyle().layers.find(l => l.type === "symbol")?.id;
        ready = true;
        pick(mode);
      });
    } catch {
      $("#fm-map").innerHTML = errorBox("Carte indisponible pour le moment. Vérifie ta connexion puis actualise.");
    }
  })();
  return () => { alive = false; stop(); map?.remove(); };
}
