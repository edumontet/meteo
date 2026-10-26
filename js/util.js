// Petits outils partagés : réseau, dates, icônes, graphiques SVG.

export const TZ = "Europe/Paris";

export async function getJSON(url, { timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const nf = (v, d = 0) => (v == null || isNaN(v)) ? "–" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function hm(date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
export function hmH(date) { return hm(date).replace(":", "h"); }
export function dayShort(date) {
  return date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
}
export function dayLong(date) {
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
}
export function weekdayLetter(date) {
  return date.toLocaleDateString("fr-FR", { weekday: "narrow", timeZone: TZ }).toUpperCase();
}
// Date "YYYY-MM-DD" à l'heure de Paris
export function ymd(date) {
  return date.toLocaleDateString("sv-SE", { timeZone: TZ });
}
// Décalage horaire de Paris (ms) à un instant donné
export function tzOffset(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(date).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
// Minuit (heure de Paris) du jour contenant `date`
export function parisMidnight(date) {
  const g = Date.parse(ymd(date) + "T00:00:00Z");
  return new Date(g - tzOffset(new Date(g)));
}
export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}
function startOfDay(d) { const x = new Date(ymd(d) + "T12:00:00"); return x; }

export function inDays(n) {
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return "demain";
  return "dans " + n + " jours";
}

// Codes météo WMO -> texte + type d'icône
export function wmo(code) {
  const c = Number(code);
  const T = {
    0: ["Ciel dégagé", "sun"], 1: ["Plutôt ensoleillé", "sun"], 2: ["Éclaircies", "suncloud"], 3: ["Couvert", "cloud"],
    45: ["Brouillard", "fog"], 48: ["Brouillard givrant", "fog"],
    51: ["Bruine légère", "rain"], 53: ["Bruine", "rain"], 55: ["Bruine forte", "rain"],
    56: ["Bruine verglaçante", "rain"], 57: ["Bruine verglaçante", "rain"],
    61: ["Pluie faible", "rain"], 63: ["Pluie", "rain"], 65: ["Pluie forte", "rain"],
    66: ["Pluie verglaçante", "rain"], 67: ["Pluie verglaçante forte", "rain"],
    71: ["Neige faible", "snow"], 73: ["Neige", "snow"], 75: ["Neige forte", "snow"], 77: ["Grains de neige", "snow"],
    80: ["Averses", "rain"], 81: ["Averses", "rain"], 82: ["Fortes averses", "rain"],
    85: ["Averses de neige", "snow"], 86: ["Fortes averses de neige", "snow"],
    95: ["Orages", "storm"], 96: ["Orages avec grêle", "storm"], 99: ["Orages avec forte grêle", "storm"]
  };
  return T[c] || ["—", "cloud"];
}

export function icon(kind, size = 34) {
  const a = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const cloud = y => `<path d="M7 ${15 + y}h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 ${15 + y}z" stroke="#EAF0FA"/>`;
  switch (kind) {
    case "sun": return `<svg ${a}><circle cx="12" cy="12" r="4.5" stroke="#F4C76B"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="#F4C76B"/></svg>`;
    case "suncloud": return `<svg ${a}><circle cx="9" cy="9" r="3.5" stroke="#F4C76B"/><path d="M9 2.5v1.5M3.5 9H2M4.4 4.4l1 1M13.6 4.4l-1 1" stroke="#F4C76B"/><path d="M8 19h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 8 19z" stroke="#EAF0FA"/></svg>`;
    case "rain": return `<svg ${a}>${cloud(0)}<path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#5BB8FF"/></svg>`;
    case "snow": return `<svg ${a}>${cloud(0)}<path d="M8 19v.01M12 20v.01M16 19v.01M10 22v.01M14 22v.01" stroke="#EAF0FA" stroke-width="2.6"/></svg>`;
    case "storm": return `<svg ${a}>${cloud(0)}<path d="M12.5 16l-2 3.5h3l-2 3.5" stroke="#F4C76B"/></svg>`;
    case "fog": return `<svg ${a}>${cloud(-3)}<path d="M5 16h14M7 19h10M9 22h6" stroke="#9AA8C2"/></svg>`;
    default: return `<svg ${a}>${cloud(2)}</svg>`;
  }
}

// Graphique en lignes. series: [{values:[...], color, dash, width, opacity}], x de 0..n-1
export function lineChart({ width = 340, height = 180, series, band, yMin, yMax, yTicks = [], yFmt = v => v, xLabels = [], vLines = [], padL = 30, padB = 22, padT = 8, padR = 6, area, marker }) {
  const n = Math.max(...series.map(s => s.values.length), band ? band.lo.length : 0);
  const X = i => padL + i * (width - padL - padR) / Math.max(1, n - 1);
  const Y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (height - padT - padB);
  const path = vals => {
    let d = "", pen = false;
    vals.forEach((v, i) => {
      if (v == null || isNaN(v)) { pen = false; return; }
      d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " ";
      pen = true;
    });
    return d;
  };
  let g = "";
  for (const t of yTicks) {
    g += `<line x1="${padL}" x2="${width - padR}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="#22304D"/>`;
    g += `<text x="${padL - 6}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end" fill="#9AA8C2" font-size="11" font-weight="600">${yFmt(t)}</text>`;
  }
  for (const v of vLines) {
    g += `<line x1="${X(v.i).toFixed(1)}" x2="${X(v.i).toFixed(1)}" y1="${padT}" y2="${height - padB}" stroke="${v.color || "#2F4466"}" stroke-dasharray="${v.dash || "3 3"}" stroke-width="${v.w || 1}"/>`;
    if (v.label) g += `<text x="${(X(v.i) + 4).toFixed(1)}" y="${padT + 10}" fill="${v.labelColor || "#9AA8C2"}" font-size="10" font-weight="700">${esc(v.label)}</text>`;
  }
  if (band) {
    const top = band.hi.map((v, i) => `${X(i).toFixed(1)} ${Y(v).toFixed(1)}`);
    const bot = band.lo.map((v, i) => `${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).reverse();
    g += `<path d="M${top.join(" L")} L${bot.join(" L")} Z" fill="#EAF0FA" fill-opacity="0.08"/>`;
  }
  for (const s of series) {
    if (area) {
      const d = path(s.values);
      if (d) g += `<path d="${d} L${X(s.values.length - 1).toFixed(1)} ${Y(yMin).toFixed(1)} L${X(0).toFixed(1)} ${Y(yMin).toFixed(1)} Z" fill="${s.color}" fill-opacity="0.18"/>`;
    }
    g += `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} opacity="${s.opacity ?? 1}"/>`;
  }
  if (marker) g += `<circle cx="${X(marker.i).toFixed(1)}" cy="${Y(marker.v).toFixed(1)}" r="5.5" fill="#EAF0FA" stroke="#0B1220" stroke-width="2"/>`;
  g += `<line x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}" stroke="#2A3A5C"/>`;
  for (const l of xLabels) {
    g += `<text x="${X(l.i).toFixed(1)}" y="${height - 6}" text-anchor="${l.anchor || "middle"}" fill="${l.color || "#9AA8C2"}" font-size="11" font-weight="${l.bold ? 800 : 600}">${esc(l.text)}</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${g}</svg>`;
}

// Graphique en barres. bars: [{v, color, label, top, outline}]
export function barChart({ width = 340, height = 130, bars, max, padB = 18, padT = 14, gap = 3, refLine, labelEvery = 1 }) {
  const n = bars.length;
  const bw = (width - gap * (n - 1)) / n;
  const H = height - padB - padT;
  let g = "";
  if (refLine) {
    const y = padT + H * (1 - refLine.v / max);
    g += `<line x1="0" x2="${width}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${refLine.color || "#3A4C70"}" stroke-dasharray="4 3"/>`;
    g += `<text x="${width}" y="${(y - 4).toFixed(1)}" text-anchor="end" fill="${refLine.textColor || "#9AA8C2"}" font-size="10" font-weight="700">${esc(refLine.label)}</text>`;
  }
  bars.forEach((b, i) => {
    const h = Math.max(b.v > 0 ? 3 : 2, H * Math.min(1, (b.v || 0) / max));
    const x = i * (bw + gap), y = padT + H - h;
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${b.color}" ${b.opacity != null ? `opacity="${b.opacity}"` : ""} ${b.outline ? `stroke="${b.outline}" stroke-width="2"` : ""}/>`;
    if (b.top != null) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" fill="#C9D3E6" font-size="9" font-weight="700">${esc(b.top)}</text>`;
    if (b.label != null && i % labelEvery === 0) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" fill="${b.labelColor || "#9AA8C2"}" font-size="10" font-weight="${b.labelBold ? 800 : 600}">${esc(b.label)}</text>`;
    if (b.icon) g += `<g transform="translate(${(x + bw / 2 - 7).toFixed(1)} ${(y - 18).toFixed(1)})">${b.icon}</g>`;
  });
  g += `<line x1="0" x2="${width}" y1="${padT + H}" y2="${padT + H}" stroke="#2A3A5C"/>`;
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${g}</svg>`;
}

export function errorBox(msg) {
  return `<div class="error">${esc(msg)}</div>`;
}
