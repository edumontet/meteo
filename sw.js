// Service worker minimal : l'appli s'ouvre même hors connexion (les données, elles, demandent le réseau).
const CACHE = "meteo-v1.12"; // même numéro que VERSION dans js/app.js
const SHELL = [
  "./", "index.html", "css/styles.css", "manifest.webmanifest", "icons/icon.svg",
  "js/app.js", "js/util.js", "js/saints.js", "js/moon.js", "js/tides-engine.js",
  "js/tab-meteo.js", "js/forecast-map.js", "js/radar-point.js", "js/tab-modeles.js", "js/tab-orages.js", "js/tab-soleil.js", "js/tab-champis.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // les API passent directement
  // Réseau d'abord (pour avoir toujours la dernière version), cache si hors ligne.
  e.respondWith(
    // « no-cache » : on redemande toujours au serveur si le fichier a changé (pas de vieille copie).
    fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }).then(r => {
      if (!r.ok) return r;
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
