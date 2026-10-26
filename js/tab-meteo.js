import { getJSON, esc, nf, hm, hmH, dayShort, wmo, icon, barChart, errorBox, inDays, daysBetween, ymd, weekdayLetter, parisMidnight } from "./util.js";
import { moonInfo, moonSVG } from "./moon.js";
import { createTidePredictor, stations } from "./tides-engine.js";

export async function render(el, { place }) {
  el.innerHTML = `
    <div id="m-days"><div class="loading">Chargement de la météo…</div></div>
    <section class="card" id="m-rain"><h2>Pluie dans l'heure</h2><div class="loading">…</div></section>
    <section class="card" id="m-radar"></section>
    <section class="card" id="m-moon"></section>
    <section class="card" id="m-tides"></section>`;

  // Ce qui ne dépend pas du réseau s'affiche tout de suite.
  renderMoon(el.querySelector("#m-moon"));
  renderTides(el.querySelector("#m-tides"));
  renderRadar(el.querySelector("#m-radar"), place);

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_gusts_10m_max` +
    `&minutely_15=precipitation&past_minutely_15=2&forecast_minutely_15=10` +
    `&current=temperature_2m,weather_code` +
    `&timezone=Europe%2FParis&past_days=1&forecast_days=2&timeformat=unixtime`;
  let data;
  try {
    data = await getJSON(url);
  } catch (e) {
    el.querySelector("#m-days").innerHTML = errorBox("Prévisions indisponibles pour le moment (" + e.message + ").");
    el.querySelector("#m-rain").innerHTML = `<h2>Pluie dans l'heure</h2>` + errorBox("Données indisponibles.");
    return;
  }
  renderDays(el.querySelector("#m-days"), data);
  renderRain(el.querySelector("#m-rain"), data);
}

/* ---------- Hier / Aujourd'hui / Demain ---------- */
function renderDays(box, data) {
  const d = data.daily;
  const labels = ["Hier", "Aujourd'hui", "Demain"];
  const days = d.time.slice(0, 3).map((t, i) => {
    const [txt, kind] = wmo(d.weather_code[i]);
    const snow = d.snowfall_sum[i] || 0;
    const tmin = d.temperature_2m_min[i];
    const pr = d.precipitation_sum[i] || 0;
    let snowTxt = "Aucun";
    if (snow >= 0.1) snowTxt = "Oui · " + nf(snow, 1) + " cm";
    else if (tmin <= 1 && pr > 0.5) snowTxt = "Possible";
    else if (tmin <= 2 && pr > 0.5) snowTxt = "Faible";
    return {
      label: labels[i], date: new Date(t * 1000), txt, kind,
      min: d.temperature_2m_min[i], max: d.temperature_2m_max[i],
      rain: pr, prob: d.precipitation_probability_max?.[i], gust: d.wind_gusts_10m_max?.[i], snowTxt
    };
  });
  let sel = 1;
  const draw = () => {
    const s = days[sel];
    box.innerHTML = `
      <div class="days" role="group" aria-label="Choisir le jour">
        ${days.map((x, i) => `
          <button type="button" class="day" data-i="${i}" aria-pressed="${i === sel}">
            <span class="lbl">${x.label}</span>${icon(x.kind)}
            <span class="mm"><span class="cold">${nf(x.min)}°</span> <span style="color:#9AA8C2">/</span> <span class="warm">${nf(x.max)}°</span></span>
          </button>`).join("")}
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-head"><h2>${s.label}</h2><span class="sub">${dayShort(s.date)}</span></div>
        <p class="txt">${esc(s.txt)}${s.label === "Aujourd'hui" && data.current ? ` · ${nf(data.current.temperature_2m)}° en ce moment` : ""}</p>
        <div class="tiles">
          <div class="tile"><span class="k">Température min</span><span class="v cold" style="font-size:26px">${nf(s.min)}°</span></div>
          <div class="tile"><span class="k">Température max</span><span class="v warm" style="font-size:26px">${nf(s.max)}°</span></div>
          <div class="tile"><span class="k">Cumul de pluie</span><span class="v" style="font-size:20px">${nf(s.rain, 1)} mm</span>${s.label !== "Hier" && s.prob != null ? `<span class="s">risque ${nf(s.prob)} %</span>` : ""}</div>
          <div class="tile"><span class="k">Risque de neige</span><span class="v" style="font-size:20px">${s.snowTxt}</span>${s.gust != null ? `<span class="s">rafales ${nf(s.gust)} km/h</span>` : ""}</div>
        </div>
      </section>`;
    box.querySelectorAll(".day").forEach(b => b.addEventListener("click", () => { sel = +b.dataset.i; draw(); }));
  };
  draw();
}

