// Localisation : à l'ouverture, on choisit la station de métro la plus proche et on la fait clignoter.
"use strict";
(function () {
  // Coordonnées approchées (entrée principale). Remplacées par celles de STAR si elles se chargent.
  let STATIONS = [
    ["A", "J.F. Kennedy", 48.1215, -1.7110], ["A", "Villejean-Université", 48.1213, -1.7041],
    ["A", "Pontchaillou", 48.1212, -1.6930], ["A", "Anatole France", 48.1179, -1.6874],
    ["A", "Sainte-Anne", 48.1144, -1.6801], ["A", "République", 48.1099, -1.6786],
    ["A", "Charles de Gaulle", 48.1062, -1.6767], ["A", "Gares", 48.1035, -1.6720],
    ["A", "Jacques Cartier", 48.0975, -1.6741], ["A", "Clemenceau", 48.0934, -1.6752],
    ["A", "Henri Fréville", 48.0876, -1.6745], ["A", "Italie", 48.0861, -1.6650],
    ["A", "Triangle", 48.0846, -1.6581], ["A", "Le Blosne", 48.0880, -1.6510],
    ["A", "La Poterie", 48.0874, -1.6444],
    ["B", "Saint-Jacques - Gaîté", 48.0869, -1.7003], ["B", "La Courrouze", 48.0965, -1.6985],
    ["B", "Cleunay", 48.1021, -1.7040], ["B", "Mabilais", 48.1055, -1.6950],
    ["B", "Colombier", 48.1051, -1.6835], ["B", "Gares", 48.1035, -1.6720],
    ["B", "Saint-Germain", 48.1112, -1.6755], ["B", "Sainte-Anne", 48.1144, -1.6801],
    ["B", "Jules Ferry", 48.1170, -1.6700], ["B", "Gros-Chêne", 48.1226, -1.6610],
    ["B", "Les Gayeulles", 48.1290, -1.6530], ["B", "Joliot-Curie - Chateaubriand", 48.1220, -1.6462],
    ["B", "Beaulieu - Université", 48.1205, -1.6340], ["B", "Atalante", 48.1260, -1.6250],
    ["B", "Cesson - Viasilva", 48.1300, -1.6130]
  ];
  const MAX_M = 1500;            // au-delà, on ne choisit rien
  const AGAIN_MS = 10 * 60000;   // relocaliser si l'appli revient au premier plan après 10 min
  const $ = id => document.getElementById(id);
  let touched = false, lastFix = 0;

  // Coordonnées officielles des quais STAR (moyenne par station), si le jeu de données répond.
  fetch("https://data.explore.star.fr/api/explore/v2.1/catalog/datasets/tco-metro-topologie-pointsarret-td/exports/json")
    .then(r => r.ok ? r.json() : null).then(rows => {
      if (!Array.isArray(rows)) return;
      const acc = {};
      for (const r of rows) {
        const name = r.nom || r.nomarret || r.nomstation;
        let lat, lon;
        for (const v of Object.values(r)) {
          if (v && typeof v === "object" && "lat" in v && "lon" in v) { lat = +v.lat; lon = +v.lon; break; }
        }
        if (!name || !isFinite(lat) || !isFinite(lon)) continue;
        for (const s of STATIONS) if (same(s[1], name)) {
          const k = s[0] + s[1];
          (acc[k] = acc[k] || []).push([lat, lon]);
        }
      }
      STATIONS = STATIONS.map(s => {
        const pts = acc[s[0] + s[1]];
        if (!pts) return s;
        return [s[0], s[1], pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      });
    }).catch(() => {});

  function dist(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const x = (lon2 - lon1) * r * Math.cos((lat1 + lat2) / 2 * r), y = (lat2 - lat1) * r;
    return Math.hypot(x, y) * R;
  }

  function show(text, flash) {
    const h = $("here");
    h.hidden = false;
    h.innerHTML = text;
    if (flash) {
      h.classList.remove("flash"); void h.offsetWidth; h.classList.add("flash");
      const sel = $("station");
      sel.classList.remove("flash"); void sel.offsetWidth; sel.classList.add("flash");
    }
  }

  function locate(manual) {
    if (!navigator.geolocation) { if (manual) show("Localisation indisponible sur cet appareil"); return; }
    if (manual) show("Recherche de ta position…");
    navigator.geolocation.getCurrentPosition(pos => {
      lastFix = Date.now();
      if (touched && !manual) return; // tu as déjà choisi une station toi-même
      const { latitude: la, longitude: lo } = pos.coords;
      const cur = window.metroGet();
      let best = null;
      for (const s of STATIONS) {
        const d = dist(la, lo, s[2], s[3]) - (s[0] === cur.line ? 1 : 0); // à égalité, on garde la ligne affichée
        if (!best || d < best.d) best = { line: s[0], name: s[1], d };
      }
      if (!best || best.d > MAX_M) {
        $("here").hidden = !manual;
        if (manual) show("Aucune station de métro à moins de 1,5 km");
        return;
      }
      if (best.line !== cur.line || best.name !== cur.station) window.metroSetStation(best.line, best.name);
      const m = Math.round(best.d / 10) * 10;
      window.hereStation = best.name; // pour les favoris qui partent d'ici
      if (window.favHere) window.favHere();
      show(`<span class="pin">●</span> Tu es à <b>${best.name}</b> · ${m < 50 ? "sur place" : "à " + m + " m"}`, true);
    }, err => {
      if (manual) show(err.code === 1 ? "Localisation refusée : autorise-la dans Réglages › Safari" : "Position introuvable");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: manual ? 0 : 60000 });
  }

  $("locate").addEventListener("click", () => { touched = false; locate(true); });
  $("station").addEventListener("change", () => { touched = true; $("here").hidden = true; });
  $("fav-list").addEventListener("click", () => { touched = true; $("here").hidden = true; });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastFix > AGAIN_MS) { touched = false; locate(false); }
  });
  locate(false);
})();
