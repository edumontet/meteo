import { getJSON, esc, nf, hm, dayShort, barChart, errorBox, ymd, cap, TZ } from "./util.js";

const SWPC = "https://services.swpc.noaa.gov";
const IMAGES = [
  { k: "0304", label: "Protubérances", cap: "Filtre 304 Å · protubérances et chromosphère" },
  { k: "0171", label: "Couronne", cap: "Filtre 171 Å · boucles de la couronne" },
  { k: "HMIIC", label: "Taches", cap: "Lumière visible · taches solaires" }
];

// Les fichiers NOAA existent en deux formats (tableau avec en-tête, ou objets) : on accepte les deux.
function rows(j) {
  if (!Array.isArray(j)) return [];
  if (Array.isArray(j[0])) { const [head, ...rest] = j; return rest.map(r => Object.fromEntries(head.map((k, i) => [k, r[i]]))); }
  return j;
}
const field = (o, re) => { const k = Object.keys(o).find(x => re.test(x)); return k == null ? undefined : o[k]; };
const utc = s => new Date(String(s).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
const kpColor = v => v < 4 ? "#4CC38A" : v < 5 ? "#E8C14A" : v < 7 ? "#FF9A4D" : "#E5484D";
const kpWord = v => v < 4 ? "Calme" : v < 5 ? "Agité" : v < 6 ? "Tempête mineure" : v < 7 ? "Tempête modérée" : v < 8 ? "Forte tempête" : "Tempête extrême";

export async function render(el) {
  let img = 0;
  const stamp = Math.floor(Date.now() / 600000); // évite une image en cache de plus de 10 min
  el.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Le Soleil en direct</h2><span class="sub">NASA SDO</span></div>
      <div class="sun-img"><img id="sun-img" alt="Image du Soleil" src=""><span class="map-badge" id="sun-cap"></span></div>
      <div class="filters">${IMAGES.map((x, i) => `<button type="button" data-i="${i}" aria-pressed="${i === 0}">${x.label}</button>`).join("")}</div>
      <p class="small">Les protubérances sont les jets de gaz qui dépassent du bord du disque. L'image se met à jour toutes les 15 minutes environ.</p>
    </section>
    <section class="card" id="sun-flare"><h2>Éruptions solaires</h2><div class="loading">…</div></section>
    <section class="card" id="sun-kp"><h2>Activité magnétique (Kp)</h2><div class="loading">…</div></section>
    <section class="card aurora" id="sun-aurora"><h2>Aurores en Bretagne</h2><div class="loading">…</div></section>
    <section class="tiles" id="sun-wind"></section>`;
  const setImg = i => {
    img = i;
    el.querySelector("#sun-img").src = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_${IMAGES[i].k}.jpg?t=${stamp}`;
    el.querySelector("#sun-cap").textContent = IMAGES[i].cap;
    el.querySelectorAll(".filters button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.i === i));
  };
  el.querySelectorAll(".filters button").forEach(b => b.addEventListener("click", () => setImg(+b.dataset.i)));
  setImg(img);

  await Promise.all([flares(el.querySelector("#sun-flare")), kp(el), wind(el.querySelector("#sun-wind"))]);
}

async function flares(box) {
  try {
    const [xr, fl] = await Promise.all([
      getJSON(`${SWPC}/json/goes/primary/xrays-6-hour.json`),
      getJSON(`${SWPC}/json/goes/primary/xray-flares-7-day.json`).catch(() => [])
    ]);
    const long = rows(xr).filter(r => String(r.energy).startsWith("0.1-0.8") && r.flux > 0);
    const last = long[long.length - 1];
    const flux = last.flux;
    const letter = flux >= 1e-4 ? "X" : flux >= 1e-5 ? "M" : flux >= 1e-6 ? "C" : flux >= 1e-7 ? "B" : "A";
    const base = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }[letter];
    const cls = letter + nf(Math.min(9.9, flux / base), 1).replace(",", ".");
    const pos = Math.max(0, Math.min(100, (Math.log10(flux) + 8) / 5 * 100));
    const list = rows(fl).map(f => ({ cls: field(f, /max_class/i) || field(f, /class/i), t: utc(field(f, /max_time/i) || field(f, /begin/i)) })).filter(f => f.cls);
    const strong = list.filter(f => /^[MX]/.test(f.cls)).pop() || list.pop();
    const flareColor = c => /^X/.test(c) ? "#E5484D" : /^M/.test(c) ? "#FF9A4D" : "#E8C14A";
    box.innerHTML = `
      <h2>Éruptions solaires</h2>
      ${strong ? `<div style="display:flex;align-items:center;gap:14px">
        <div class="badge-sq" style="background:${flareColor(strong.cls)};width:72px;height:72px;border-radius:18px"><b>${esc(strong.cls)}</b><small>classe</small></div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <span class="sub" style="font-size:13px">${/^[MX]/.test(strong.cls) ? "Dernière éruption notable" : "Dernière éruption"}</span>
          <span style="font-size:18px;font-weight:800">${dayShort(strong.t)} à ${hm(strong.t)}</span>
          <span class="small" style="color:#C9D3E6">${/^X/.test(strong.cls) ? "Forte" : /^M/.test(strong.cls) ? "Moyenne" : "Petite"}</span>
        </div></div>` : `<p class="txt">Aucune éruption notable ces 7 derniers jours.</p>`}
      <div style="display:flex;flex-direction:column;gap:6px">
        <span class="sub">Niveau de rayons X maintenant</span>
        <div class="xscale">
          <span style="background:#2F4466;border-radius:6px 0 0 6px"></span><span style="background:#3C6E9E"></span><span style="background:#E8C14A"></span><span style="background:#FF9A4D"></span><span style="background:#E5484D;border-radius:0 6px 6px 0"></span>
          <div class="cursor" style="left:${pos}%"></div>
        </div>
        <div class="xlabels"><span>A</span><span>B</span><span>C</span><span>M</span><span>X</span></div>
        <span class="small" style="color:#C9D3E6">Classe ${cls} à ${hm(utc(last.time_tag))}. M = moyenne, X = forte.</span>
      </div>`;
  } catch {
    box.innerHTML = `<h2>Éruptions solaires</h2>` + errorBox("Données NOAA indisponibles pour le moment.");
  }
}