/* ---------- Pluie dans l'heure ---------- */
const cls = r => r < 0.1 ? "sec" : r < 2.5 ? "faible" : r < 7.6 ? "moyenne" : "forte";

function renderRain(box, data) {
  const m = data.minutely_15;
  if (!m || !m.time?.length) { box.innerHTML = `<h2>Pluie dans l'heure</h2>` + errorBox("Pas de prévision fine disponible ici."); return; }
  const now = Date.now();
  // Chaque valeur = pluie tombée pendant les 15 min qui précèdent l'heure indiquée.
  const slots = m.time.map((t, i) => ({ end: t * 1000, start: t * 1000 - 900000, rate: (m.precipitation[i] || 0) * 4 }));
  let k = slots.findIndex(s => s.end > now);
  if (k < 0) k = slots.length - 1;
  const fut = slots.slice(k, k + 9); // ~2 h
  const raining = fut[0].rate >= 0.1;
  let lead, pill;
  if (raining) {
    const stop = fut.findIndex(s => s.rate < 0.1);
    lead = stop > 0 ? `Ça s'arrête vers ${hmH(new Date(fut[stop - 1].end))}` : "La pluie continue pendant au moins 2 h";
    pill = `<span class="pill" style="background:#5BB8FF">EN COURS</span>`;
  } else {
    const start = fut.findIndex(s => s.rate >= 0.1);
    lead = start >= 0 ? `Pluie vers ${hmH(new Date(fut[start].start))}` : "Pas de pluie dans les 2 prochaines heures";
    pill = start >= 0 ? `<span class="pill" style="background:#F4C76B">BIENTÔT</span>` : `<span class="pill" style="background:#4CC38A">SEC</span>`;
  }
  const at = t => (slots.find(s => s.start <= t && s.end > t) || fut[fut.length - 1]).rate;
  const r20 = at(now + 20 * 60000);
  const words = { sec: "sec", faible: "pluie faible", moyenne: "pluie moyenne", forte: "pluie forte" };
  const detail = (raining ? `${cap1(words[cls(fut[0].rate)])} maintenant. ` : "") + `Dans 20 min : ${words[cls(r20)]}.`;

  // Courbe lissée sur 3 bandes Faible / Moyenne / Forte
  const W = 340, H = 196, top = 0, bandH = 50, base = top + bandH * 3; // y=150 = 0 mm/h
  const yOf = r => {
    if (r <= 0) return base;
    if (r < 2.5) return base - bandH * (r / 2.5);
    if (r < 7.6) return base - bandH - bandH * ((r - 2.5) / 5.1);
    return Math.max(top + 4, base - 2 * bandH - bandH * Math.min(1, (r - 7.6) / 12));
  };
  const n = fut.length;
  const X = i => 70 + i * (W - 78) / (n - 1);
  const pts = fut.map((s, i) => [X(i), yOf(s.rate)]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(base, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(base, p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${d} L${pts[n - 1][0]} ${base} L${pts[0][0]} ${base} Z`;
  const labels = fut.map((s, i) => i % 2 === 0 ? `<text x="${X(i).toFixed(1)}" y="${base + 20}" text-anchor="middle" fill="${i === 0 ? "#EAF0FA" : "#9AA8C2"}" font-size="11" font-weight="${i === 0 ? 800 : 600}">${i === 0 ? "Maint." : hm(new Date(s.end))}</text>` : "").join("");
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Intensité de la pluie sur les 2 prochaines heures">
    <rect x="0" y="0" width="${W}" height="50" fill="#0F182B"/><rect x="0" y="50" width="${W}" height="50" fill="#121C30"/><rect x="0" y="100" width="${W}" height="50" fill="#0F182B"/>
    <line x1="0" y1="50" x2="${W}" y2="50" stroke="#22304D"/><line x1="0" y1="100" x2="${W}" y2="100" stroke="#22304D"/><line x1="0" y1="150" x2="${W}" y2="150" stroke="#2A3A5C"/>
    <text x="8" y="30" fill="#9AA8C2" font-size="13" font-weight="700">Forte</text>
    <text x="8" y="80" fill="#9AA8C2" font-size="13" font-weight="700">Moyenne</text>
    <text x="8" y="130" fill="#9AA8C2" font-size="13" font-weight="700">Faible</text>
    <path d="${area}" fill="#5BB8FF" fill-opacity="0.22"/>
    <path d="${d}" fill="none" stroke="#5BB8FF" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${X(0)}" y1="0" x2="${X(0)}" y2="150" stroke="#EAF0FA" stroke-dasharray="3 3" opacity="0.6"/>
    ${labels}
  </svg>`;
  box.innerHTML = `
    <div class="card-head"><h2>Pluie dans l'heure</h2>${pill}</div>
    <div style="display:flex;flex-direction:column;gap:4px"><p class="lead">${lead}</p><p class="txt">${detail}</p></div>
    ${svg}
    <p class="small">Prévision Météo-France AROME par quart d'heure, actualisée toutes les heures.</p>`;
}
const cap1 = s => s[0].toUpperCase() + s.slice(1);

/* ---------- Radar ---------- */
// Une seule carte de France zoomable (Leaflet) pour le radar et les nuages, centrée sur le lieu (Rennes par défaut).
// Pas de clé d'API : radar RainViewer (offre gratuite : zoom 7 max, schéma « Universal Blue », 100 requêtes/min)
// et images satellite EUMETSAT (Meteosat). La prévision reste sur Windy.
const FRANCE = [[41.3, -5.3], [51.2, 9.7]];
const PLAY_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="#0B1220"/></svg>`;
const PAUSE_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="#0B1220"/></svg>`;

function renderRadar(box, place) {
  box.innerHTML = `
    <div class="card-head"><h2>Radar pluie &amp; nuages</h2>
      <div class="seg" role="group" aria-label="Type de carte">
        <button type="button" data-v="radar" aria-pressed="true">Radar</button>
        <button type="button" data-v="clouds" aria-pressed="false">Nuages</button>
        <button type="button" data-v="rain" aria-pressed="false">Prévue</button>
      </div>
    </div>
    <div id="radar-body"></div>`;
  const body = box.querySelector("#radar-body");
  const windy = () => `
    <iframe class="frame tall" loading="lazy" title="Carte Windy de la pluie prévue"
      src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=6&overlay=rain&product=ecmwf&level=surface&lat=${place.lat}&lon=${place.lon}&detailLat=${place.lat}&detailLon=${place.lon}&marker=true&message=true"></iframe>
    <p class="small">Pluie prévue heure par heure : bouton lecture en bas de la carte.</p>`;
  let cleanup = null;
  const pick = v => {
    box.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
    if (cleanup) { cleanup(); cleanup = null; }
    if (v === "rain") body.innerHTML = windy();
    else cleanup = liveMap(body, place, v);
  };
  box.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => pick(b.dataset.v)));
  pick("radar");
}

function liveMap(body, place, mode) {
  const isRadar = mode === "radar";
  body.innerHTML = `
    <div class="map tall" id="radar-map">
      <span class="map-badge" id="radar-time">Chargement…</span>
      <div class="map-btns">
        <button type="button" id="go-me" aria-label="Centrer sur ${esc(place.name)}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>
        <button type="button" id="go-fr" aria-label="Voir toute la France">FR</button>
      </div>
    </div>
    ${isRadar ? `<div class="player">
      <button type="button" class="play" id="radar-play" aria-label="Lancer l'animation">${PLAY_SVG}</button>
      <input type="range" id="radar-range" min="0" max="0" value="0" aria-label="Moment affiché">
    </div>
    <p class="small">Pluie observée la dernière heure (toutes les 10 min). Pince pour zoomer. Pour la suite, regarde « Prévue ».</p>`
    : `<p class="small">Image satellite infrarouge Meteosat (EUMETSAT), jour et nuit : plus c'est blanc, plus les nuages sont hauts et épais.</p>`}`;
  const badge = body.querySelector("#radar-time");
  if (!window.L) { body.querySelector("#radar-map").innerHTML = errorBox("Carte indisponible."); return () => {}; }

  const map = L.map(body.querySelector("#radar-map"), { zoomControl: true, attributionControl: true, minZoom: 4, maxZoom: 11 });
  map.fitBounds(FRANCE);
  baseMap(map);
  L.circleMarker([place.lat, place.lon], { radius: 7, color: "#0B1220", weight: 2, fillColor: "#F4C76B", fillOpacity: 1, pane: "markerPane" })
    .bindTooltip(esc(place.name), { permanent: true, direction: "right", offset: [8, 0], className: "me-tip" }).addTo(map);
  body.querySelector("#go-me").addEventListener("click", () => map.setView([place.lat, place.lon], 8));
  body.querySelector("#go-fr").addEventListener("click", () => map.fitBounds(FRANCE));
  setTimeout(() => { map.invalidateSize(); map.fitBounds(FRANCE); }, 200);

  if (!isRadar) {
    cloudLayer(map, badge);
    return () => map.remove();
  }

  let frames = [], host = "", layers = {}, idx = 0, timer = null, alive = true;
  const range = body.querySelector("#radar-range"), play = body.querySelector("#radar-play");
  // Une couche n'est créée que quand on l'affiche (tuiles de 512 px) : on reste loin de la limite de 100 requêtes/min.
  const layerFor = i => layers[i] || (layers[i] = L.tileLayer(`${host}${frames[i].path}/512/{z}/{x}/{y}/2/1_1.png`, {
    tileSize: 512, zoomOffset: -1, maxNativeZoom: 8, maxZoom: 11, opacity: 0, attribution: "Radar © RainViewer"
  }).addTo(map));
  const showFrame = i => {
    if (!frames.length) return;
    if (layers[idx]) layers[idx].setOpacity(0);
    idx = i; layerFor(idx).setOpacity(0.85);
    if (idx + 1 < frames.length) layerFor(idx + 1); // préchargement de l'image suivante
    range.value = idx;
    badge.textContent = hm(new Date(frames[idx].time * 1000)) + (idx === frames.length - 1 ? " · dernière image" : "");
  };
  const stop = () => { clearInterval(timer); timer = null; play.innerHTML = PLAY_SVG; play.setAttribute("aria-label", "Lancer l'animation"); };
  const start = () => {
    timer = setInterval(() => showFrame((idx + 1) % frames.length), 800);
    play.innerHTML = PAUSE_SVG; play.setAttribute("aria-label", "Mettre en pause");
  };
  play.addEventListener("click", () => timer ? stop() : start());
  range.addEventListener("input", () => { stop(); showFrame(+range.value); });
  getJSON("https://api.rainviewer.com/public/weather-maps.json").then(j => {
    if (!alive) return;
    host = j.host;
    frames = (j.radar?.past || []).slice(-7); // la dernière heure
    if (!frames.length) throw new Error("aucune image");
    range.max = frames.length - 1;
    showFrame(frames.length - 1);
  }).catch(() => { badge.textContent = "Radar indisponible pour le moment"; });
  return () => { alive = false; clearInterval(timer); map.remove(); };
}

// Fond de carte bien lisible (terres, côtes, frontières, villes) : CARTO éclairci, OpenStreetMap en secours.
function baseMap(map) {
  const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 11, subdomains: "abcd", attribution: "© OpenStreetMap, © CARTO", className: "base-tiles", zIndex: 0
  }).addTo(map);
  let errors = 0, swapped = false;
  carto.on("tileerror", () => {
    if (swapped || ++errors < 3) return;
    swapped = true;
    map.removeLayer(carto);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 11, attribution: "© OpenStreetMap", className: "base-tiles osm-dark", zIndex: 0
    }).addTo(map);
  });
  // Frontière de la France tracée par-dessus, pour qu'elle se voie même sous la pluie.
  getJSON("https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson@master/metropole-version-simplifiee.geojson").then(g => {
    if (!map.getContainer().isConnected) return;
    L.geoJSON(g, { interactive: false, style: { color: "#C9D3E6", weight: 1.5, opacity: 0.8, fill: false } }).addTo(map);
  }).catch(() => {});
}

