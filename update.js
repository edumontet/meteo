// Mise à jour automatique : quand l'appli revient au premier plan, on regarde si ses fichiers ont
// changé sur le serveur ; si oui, on recharge la page. Plus besoin de supprimer et réinstaller l'appli.
// Rien à faire à la mise en ligne : l'empreinte est calculée sur les fichiers eux-mêmes.
"use strict";
(function () {
  const me = document.currentScript;
  const MIN_GAP = 60000; // pas plus d'une vérification par minute
  if (me.dataset.sw && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(new URL(me.dataset.sw, me.src)).catch(() => {});
  }
  if (!window.crypto || !crypto.subtle) return;

  let files = null, base = null, last = 0, busy = false;

  // Tous les fichiers de l'appli chargés par la page (HTML, JS, CSS du même site).
  function listFiles() {
    const set = new Set([location.href.split("#")[0]]);
    for (const e of performance.getEntriesByType("resource")) {
      const u = new URL(e.name);
      if (u.origin === location.origin && /\.(js|css|html?)$|\/$/.test(u.pathname)) set.add(u.href);
    }
    return [...set].sort();
  }

  async function fingerprint() {
    const texts = await Promise.all(files.map(u =>
      fetch(u, { cache: "no-store" }).then(r => r.ok ? r.text() : "").catch(() => null)));
    if (texts.some(t => t === null)) return null; // hors connexion : on ne conclut rien
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(files.join("|") + "\n" + texts.join("\u0000")));
    return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
  }

  async function check() {
    if (busy || Date.now() - last < MIN_GAP) return;
    busy = true; last = Date.now();
    try {
      if (!files) files = listFiles();
      const fp = await fingerprint();
      if (!fp) return;
      if (!base) { base = fp; return; }
      if (fp !== base) {
        const t = document.createElement("div");
        t.textContent = "Nouvelle version · mise à jour…";
        t.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;padding:8px 14px;border-radius:999px;background:#2563eb;color:#fff;font:600 14px -apple-system,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)";
        document.body.appendChild(t);
        setTimeout(() => location.reload(), 600);
      }
    } finally { busy = false; }
  }

  // Empreinte de départ quelques secondes après l'ouverture, puis vérification à chaque retour.
  window.addEventListener("load", () => setTimeout(() => { last = 0; check(); }, 3000));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  window.addEventListener("pageshow", e => { if (e.persisted) check(); });
})();
