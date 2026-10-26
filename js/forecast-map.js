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
    stops: [[0.1, [150, 205, 255, 0.45]], [0.5, [80, 160, 245, 0.6]], [1.5, [35, 105, 225, 0.72]], [3, [40, 175, 90, 0.78]], [6, [240, 205, 40, 0.82]], [10, [245, 125, 30, 0.86]], [20, [215, 40, 40, 0.9]]],
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

export function forecastMap(box, place) {
  box.innerHTML = `
    <div class="card-head"><h2>Carte météo</h2>
      <div class="seg" role="group" aria-label="Type de carte">
        <button type="button" data-v="rain" aria-pressed="true">Pluie</button>
        <button type="button" data-v="clouds" aria-pressed="false">Nuages</button>
        <button type="button" data-v="wind" aria-pressed="false">Vent</button>
        <button type="button" data-v="radar" aria-pressed="false">Radar</button>
      </div>
    </div>
    <div class="map tall" id="fm-map">
      <span class="map-badge" id="fm-time">Chargement…</span>
      <div class="map-btns">
        <button type="button" id="fm-me" aria-label="Centrer sur ${esc(place.name)}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>
        <button type="button" id="fm-zone" aria-label="Voir toute la zone">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
        </button>
      </div>
    </div>
    <div class="player">
      <button type="button" class="play" id="fm-play" aria-label="Lancer l'animation">${PLAY}</button>
      <input type="range" id="fm-range" min="0" max="0" value="0" aria-label="Heure affichée">
    </div>
    <div class="legend" id="fm-legend"></div>
    <p class="small" id="fm-note"></p>`;

  const $ = s => box.querySelector(s);
  if (!window.L) { $("#fm-map").innerHTML = errorBox("Carte indisponible."); return () => {}; }

  const map = L.map($("#fm-map"), { zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 13 }).setView([place.lat, place.lon], 9);
  map.createPane("wx").style.zIndex = 350;
  const labels = map.createPane("labels"); labels.style.zIndex = 450; labels.style.pointerEvents = "none";

  // Plan classique sans noms, puis la météo, puis les noms des villes par-dessus pour qu'ils restent lisibles
  const base = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap, © CARTO" }).addTo(map);
  const names = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", pane: "labels" }).addTo(map);
  let errs = 0;
  base.on("tileerror", () => {
    if (++errs !== 3) return;
    map.removeLayer(base); map.removeLayer(names);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  });
  L.circleMarker([place.lat, place.lon], { radius: 7, color: "#FFFFFF", weight: 3, fillColor: "#E5484D", fillOpacity: 1, pane: "markerPane" }).addTo(map);
  $("#fm-me").addEventListener("click", () => map.setView([place.lat, place.lon], 9));
  setTimeout(() => map.invalidateSize(), 200);

  const badge = $("#fm-time"), range = $("#fm-range"), play = $("#fm-play"), legend = $("#fm-legend"), note = $("#fm-note");
  let mode = "rain", data = null, overlay = null, idx = 0, timer = null, alive = true;
  const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 360;
  const frames = {}; // images déjà calculées
  let radar = null; // { frames, layers, nPast, base, src }

  const stop = () => { clearInterval(timer); timer = null; play.innerHTML = PLAY; play.setAttribute("aria-label", "Lancer l'animation"); };
  const start = () => { timer = setInterval(() => show((idx + 1) % (+range.max + 1)), mode === "radar" ? 800 : 700); play.innerHTML = PAUSE; play.setAttribute("aria-label", "Mettre en pause"); };
  play.addEventListener("click", () => timer ? stop() : start());
  range.addEventListener("input", () => { stop(); show(+range.value); });

  function show(i) {
    idx = i; range.value = i;
    if (mode === "radar") return showRadar(i);
    if (!data) return;
    const k = mode + i;
    const url = frames[k] || (frames[k] = drawFrame(data, mode, i, canvas));
    if (!overlay) overlay = L.imageOverlay(url, data.bounds, { pane: "wx", interactive: false }).addTo(map);
    else overlay.setUrl(url);
    badge.textContent = (i === 0 ? "Maintenant · " : "") + dayHour(data.times[i]);
    badge.classList.toggle("future", i > 0);
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
    mode = v;
    box.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
    setLegend();
    if (v === "radar") {
      if (overlay) overlay.setOpacity(0);
      return loadRadar();
    }
    if (radar) Object.values(radar.layers).forEach(l => l.setOpacity(0));
    if (overlay) overlay.setOpacity(1);
    if (!data) {
      badge.textContent = "Chargement des prévisions…";
      try { data = await loadGrid(place); } catch { badge.textContent = "Prévisions indisponibles"; return; }
      if (!alive || mode !== v) return;
      $("#fm-zone").addEventListener("click", () => map.fitBounds(data.bounds));
    }
    range.max = data.times.length - 1;
    show(Math.min(idx, data.times.length - 1));
  }

  // Radar observé (LibreWXR / EUMETNET OPERA, RainViewer en secours), sur le même fond de carte
  async function loadRadar() {
    if (!radar) {
      badge.textContent = "Chargement du radar…";
      const SOURCES = [
        { json: "https://api.librewxr.net/public/weather-maps.json", base: () => "https://api.librewxr.net", native: 12, attribution: 'Radar <a href="https://librewxr.net" target="_blank" rel="noopener">LibreWXR</a>' },
        { json: "https://api.rainviewer.com/public/weather-maps.json", base: j => j.host, native: 7, attribution: "Radar © RainViewer" }
      ];
      for (const s of SOURCES) {
        try {
          const j = await getJSON(s.json, { timeout: 8000 });
          const past = (j.radar?.past || []).slice(-7), next = j.radar?.nowcast || [];
          if (!past.length) continue;
          radar = { frames: [...past, ...next], nPast: past.length, base: s.base(j), src: s, layers: {} };
          break;
        } catch { /* source suivante */ }
      }
      if (!alive || mode !== "radar") return;
      if (!radar) { badge.textContent = "Radar indisponible pour le moment"; return; }
    }
    range.max = radar.frames.length - 1;
    note.textContent = "Pluie mesurée par les radars la dernière heure" + (radar.frames.length > radar.nPast ? ", puis prévue sur la suivante (heure sur fond bleu)." : ".");
    show(radar.nPast - 1);
  }
  function showRadar(i) {
    if (!radar) return;
    const layerFor = n => radar.layers[n] || (radar.layers[n] = L.tileLayer(`${radar.base}${radar.frames[n].path}/512/{z}/{x}/{y}/2/1_1.png`, {
      tileSize: 512, zoomOffset: -1, maxNativeZoom: radar.src.native, maxZoom: 13, opacity: 0, pane: "wx", attribution: radar.src.attribution
    }).addTo(map));
    Object.entries(radar.layers).forEach(([n, l]) => +n !== i && l.setOpacity(0));
    layerFor(i).setOpacity(0.8);
    if (i + 1 < radar.frames.length) layerFor(i + 1);
    const fut = i >= radar.nPast;
    badge.textContent = hm(new Date(radar.frames[i].time * 1000)) + (fut ? " · prévision" : i === radar.nPast - 1 ? " · dernière mesure" : " · mesuré");
    badge.classList.toggle("future", fut);
  }

  box.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => pick(b.dataset.v)));
  pick("rain");
  return () => { alive = false; stop(); map.remove(); };
}
