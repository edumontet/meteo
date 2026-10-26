import { getJSON, hm, hmH, barChart, errorBox, nf } from "./util.js";

const ZOOMS = [
  { k: "ville", label: "Ville", z: 10 },
  { k: "dep", label: "Département", z: 8 },
  { k: "fr", label: "France", z: 6 }
];

function mapURL(place, z) {
  const p = new URLSearchParams({
    interactive: "1", NavigationControl: "1", FullScreenControl: "0", ScaleControl: "1",
    Cookies: "0", InfoDiv: "1", MenuButtonDiv: "1", Advertisment: "0",
    MapStyle: "2", LightningCheckboxChecked: "1",
    CountingCheckboxChecked: "1", CirclesCheckboxChecked: "1", CourseCheckboxChecked: "1", SpeedCheckboxChecked: "1",
    LinksCheckboxChecked: "0", DetectorsCheckboxChecked: "0"
  });
  return `https://map.blitzortung.org/index.php?${p}#${z}/${place.lat}/${place.lon}`;
}

export async function render(el, { place }) {
  el.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Impacts de foudre en direct</h2>
        <div class="seg" role="group" aria-label="Zoom" style="--sc:#F4C76B">
          ${ZOOMS.map((z, i) => `<button type="button" data-z="${z.z}" aria-pressed="${i === 1}">${z.label}</button>`).join("")}
        </div>
      </div>
      <iframe class="frame tall" id="bo-map" title="Carte des impacts de foudre Blitzortung" src="${mapURL(place, 8)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      <p class="small">Chaque point est un éclair, sa couleur dit son âge (du blanc au rouge, jusqu'à 2 h). Les cercles de distance, le comptage et les flèches de déplacement des orages s'affichent sur la carte. Pince pour zoomer, ou utilise le menu de la carte pour régler les calques.</p>
      <a class="btn" id="bo-open" href="${mapURL(place, 8)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Ouvrir la carte en plein écran</a>
    </section>
    <section class="card" id="bo-risk"><h2>Risque d'orage</h2><div class="loading">…</div></section>
    <section class="card" style="background:#0F182B">
      <h3>Lire la distance d'un orage</h3>
      <p class="small" style="color:#C9D3E6">Compte les secondes entre l'éclair et le tonnerre, puis divise par 3 : tu obtiens la distance en kilomètres. Moins de 10 km (30 secondes) : mets-toi à l'abri, la foudre peut tomber jusque-là.</p>
    </section>`;

  el.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    el.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
    el.querySelector("#bo-map").src = mapURL(place, b.dataset.z);
    el.querySelector("#bo-open").href = mapURL(place, b.dataset.z);
  }));

  const box = el.querySelector("#bo-risk");
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&hourly=weather_code,cape,precipitation_probability,wind_gusts_10m&timezone=Europe%2FParis&forecast_days=2&timeformat=unixtime`);
    const h = j.hourly, now = Date.now();
    const start = Math.max(0, h.time.findIndex(t => t * 1000 + 3600000 > now));
    const idx = Array.from({ length: 24 }, (_, i) => start + i).filter(i => i < h.time.length);
    const level = i => {
      const code = h.weather_code[i], cape = h.cape?.[i] ?? 0;
      if (code >= 95) return 3;
      if (cape >= 1000) return 2;
      if (cape >= 400 && (h.precipitation_probability?.[i] ?? 0) >= 30) return 1;
      return 0;
    };
    const lv = idx.map(level);
    const colors = ["#2F4466", "#E8C14A", "#FF9A4D", "#E5484D"];
    const names = ["faible", "possible", "probable", "orage prévu"];
    const maxLv = Math.max(...lv);
    const first = lv.findIndex(v => v >= 2);
    const bars = idx.map((i, n) => ({
      v: [0.6, 1.6, 2.4, 3][lv[n]], color: colors[lv[n]],
      label: n % 4 === 0 ? (n === 0 ? "Maint." : hm(new Date(h.time[i] * 1000)).slice(0, 2) + "h") : null,
      labelBold: n === 0
    }));
    const gust = Math.max(...idx.map(i => h.wind_gusts_10m?.[i] ?? 0));
    box.innerHTML = `
      <div class="card-head"><h2>Risque d'orage</h2><span class="sub">24 prochaines heures</span></div>
      <p class="lead">${maxLv === 0 ? "Pas d'orage attendu" : first >= 0 ? `Orage ${maxLv === 3 ? "prévu" : "probable"} vers ${hmH(new Date(h.time[idx[first]] * 1000))}` : "Petit risque d'orage"}</p>
      ${barChart({ width: 340, height: 110, bars, max: 3, labelEvery: 1 })}
      <div class="legend">${[1, 2, 3].map(k => `<span><i style="background:${colors[k]}"></i>${names[k][0].toUpperCase() + names[k].slice(1)}</span>`).join("")}</div>
      <p class="small">D'après l'énergie disponible pour les orages (CAPE) et les prévisions d'Open-Meteo. Rafales max : ${nf(gust)} km/h.</p>`;
  } catch {
    box.innerHTML = `<h2>Risque d'orage</h2>` + errorBox("Prévision indisponible pour le moment.");
  }
}