// Satellite Meteosat (EUMETSAT, WMS public sans clé) : MTG d'abord, ancienne génération MSG en secours.
function cloudLayer(map, badge) {
  const sources = ["mtg_fd:ir105_hrfi", "msg_fes:ir108"];
  let k = 0, layer = null, errors = 0;
  const load = () => {
    if (layer) map.removeLayer(layer);
    errors = 0;
    layer = L.tileLayer.wms("https://view.eumetsat.int/geoserver/wms", {
      layers: sources[k], format: "image/png", transparent: true, version: "1.3.0", opacity: 0.75,
      attribution: "Satellite © EUMETSAT"
    }).addTo(map);
    layer.on("tileerror", () => {
      if (++errors < 3) return;
      if (k + 1 < sources.length) { k++; load(); } else badge.textContent = "Satellite indisponible pour le moment";
    });
    layer.on("load", () => { if (errors < 3) badge.textContent = "Satellite · dernière image"; });
  };
  load();
}

/* ---------- Lune ---------- */
function renderMoon(box) {
  const now = new Date();
  const m = moonInfo(now);
  const dNew = daysBetween(now, m.nextNew), dFull = daysBetween(now, m.nextFull);
  const trend = m.name === "Pleine lune" ? (m.frac >= 0.5 ? "Devient décroissante" : "Encore croissante")
    : m.name === "Nouvelle lune" ? (m.frac < 0.5 ? "Devient croissante" : "Encore décroissante")
      : (m.waxing ? "Croissante" : "Décroissante");
  const names = ["NL", "Crois.", "PQ", "Gib.", "PL", "Gib.", "DQ", "Décr."];
  const cur = Math.round(m.frac * 8) % 8;
  box.innerHTML = `
    <h2>Lune</h2>
    <div class="moon-row">
      ${moonSVG(m.frac, 120, { halo: true, craters: true, pad: 12 })}
      <div style="display:flex;flex-direction:column;gap:6px">
        <span style="font-size:22px;font-weight:800">${m.name}</span>
        <span class="pill" style="background:#F4C76B">${trend}</span>
        <span class="txt" style="font-size:14px">Éclairée à ${nf(m.illum * 100)} %</span>
      </div>
    </div>
    <div class="tiles">
      <div class="tile"><span class="k">Lune noire</span><span class="v" style="font-size:20px">${inDays(dNew)}</span><span class="s">${dayShort(m.nextNew)} à ${hm(m.nextNew)}</span></div>
      <div class="tile"><span class="k">Prochaine pleine lune</span><span class="v" style="font-size:20px">${inDays(dFull)}</span><span class="s">${dayShort(m.nextFull)} à ${hm(m.nextFull)}</span></div>
    </div>
    <div class="moon-strip">
      ${names.map((n, i) => `<div class="${i === cur ? "on" : ""}">${moonSVG(i / 8 + 0.0001, 28, { pad: 2 })}<span>${n}</span></div>`).join("")}
    </div>`;
}

