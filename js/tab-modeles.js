import { getJSON, nf, hm, lineChart, errorBox, ymd, parisMidnight, cap, TZ } from "./util.js";

const MODELS = [
  { k: "meteofrance_arome_france", name: "AROME", sub: "Météo-France · 2,5 km", col: "#5BB8FF" },
  { k: "meteofrance_arpege_europe", name: "ARPEGE", sub: "Météo-France · 11 km", col: "#3FD1C2" },
  { k: "ecmwf_ifs025", name: "ECMWF", sub: "Européen · 25 km", col: "#F4C76B" },
  { k: "gfs_seamless", name: "GFS", sub: "Américain · 13 km", col: "#B48CFF", dash: "5 3" }
];

export async function render(el, { place }) {
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&hourly=temperature_2m,precipitation&timezone=Europe%2FParis&forecast_days=3&timeformat=unixtime`;
  const res = await Promise.all(MODELS.map(m => getJSON(base + "&models=" + m.k).then(j => j.hourly).catch(() => null)));
  if (res.every(r => !r)) { el.innerHTML = errorBox("Les modèles sont indisponibles pour le moment."); return; }

  const now = Date.now();
  const startH = Math.floor(now / 3600000) * 3600000;
  const hours = Array.from({ length: 49 }, (_, i) => startH + i * 3600000);
  const series = MODELS.map((m, mi) => {
    const h = res[mi];
    if (!h) return { ...m, temp: hours.map(() => null), rain: hours.map(() => null), ok: false };
    const idx = new Map(h.time.map((t, i) => [t * 1000, i]));
    const temp = hours.map(t => idx.has(t) ? h.temperature_2m[idx.get(t)] : null);
    const ok = temp.some(v => v != null);
    return { ...m, temp, h, ok };
  });

  // Cumuls de pluie de demain et après-demain
  const d1 = parisMidnight(new Date(now + 24 * 3600000)), d2 = parisMidnight(new Date(d1.getTime() + 30 * 3600000)), d3 = parisMidnight(new Date(d2.getTime() + 30 * 3600000));
  const dayLabel = d => cap(d.toLocaleDateString("fr-FR", { weekday: "long", timeZone: TZ }));
  const sumRain = (s, a, b) => {
    if (!s.h) return null;
    let tot = 0, n = 0;
    s.h.time.forEach((t, i) => { const ms = t * 1000; if (ms > a && ms <= b && s.h.precipitation[i] != null) { tot += s.h.precipitation[i]; n++; } });
    return n >= 20 ? tot : null; // jour incomplet = hors portée du modèle
  };
  const maxT = (s, a, b) => {
    if (!s.h) return null;
    const v = s.h.time.map((t, i) => (t * 1000 >= a && t * 1000 < b) ? s.h.temperature_2m[i] : null).filter(x => x != null);
    return v.length >= 20 ? Math.max(...v) : null;
  };
  const days = [[d1, d2], [d2, d3]].map(([a, b]) => ({
    label: dayLabel(a),
    rain: series.map(s => sumRain(s, a.getTime(), b.getTime())),
    tmax: series.map(s => maxT(s, a.getTime(), b.getTime()))
  }));
  days.forEach(d => Object.assign(d, confidence(d)));

  const active = Object.fromEntries(MODELS.map(m => [m.k, true]));
  const draw = () => {
    const on = series.filter(s => s.ok && active[s.k]);
    const vals = on.flatMap(s => s.temp).filter(v => v != null);
    const lo = Math.floor((Math.min(...vals, 99) - 1) / 5) * 5, hi = Math.ceil((Math.max(...vals, -99) + 1) / 5) * 5;
    const yTicks = []; for (let t = lo; t <= hi; t += 5) yTicks.push(t);
    const band = on.length > 1 ? {
      lo: hours.map((_, i) => { const v = on.map(s => s.temp[i]).filter(x => x != null); return v.length ? Math.min(...v) : null; }),
      hi: hours.map((_, i) => { const v = on.map(s => s.temp[i]).filter(x => x != null); return v.length ? Math.max(...v) : null; })
    } : null;
    if (band) { // le ruban s'arrête là où un seul modèle reste
      const last = band.lo.findLastIndex((v, i) => v != null && on.filter(s => s.temp[i] != null).length > 1);
      band.lo = band.lo.slice(0, last + 1); band.hi = band.hi.slice(0, last + 1);
    }
    const vLines = [], xLabels = [];
    hours.forEach((t, i) => {
      const d = new Date(t);
      if (hm(d) === "00:00") { vLines.push({ i }); }
      if (hm(d) === "12:00" && i >= 5) xLabels.push({ i, text: cap(d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: TZ })) });
    });
    xLabels.unshift({ i: 0, text: "Maint.", anchor: "start", bold: true, color: "#EAF0FA" });
    const chart = lineChart({
      width: 340, height: 200, yMin: lo, yMax: hi, yTicks, yFmt: v => v + "°", vLines, xLabels,
      band: band && band.lo.length > 1 ? band : null,
      series: on.map(s => ({ values: s.temp, color: s.col, dash: s.dash }))
    });
    el.querySelector("#mod-chart").innerHTML = chart;
    el.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", active[c.dataset.k]));
    el.querySelectorAll(".rain-row").forEach(r => r.style.opacity = active[r.dataset.k] ? 1 : 0.35);
  };

  const maxRain = Math.max(1, ...days.flatMap(d => d.rain.filter(v => v != null)));
  const colorOf = s => s >= 4 ? "#4CC38A" : s === 3 ? "#9FD08A" : "#E8C14A";
  el.innerHTML = `
    <section class="card">
      <h2>Indice de confiance</h2>
      <div class="tiles">
        ${days.map(d => `<div class="tile"><span class="k">${d.label}</span><span class="v" style="font-size:20px;color:${colorOf(d.score)}">${d.word}</span>
          <div class="meter">${[1, 2, 3, 4, 5].map(i => `<span style="${i <= d.score ? `background:${colorOf(d.score)}` : ""}"></span>`).join("")}</div></div>`).join("")}
      </div>
      <p class="txt">${summary(days)}</p>
    </section>

    <section class="chips" aria-label="Modèles affichés">
      ${series.map(s => `<button type="button" class="chip" data-k="${s.k}" aria-pressed="true" style="--mc:${s.col}" ${s.ok ? "" : "disabled"}>
        <span class="dot"></span><span><b>${s.name}</b><small>${s.ok ? s.sub : "indisponible"}</small></span></button>`).join("")}
    </section>

    <section class="card">
      <div class="card-head"><h2>Température</h2><span class="sub">°C · 48 h</span></div>
      <div id="mod-chart"></div>
      <p class="small">La zone claire montre l'écart entre les modèles : plus elle s'élargit, moins la prévision est sûre.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Pluie prévue</h2><span class="sub">cumul du jour</span></div>
      ${days.map(d => `<div style="display:flex;flex-direction:column;gap:8px"><h3>${d.label}</h3>
        ${series.map((s, i) => { const v = d.rain[i]; return `<div class="rain-row" data-k="${s.k}"><span class="n">${s.name}</span>
          <span class="bar"><i style="width:${v == null ? 0 : Math.max(3, v / maxRain * 100)}%;background:${s.col}"></i></span>
          <span class="v">${v == null ? "—" : nf(v, 1) + " mm"}</span></div>`; }).join("")}</div>`).join("")}
    </section>

    <section class="card" style="background:#0F182B">
      <h3>Les modèles en bref</h3>
      <p class="small" style="color:#C9D3E6">AROME (Météo-France) : très précis à l'échelle locale, mais ne voit qu'à 2 jours (d'où les tirets). ARPEGE (Météo-France) et ECMWF (européen) : la référence à plusieurs jours. GFS (américain) : souvent un peu à part, utile pour comparer.</p>
    </section>`;

  el.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => {
    const k = c.dataset.k;
    const others = MODELS.filter(m => m.k !== k && active[m.k]).length;
    if (active[k] && others === 0) return; // garder au moins un modèle
    active[k] = !active[k];
    draw();
  }));
  draw();
}

function confidence(d) {
  const t = d.tmax.filter(v => v != null), r = d.rain.filter(v => v != null);
  let score = 5;
  if (t.length > 1) { const s = Math.max(...t) - Math.min(...t); if (s > 3) score -= 2; else if (s > 1.5) score -= 1; }
  if (r.length > 1) {
    const s = Math.max(...r) - Math.min(...r);
    if (s > 5) score -= 2; else if (s > 2) score -= 1;
    if (Math.max(...r) >= 1 && Math.min(...r) < 0.2) score -= 1;
  }
  if (t.length < 2) score = Math.min(score, 3);
  score = Math.max(1, score);
  return { score, word: score >= 4 ? "Fiable" : score === 3 ? "Assez fiable" : "Incertain", tSpread: t.length > 1 ? Math.max(...t) - Math.min(...t) : 0, rMin: r.length ? Math.min(...r) : null, rMax: r.length ? Math.max(...r) : null };
}

function summary(days) {
  const parts = days.map(d => {
    const rain = d.rMax == null ? "" : d.rMax < 0.3 ? "tous voient un temps sec" :
      (d.rMax - d.rMin <= 2 ? `accord sur la pluie (${nf(d.rMin, 0)} à ${nf(d.rMax, 0)} mm)` : `désaccord sur la pluie : de ${nf(d.rMin, 0)} à ${nf(d.rMax, 0)} mm selon le modèle`);
    const temp = d.tSpread > 3 ? `températures max très différentes (${nf(d.tSpread, 0)}° d'écart)` : d.tSpread > 1.5 ? `quelques degrés d'écart sur les max` : `températures cohérentes`;
    return `${d.label} : ${temp}, ${rain}.`;
  });
  return parts.join(" ");
}
