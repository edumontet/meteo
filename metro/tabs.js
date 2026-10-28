// Onglets Métro / Bus (comme dans l'appli météo : l'onglet est dans l'adresse, #metro ou #bus).
"use strict";
(function () {
  const TITLES = { metro: "Métro Rennes", bus: "Bus Rennes" };
  function current() {
    const h = location.hash.replace("#", "");
    if (TITLES[h]) return h;
    try { const s = localStorage.getItem("metro.tab"); if (TITLES[s]) return s; } catch (e) {}
    return "metro";
  }
  function show(tab) {
    document.body.dataset.tab = tab;
    document.getElementById("title").textContent = TITLES[tab];
    for (const t of Object.keys(TITLES)) document.getElementById("tab-" + t).hidden = t !== tab;
    document.querySelectorAll(".tabs a").forEach(a => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    try { localStorage.setItem("metro.tab", tab); } catch (e) {}
    if (tab === "bus" && window.busShown) window.busShown();
    if (tab === "metro" && window.metroRefresh) window.metroRefresh();
  }
  window.addEventListener("hashchange", () => show(current()));
  show(current());
})();
