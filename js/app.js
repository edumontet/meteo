import { saintDuJour } from "./saints.js";
import { cap, dayLong, hm, getJSON, esc } from "./util.js";
import * as meteo from "./tab-meteo.js";
import * as modeles from "./tab-modeles.js";
import * as orages from "./tab-orages.js";
import * as soleil from "./tab-soleil.js";
import * as champis from "./tab-champis.js";

const TABS = { meteo, modeles, orages, soleil, champis };
const DEFAULT = { lat: 48.1173, lon: -1.6778, name: "Rennes", mode: "default" };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }
};

const state = { place: null, rendered: {}, current: null };

function setHeader() {
  const now = new Date();
  document.getElementById("title-date").textContent = cap(dayLong(now).replace(/ \d{4}$/, ""));
  document.getElementById("saint").textContent = saintDuJour(now);
  document.getElementById("updated").textContent = "MAJ " + hm(now);
}

function setPlace(place) {
  state.place = place;
  document.getElementById("loc-name").textContent = place.name + (place.mode === "gps" ? " · ma position" : "");
  state.rendered = {};
  show(state.current || currentTab());
}

function gps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("pas de GPS"));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
      reject,
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function placeName(lat, lon) {
  try {
    const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=fr`, { timeout: 6000 });
    return j.city || j.locality || j.principalSubdivision || "Ma position";
  } catch { return "Ma position"; }
}

async function locate() {
  const saved = store.get("place");
  if (saved && saved.mode === "fixed") return setPlace(saved);
  // Affiche tout de suite la dernière position connue (ou Rennes), puis affine avec le GPS.
  setPlace(saved || DEFAULT);
  try {
    const c = await gps();
    const moved = !saved || Math.abs(saved.lat - c.lat) > 0.02 || Math.abs(saved.lon - c.lon) > 0.02;
    if (moved) {
      const p = { ...c, name: await placeName(c.lat, c.lon), mode: "gps" };
      store.set("place", p);
      setPlace(p);
    }
  } catch {
    if (!saved) document.getElementById("loc-name").textContent = "Rennes (position non autorisée)";
  }
}

function currentTab() {
  const h = location.hash.replace("#", "");
  return TABS[h] ? h : "meteo";
}

async function show(name) {
  state.current = name;
  document.querySelectorAll(".tabs a").forEach(a => a.dataset.tab === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  for (const k of Object.keys(TABS)) document.getElementById("tab-" + k).hidden = k !== name;
  if (!state.place) return;
  const key = name + "@" + state.place.lat + "," + state.place.lon;
  if (state.rendered[name] === key) return;
  state.rendered[name] = key;
  const el = document.getElementById("tab-" + name);
  el.innerHTML = `<div class="loading">Chargement…</div>`;
  try {
    await TABS[name].render(el, { place: state.place });
  } catch (e) {
    console.error(e);
    state.rendered[name] = null;
    el.innerHTML = `<div class="error">Impossible de charger cet onglet (${esc(e.message)}). Vérifie ta connexion puis touche l'heure en haut à droite pour réessayer.</div>`;
  }
}

function refresh() {
  setHeader();
  state.rendered = {};
  show(currentTab());
}

// Choix du lieu
function setupDialog() {
  const dlg = document.getElementById("loc-dialog");
  const input = document.getElementById("city-input");
  const list = document.getElementById("city-results");
  document.getElementById("loc-btn").addEventListener("click", () => { list.innerHTML = ""; input.value = ""; dlg.showModal(); });
  document.getElementById("use-gps").addEventListener("click", async () => {
    dlg.close();
    const saved = store.get("place");
    if (saved) store.set("place", { ...saved, mode: "gps" });
    document.getElementById("loc-name").textContent = "Localisation…";
    try {
      const c = await gps();
      const p = { ...c, name: await placeName(c.lat, c.lon), mode: "gps" };
      store.set("place", p);
      setPlace(p);
    } catch {
      document.getElementById("loc-name").textContent = "Position non autorisée";
      alert("Position refusée. Sur iPhone : Réglages › Confidentialité › Service de localisation › Safari (ou Chrome) › « Lorsque l'app est active ».");
    }
  });
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { list.innerHTML = ""; return; }
    timer = setTimeout(async () => {
      try {
        const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=fr&format=json`);
        list.innerHTML = (j.results || []).map((r, i) =>
          `<li><button type="button" data-i="${i}">${esc(r.name)} <span style="color:#9AA8C2">· ${esc([r.admin2 || r.admin1, r.country_code].filter(Boolean).join(", "))}</span></button></li>`).join("") || `<li class="small">Aucun résultat</li>`;
        list.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
          const r = j.results[+b.dataset.i];
          const p = { lat: +r.latitude.toFixed(4), lon: +r.longitude.toFixed(4), name: r.name, mode: "fixed" };
          store.set("place", p);
          dlg.close();
          setPlace(p);
        }));
      } catch { list.innerHTML = `<li class="small">Recherche impossible pour l'instant.</li>`; }
    }, 300);
  });
}

function footer() {
  document.getElementById("foot").innerHTML =
    `Données : <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (Météo-France, ECMWF, NOAA) · ` +
    `<a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a> · ` +
    `<a href="https://www.blitzortung.org" target="_blank" rel="noopener">Blitzortung.org</a> · ` +
    `<a href="https://sdo.gsfc.nasa.gov" target="_blank" rel="noopener">NASA SDO</a> · ` +
    `<a href="https://www.swpc.noaa.gov" target="_blank" rel="noopener">NOAA SWPC</a> · ` +
    `marées calculées avec TICON-4 (<a href="https://www.seanoe.org/data/00980/109129/" target="_blank" rel="noopener">SEANOE</a>) et ` +
    `<a href="https://github.com/openwatersio/neaps" target="_blank" rel="noopener">Neaps</a>.<br>Marées non destinées à la navigation.`;
}

window.addEventListener("hashchange", () => show(currentTab()));
document.getElementById("refresh-btn").addEventListener("click", refresh);
document.addEventListener("visibilitychange", () => {
  // Au retour sur l'appli après plus de 10 minutes, on actualise.
  if (document.visibilityState === "visible" && Date.now() - (state.lastRefresh || 0) > 10 * 60 * 1000) { state.lastRefresh = Date.now(); refresh(); }
});

state.lastRefresh = Date.now();
setHeader();
footer();
setupDialog();
show(currentTab());
locate();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