async function kp(el) {
  const box = el.querySelector("#sun-kp"), abox = el.querySelector("#sun-aurora");
  try {
    const fc = rows(await getJSON(`${SWPC}/products/noaa-planetary-k-index-forecast.json`))
      .map(r => ({ t: utc(r.time_tag), v: Number(field(r, /^kp$/i)), kind: String(field(r, /observed/i) || "") }))
      .filter(r => !isNaN(r.v));
    const now = new Date();
    const past = fc.filter(r => r.t <= now);
    const current = past[past.length - 1] || fc[0];
    const today = ymd(now);
    const view = fc.filter(r => ymd(r.t) >= today).slice(0, 24);
    const ang = Math.PI * (1 - current.v / 9);
    const nx = 60 + 46 * Math.cos(ang), ny = 64 - 46 * Math.sin(ang);
    const gauge = `<svg width="120" height="72" viewBox="0 0 120 72" role="img" aria-label="Jauge Kp ${nf(current.v)} sur 9" style="flex-shrink:0">
      <path d="M10 64 A50 50 0 0 1 110 64" fill="none" stroke="#22304D" stroke-width="12" stroke-linecap="round"/>
      <path d="M10 64 A50 50 0 0 1 ${(60 + 50 * Math.cos(ang)).toFixed(1)} ${(64 - 50 * Math.sin(ang)).toFixed(1)}" fill="none" stroke="${kpColor(current.v)}" stroke-width="12" stroke-linecap="round"/>
      <line x1="60" y1="64" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#EAF0FA" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="64" r="5" fill="#EAF0FA"/></svg>`;
    const bars = view.map(r => ({ v: Math.max(0.2, r.v), color: kpColor(r.v), opacity: r.t < now ? 0.55 : 1 }));
    const dayNames = [...new Set(view.map(r => ymd(r.t)))].map(d => cap(new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", timeZone: TZ })));
    box.innerHTML = `
      <div class="card-head"><h2>Activité magnétique (Kp)</h2><span class="sub">échelle 0 à 9</span></div>
      <div style="display:flex;align-items:center;gap:16px">${gauge}
        <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:34px;font-weight:800;line-height:1">Kp ${nf(current.v, current.v % 1 ? 1 : 0)}</span>
        <span style="font-size:14px;font-weight:700;color:${kpColor(current.v)}">${kpWord(current.v)}</span></div></div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <span class="sub">Par tranches de 3 h (heure UTC), passé en grisé</span>
        ${barChart({ width: 340, height: 110, bars, max: 9, refLine: { v: 5, label: "tempête (5)", color: "#5A4A2E", textColor: "#FFB37A" } })}
        <div style="display:grid;grid-template-columns:repeat(${dayNames.length},minmax(0,1fr));font-size:12px;color:#9AA8C2;font-weight:700;text-align:center">${dayNames.map(d => `<span>${d}</span>`).join("")}</div>
      </div>
      <div class="legend"><span><i style="background:#4CC38A"></i>Calme 0–3</span><span><i style="background:#E8C14A"></i>Agité 4</span><span><i style="background:#FF9A4D"></i>Tempête 5–6</span><span><i style="background:#E5484D"></i>Forte 7+</span></div>`;

    // Aurores : visibles en Bretagne vers Kp 7, parfois en photo dès Kp 6.
    const perDay = [...new Set(view.map(r => ymd(r.t)))].slice(0, 3).map(d => ({ d, max: Math.max(...view.filter(r => ymd(r.t) === d).map(r => r.v)) }));
    const chance = v => v >= 8 ? "Bonne" : v >= 7 ? "Possible" : v >= 6 ? "Faible" : v >= 5 ? "Très faible" : "Nulle";
    const best = perDay.reduce((a, x) => x.max > a.max ? x : a, perDay[0]);
    abox.innerHTML = `
      <h2>Aurores en Bretagne</h2>
      <div class="tiles three">${perDay.map(x => `<div class="tile ${x === best && x.max >= 6 ? "on" : ""}"><span class="k" style="color:#B8B2E0">${cap(new Date(x.d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", timeZone: TZ }))}</span>
        <span class="v" style="font-size:16px;${x.max >= 6 ? "color:#D6C2FF" : ""}">${chance(x.max)}</span><span class="s">Kp max ${nf(x.max, x.max % 1 ? 1 : 0)}</span></div>`).join("")}</div>
      <p class="small" style="color:#CFC9F2">Visibles à l'œil nu en Bretagne à partir de Kp 7 environ, parfois en photo dès Kp 6 : regarde vers le nord, loin des lumières.</p>`;
  } catch {
    box.innerHTML = `<h2>Activité magnétique (Kp)</h2>` + errorBox("Données NOAA indisponibles pour le moment.");
    abox.innerHTML = `<h2>Aurores en Bretagne</h2>` + errorBox("Données indisponibles.");
  }
}

async function wind(box) {
  const tiles = [];
  try {
    const w = rows(await getJSON(`${SWPC}/json/rtsw/rtsw_wind_1m.json`))
      .filter(r => (r.active === undefined || r.active === true || r.active === 1) && (field(r, /proton_speed|^speed$/i) > 0));
    const last = w.reduce((a, r) => (!a || utc(r.time_tag) > utc(a.time_tag)) ? r : a, null);
    const v = Number(field(last, /proton_speed|^speed$/i));
    tiles.push(`<div class="tile card" style="padding:14px"><span class="k">Vent solaire</span><span class="v">${nf(v)} km/s</span><span class="s">${v > 600 ? "rapide" : v > 450 ? "un peu rapide" : "normal"}</span></div>`);
  } catch { /* on n'affiche pas la tuile */ }
  try {
    const s = rows(await getJSON(`${SWPC}/json/solar-cycle/swpc_observed_ssn.json`));
    const last = s[s.length - 1];
    const n = Number(field(last, /ssn/i));
    if (!isNaN(n)) tiles.push(`<div class="tile card" style="padding:14px"><span class="k">Taches solaires</span><span class="v">${nf(n)}</span><span class="s">nombre observé</span></div>`);
  } catch { /* idem */ }
  box.innerHTML = tiles.join("");
  if (!tiles.length) box.remove();
}
