import { getJSON, nf, barChart, errorBox, ymd, weekdayLetter, dayShort, inDays, daysBetween, cap, TZ } from "./util.js";
import { moonInfo } from "./moon.js";

const SPECIES = [
  ["Pieds-de-mouton", "Trompettes-de-la-mort", "Chanterelles en tube", "Pleurotes"],
  ["Pieds-de-mouton", "Chanterelles en tube", "Pleurotes"],
  ["Morilles", "Pleurotes"],
  ["Morilles", "Mousserons de la Saint-Georges"],
  ["Mousserons de la Saint-Georges", "Morilles"],
  ["Girolles", "Cèpes d'été", "Mousserons"],
  ["Girolles", "Cèpes d'été"],
  ["Girolles", "Cèpes d'été", "Rosés des prés"],
  ["Cèpes", "Girolles", "Rosés des prés", "Coulemelles"],
  ["Cèpes", "Girolles", "Pieds-de-mouton", "Trompettes-de-la-mort", "Coulemelles"],
  ["Pieds-de-mouton", "Trompettes-de-la-mort", "Chanterelles en tube", "Cèpes (fin)", "Pleurotes"],
  ["Chanterelles en tube", "Pieds-de-mouton", "Pleurotes"]
];
const SEASON = [0.5, 0.5, 0.5, 0.5, 0.65, 0.65, 0.65, 0.8, 1, 1, 1, 0.8];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export async function render(el, { place }) {
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&daily=precipitation_sum,temperature_2m_min,wind_speed_10m_max&hourly=soil_temperature_6cm,soil_moisture_3_to_9cm` +
    `&timezone=Europe%2FParis&past_days=20&forecast_days=11&timeformat=unixtime`);
  const d = j.daily, h = j.hourly;
  const days = d.time.map((t, i) => ({ t: new Date(t * 1000), key: ymd(new Date(t * 1000 + 43200000)), rain: d.precipitation_sum[i] ?? 0, tmin: d.temperature_2m_min[i], wind: d.wind_speed_10m_max[i] }));
  // moyennes journalières du sol
  const soil = new Map();
  h.time.forEach((t, i) => {
    const k = ymd(new Date(t * 1000));
    const s = soil.get(k) || { t: 0, nt: 0, m: 0, nm: 0 };
    if (h.soil_temperature_6cm[i] != null) { s.t += h.soil_temperature_6cm[i]; s.nt++; }
    if (h.soil_moisture_3_to_9cm[i] != null) { s.m += h.soil_moisture_3_to_9cm[i]; s.nm++; }
    soil.set(k, s);
  });
  days.forEach(x => { const s = soil.get(x.key); x.soilT = s?.nt ? s.t / s.nt : null; x.soilM = s?.nm ? s.m / s.nm : null; });

  const score = i => {
    if (i < 14) return null;
    const x = days[i];
    const r15 = days.slice(i - 14, i + 1).reduce((a, y) => a + y.rain, 0);
    const rainS = clamp((r15 - 10) / 30);
    const trigger = days.slice(Math.max(0, i - 12), i - 4).some(y => y.rain >= 10) ? 0.1 : 0;
    const t = x.soilT;
    const tS = t == null ? 0.5 : t >= 10 && t <= 18 ? 1 : t < 10 ? clamp((t - 4) / 6) : clamp((24 - t) / 6);
    const mS = x.soilM == null ? rainS : clamp((x.soilM - 0.18) / 0.14);
    const tminRecent = Math.min(...days.slice(Math.max(0, i - 3), i + 1).map(y => y.tmin ?? 10));
    const frost = tminRecent < -2 ? 0.15 : tminRecent < 0 ? 0.5 : 1;
    const wind = (x.wind ?? 0) > 40 ? 0.9 : 1;
    const season = SEASON[x.t.getMonth()];
    const v = clamp(10 * (0.4 * rainS + 0.25 * tS + 0.35 * mS + trigger) * frost * wind * season, 0, 10);
    return { v: Math.round(v), r15, t, m: x.soilM, tminRecent, wind: x.wind, frost };
  };

  const now = new Date();
  const ti = Math.max(0, days.findIndex(x => x.key === ymd(now)));
  const scores = days.map((_, i) => score(i));
  const today = scores[ti];
  const word = v => v >= 8 ? "Très favorable" : v >= 6 ? "Favorable" : v >= 4 ? "Moyen" : v >= 2 ? "Peu favorable" : "Défavorable";
  const col = v => v >= 8 ? "#E0A35C" : v >= 6 ? "#D9B45C" : v >= 4 ? "#B8A070" : "#6B5A44";

  // Quand est-ce propice ?
  let pill, when;
  const fut = scores.slice(ti);
  if (today.v >= 6) {
    let k = 0; while (k + 1 < fut.length && fut[k + 1]?.v >= 6) k++;
    pill = "C'est le moment";
    when = k + 1 >= fut.length ? "Conditions favorables pour au moins 10 jours." : `Bonne période jusqu'au ${dayShort(days[ti + k].t)} environ.`;
  } else {
    const k = fut.findIndex(s => s && s.v >= 6);
    pill = k > 0 ? "Bientôt" : "Patience";
    when = k > 0 ? `Ça devrait devenir favorable ${inDays(k)} (${dayShort(days[ti + k].t)}).` : "Pas de période favorable prévue dans les 10 prochains jours.";
  }

  const moon = moonInfo(now);
  const fullDays = new Set(moon.phases.filter(p => p.phase === 0.5).map(p => ymd(p.date)));
  const newDays = new Set(moon.phases.filter(p => p.phase === 0).map(p => ymd(p.date)));
  const moonDot = (full) => `<svg width="14" height="14" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="${full ? "#F1DFAE" : "#22304D"}" stroke="${full ? "none" : "#9AA8C2"}" stroke-width="2"/></svg>`;
  const from = Math.max(14, ti - 5);
  const bars = scores.slice(from, ti + 11).map((s, n) => {
    const i = from + n, x = days[i];
    return {
      v: s?.v ?? 0, color: i < ti ? "#6B5A44" : "#E0A35C", outline: i === ti ? "#F5E6D0" : null,
      label: weekdayLetter(x.t), labelBold: i === ti, labelColor: i === ti ? "#F5E6D0" : undefined,
      icon: fullDays.has(x.key) ? moonDot(true) : newDays.has(x.key) ? moonDot(false) : null
    };
  });

  const dFull = daysBetween(now, moon.nextFull);
  const moonTxt = moon.name === "Pleine lune" ? "Pleine lune aujourd'hui." :
    `${moon.name}, pleine lune ${inDays(dFull)} (${dayShort(moon.nextFull)}).`;
  const moistWord = m => m == null ? "–" : m >= 0.32 ? "Élevée" : m >= 0.25 ? "Bonne" : m >= 0.18 ? "Moyenne" : "Faible";
  const F = [
    [today.r15 >= 30, today.r15 >= 15, "Pluie des 15 derniers jours", "Il en faut au moins 30 à 40 mm", nf(today.r15) + " mm"],
    [today.t != null && today.t >= 10 && today.t <= 18, today.t != null && today.t >= 7 && today.t <= 21, "Température du sol", "Idéal entre 10 et 18 °C", today.t == null ? "–" : nf(today.t) + " °C"],
    [today.m != null && today.m >= 0.25, today.m != null && today.m >= 0.18, "Humidité du sol", "Le mycélium a besoin d'un sol humide", moistWord(today.m)],
    [today.tminRecent >= 0, today.tminRecent >= -2, "Gel", "Le gel stoppe la pousse", today.tminRecent >= 0 ? "Aucun" : nf(today.tminRecent) + " °C"],
    [(today.wind ?? 0) <= 30, (today.wind ?? 0) <= 45, "Vent", "Le vent dessèche le sol", (today.wind ?? 0) <= 20 ? "Faible" : (today.wind ?? 0) <= 40 ? "Modéré" : "Fort"]
  ];
  const ic = (ok, mid) => ok
    ? `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4CC38A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Favorable" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6"/></svg>`
    : mid ? `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#E8C14A" stroke-width="2.4" stroke-linecap="round" role="img" aria-label="Moyen" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>`
      : `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FF8A8F" stroke-width="2.4" stroke-linecap="round" role="img" aria-label="Défavorable" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>`;
  const dash = 314.2 * today.v / 10;

  el.innerHTML = `
    <section class="card champi">
      <div style="display:flex;align-items:center;gap:18px">
        <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Indice champignons ${today.v} sur 10" style="flex-shrink:0">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#3A2F20" stroke-width="12"/>
          <circle cx="60" cy="60" r="50" fill="none" stroke="${col(today.v)}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} 314.2" transform="rotate(-90 60 60)"/>
          <text x="60" y="66" text-anchor="middle" fill="#F5E6D0" font-size="34" font-weight="800">${today.v}</text>
          <text x="60" y="84" text-anchor="middle" fill="#C9B497" font-size="12" font-weight="700">sur 10</text>
        </svg>
        <div style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:24px;font-weight:800;color:#F5E6D0">${word(today.v)}</span>
          <span class="pill" style="background:#E0A35C">${pill}</span>
          <span style="font-size:14px;color:#D8C6AC">${when}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Les 15 jours</h2><span class="sub">indice sur 10</span></div>
      ${barChart({ width: 340, height: 150, bars, max: 10, padT: 24 })}
      <div class="legend"><span><i style="background:#6B5A44"></i>Passé</span><span><i style="background:#E0A35C"></i>Prévision</span><span>${moonDot(true)}Pleine lune</span><span>${moonDot(false)}Lune noire</span></div>
    </section>

    <section class="card">
      <h2>Pourquoi cette note</h2>
      ${F.map(([ok, mid, n, s, v]) => `<div class="factor">${ic(ok, mid)}<div><b>${n}</b><span>${s}</span></div><strong>${v}</strong></div>`).join("")}
    </section>

    <section class="card">
      <h2>Et la Lune ?</h2>
      <p class="txt">${moonTxt} D'après la tradition des cueilleurs, les poussées sont souvent fortes dans les jours qui suivent la pleine lune.</p>
      <p class="small">À savoir : la science n'a pas démontré d'effet de la Lune sur l'humidité ou la pousse. Elle est affichée à part et ne compte pas dans la note.</p>
    </section>

    <section class="card">
      <h2>De saison en ${cap(now.toLocaleDateString("fr-FR", { month: "long", timeZone: TZ }))}</h2>
      <div class="tags">${SPECIES[now.getMonth()].map(s => `<span>${s}</span>`).join("")}</div>
    </section>

    <div class="warnbox">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FF8A8F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>
      <span>Au moindre doute, fais vérifier ta cueillette par un pharmacien avant de la manger.</span>
    </div>
    <p class="small" style="text-align:center">Indice calculé pour ta position à partir de la pluie, de la température et de l'humidité du sol (Open-Meteo).</p>`;
}
