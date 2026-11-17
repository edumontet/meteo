// Pluie mesurée par le radar à un point précis (+ prévision immédiate quand la source en fournit).
// On lit la couleur du pixel du lieu sur les tuiles radar, puis on la convertit en mm/h.
// Sources sans clé : LibreWXR (EUMETNET OPERA), RainViewer en secours.
import { getJSON } from "./util.js";

const SOURCES = [
  { json: "https://api.librewxr.net/public/weather-maps.json", base: () => "https://api.librewxr.net", zoom: 9 },
  { json: "https://api.rainviewer.com/public/weather-maps.json", base: j => j.host, zoom: 7 }
];

// Palette « Universal Blue » (schéma 2) de RainViewer : dBZ -> couleur. Une valeur tous les 2 dBZ suffit.
const PALETTE = [
  [6, 0x017e2b], [8, 0x047e83], [10, 0x087fdb], [12, 0x1068e0], [14, 0x1852e5], [16, 0x2c3be1], [18, 0x4d24d3],
  [20, 0x6e0dc6], [22, 0x920dac], [24, 0xb60e92], [26, 0xc62086], [28, 0xc34286], [30, 0xc06487], [32, 0xc77268],
  [34, 0xce804a], [36, 0xda9439], [38, 0xeaac35], [40, 0xfac431], [42, 0xfbda1e], [44, 0xfdf00b], [46, 0xfee713],
  [48, 0xfec035], [50, 0xfe9a58], [52, 0xfe8236], [54, 0xfe6a15], [56, 0xfd5609], [58, 0xfd4512], [60, 0xfd341c],
  [62, 0xe36b5c], [64, 0xcaa29d]
].map(([dbz, c]) => [dbz, (c >> 16) & 255, (c >> 8) & 255, c & 255]);

function dbzOf(r, g, b, a) {
  if (a < 100) return null;
  let best = null, bd = Infinity;
  for (const [dbz, pr, pg, pb] of PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) { bd = d; best = dbz; }
  }
  return bd < 4000 ? best : null;
}
// Marshall-Palmer : Z = 200 R^1.6
const rateOf = dbz => dbz == null || dbz < 10 ? 0 : Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6);

function tileOf(lat, lon, z) {
  const n = 2 ** z * 256;
  const x = (lon + 180) / 360 * n;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { tx: Math.floor(x / 256), ty: Math.floor(y / 256), px: Math.floor(x % 256), py: Math.floor(y % 256) };
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
    setTimeout(() => reject(new Error("délai")), 10000);
  });
}

// Pluie (mm/h) au lieu pour une image radar : on prend le maximum sur un petit carré autour du point
// (à peu près 1 à 2 km), pour ne pas rater une averse à cause d'un pixel.
async function sample(url, t) {
  const img = await loadImg(url);
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const R = 2, x0 = Math.max(0, t.px - R), y0 = Math.max(0, t.py - R);
  const d = ctx.getImageData(x0, y0, Math.min(256, t.px + R + 1) - x0, Math.min(256, t.py + R + 1) - y0).data; // erreur si CORS refusé
  let max = 0;
  for (let i = 0; i < d.length; i += 4) max = Math.max(max, rateOf(dbzOf(d[i], d[i + 1], d[i + 2], d[i + 3])));
  return max;
}

let cache = null; // { key, t, data }

// Renvoie { points: [{ t (ms), rate (mm/h), forecast (bool) }], source } ou null si le radar est illisible.
export async function radarAt(place) {
  const key = place.lat + "," + place.lon;
  if (cache && cache.key === key && Date.now() - cache.t < 4 * 60000) return cache.data;
  for (const s of SOURCES) {
    try {
      const j = await getJSON(s.json, { timeout: 8000 });
      const past = (j.radar?.past || []).slice(-4), next = j.radar?.nowcast || [];
      if (!past.length) continue;
      const base = s.base(j), tile = tileOf(place.lat, place.lon, s.zoom);
      const frames = [...past.map(f => ({ ...f, forecast: false })), ...next.map(f => ({ ...f, forecast: true }))];
      const rates = await Promise.all(frames.map(f =>
        sample(`${base}${f.path}/256/${s.zoom}/${tile.tx}/${tile.ty}/2/1_0.png`, tile).catch(() => null)));
      const points = frames.map((f, i) => ({ t: f.time * 1000, rate: rates[i], forecast: f.forecast })).filter(p => p.rate != null);
      if (!points.some(p => !p.forecast)) continue; // aucune mesure lisible : source suivante
      const data = { points, source: s === SOURCES[0] ? "radar OPERA" : "radar RainViewer" };
      cache = { key, t: Date.now(), data };
      return data;
    } catch { /* source suivante */ }
  }
  return null;
}