/* ---------- Marées Saint-Malo ---------- */
function renderTides(box) {
  const sm = stations.saintMalo, br = stations.brest;
  const pS = createTidePredictor(sm.constituents, { offset: sm.msl });
  const pB = createTidePredictor(br.constituents, { offset: br.msl });
  const coef = lvl => Math.round((lvl - br.msl) / 3.05 * 100);
  const now = new Date();
  const today = ymd(now);
  // Bornes du jour à l'heure de Paris
  const dayStart = parisMidnight(now);
  const dayEnd = parisMidnight(new Date(dayStart.getTime() + 30 * 3600000));

  const ext = pS.getExtremesPrediction({ start: dayStart, end: dayEnd });
  const line = pS.getTimelinePrediction({ start: dayStart, end: dayEnd, timeFidelity: 900 });
  const lvlNow = pS.getWaterLevelAtTime({ time: now }).level;
  const lvlSoon = pS.getWaterLevelAtTime({ time: new Date(now.getTime() + 600000) }).level;
  const rising = lvlSoon > lvlNow;

  // Coefficients : pleines mers de Brest sur un an
  const yearEnd = new Date(dayStart.getTime() + 366 * 86400000);
  const highs = pB.getExtremesPrediction({ start: dayStart, end: yearEnd }).filter(x => x.high).map(x => ({ t: x.time, c: coef(x.level) }));
  const byDay = new Map();
  for (const h of highs) { const k = ymd(h.t); (byDay.get(k) || byDay.set(k, []).get(k)).push(h.c); }
  const todayCoefs = byDay.get(today) || [];
  const next14 = [...byDay.entries()].slice(0, 14);
  const big = highs.find(h => h.c >= 100 && h.t > now);
  const best = highs.reduce((a, h) => h.c > a.c ? h : a, highs[0]);
  const tag = c => c >= 100 ? "très vives-eaux" : c >= 70 ? "vives-eaux" : c >= 45 ? "mortes-eaux" : "très mortes-eaux";

  // Courbe du jour
  const W = 356, H = 150, padL = 6, padR = 6, base = 128, top = 10, maxH = 14;
  const span = dayEnd - dayStart; // 23, 24 ou 25 h selon le changement d'heure
  const X = t => padL + (t - dayStart) / span * (W - padL - padR);
  const Y = h => base - (h / maxH) * (base - top);
  const pts = line.map(p => `${X(p.time).toFixed(1)} ${Y(p.level).toFixed(1)}`);
  const nowX = X(now);
  const curve = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de marée du jour à Saint-Malo">
    <defs><linearGradient id="seaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3FD1C2" stop-opacity="0.45"/><stop offset="100%" stop-color="#3FD1C2" stop-opacity="0.03"/></linearGradient></defs>
    <path d="M${pts.join(" L")} L${X(dayEnd)} ${base} L${padL} ${base} Z" fill="url(#seaG)"/>
    <path d="M${pts.join(" L")}" fill="none" stroke="#3FD1C2" stroke-width="2.5"/>
    ${ext.map(e => `<text x="${X(e.time).toFixed(1)}" y="${(e.high ? Y(e.level) - 6 : Y(e.level) + 14).toFixed(1)}" text-anchor="middle" fill="#C9D3E6" font-size="10" font-weight="700">${hm(e.time)}</text>`).join("")}
    <line x1="${nowX.toFixed(1)}" y1="${top}" x2="${nowX.toFixed(1)}" y2="${base}" stroke="#EAF0FA" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.7"/>
    <circle cx="${nowX.toFixed(1)}" cy="${Y(lvlNow).toFixed(1)}" r="5.5" fill="#EAF0FA" stroke="#0B1220" stroke-width="2"/>
    <line x1="${padL}" y1="${base}" x2="${W - padR}" y2="${base}" stroke="#2A3A5C"/>
    ${[0, 6, 12, 18, 24].map(h => `<text x="${(padL + h / 24 * (W - padL - padR)).toFixed(1)}" y="${base + 18}" text-anchor="${h === 0 ? "start" : h === 24 ? "end" : "middle"}" fill="#9AA8C2" font-size="11" font-weight="600">${h}h</text>`).join("")}
  </svg>`;

  const nextExt = ext.find(e => e.time > now);
  const bars = next14.map(([k, cs], i) => {
    const c = Math.max(...cs);
    const d = new Date(k + "T12:00:00");
    return { v: c, top: c, label: weekdayLetter(d), labelBold: i === 0, labelColor: i === 0 ? "#EAF0FA" : undefined, color: i === 0 ? "#3FD1C2" : c >= 90 ? "#2A9E93" : "#2F4466" };
  });

  box.innerHTML = `
    <div class="card-head"><h2>Marées · Saint-Malo</h2><span class="sub">aujourd'hui</span></div>
    <div class="tiles">
      <div class="tile"><span class="k">Coefficient</span><span class="v" style="color:#3FD1C2;font-size:26px">${todayCoefs.join(" · ") || "–"}</span><span class="s">${todayCoefs.length ? tag(Math.max(...todayCoefs)) : ""}</span></div>
      <div class="tile"><span class="k">Maintenant</span><span class="v" style="font-size:26px">${nf(lvlNow, 1)} m</span><span class="s">la mer ${rising ? "monte ↑" : "descend ↓"}</span></div>
    </div>
    ${curve}
    <div class="tide-list" style="grid-template-columns:repeat(${ext.length || 1},minmax(0,1fr))">
      ${ext.map(e => `<div class="${e === nextExt ? "next" : ""}"><span class="t ${e.high ? "pm" : ""}">${e.high ? "PM" : "BM"}${e === nextExt ? " · proch." : ""}</span><span class="h">${hm(e.time)}</span><span class="m">${nf(e.level, 1)} m</span></div>`).join("")}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <h3>Coefficients · 14 jours</h3>
      ${barChart({ width: 340, height: 130, bars, max: 120, refLine: { v: 90, label: "" } })}
      <p class="small">Pointillés : coefficient 90.</p>
    </div>
    ${big ? `<div class="big-tide"><div class="badge-sq" style="background:#3FD1C2"><b>${big.c}</b><small>coef.</small></div>
      <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;color:#9FE8DF;font-weight:600">Prochaine grande marée (100 et plus)</span>
      <span style="font-size:18px;font-weight:800">${cap1(inDays(daysBetween(now, big.t)))}</span><span class="small" style="color:#C9D3E6">${dayShort(big.t)}</span></div></div>` : ""}
    <div class="big-tide"><div class="badge-sq" style="background:#F4C76B"><b>${best.c}</b><small>coef.</small></div>
      <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;color:#F6DFA8;font-weight:600">Plus grande marée des 12 prochains mois</span>
      <span style="font-size:18px;font-weight:800">${cap1(inDays(daysBetween(now, best.t)))}</span><span class="small" style="color:#C9D3E6">${dayShort(best.t)} ${best.t.getFullYear() !== now.getFullYear() ? best.t.getFullYear() : ""}</span></div></div>
    <p class="small">Hauteurs au-dessus du zéro des cartes. Coefficients calculés à Brest comme le fait le SHOM, à 2 ou 3 points près. Ne pas utiliser pour la navigation.</p>`;
}
