// Onglet Bus : on choisit l'arrêt de départ et l'arrêt d'arrivée, l'appli trouve les lignes directes
// et affiche dans combien de temps passe le prochain bus au départ, dans le bon sens.
// Données STAR Data Explore :
//   tco-bus-topologie-dessertes-td  (arrêts desservis par chaque parcours, dans l'ordre)
//   tco-bus-circulation-passages-tr (prochains passages aux arrêts, temps réel)
//   tco-bus-topologie-lignes-td     (nom court et couleurs des lignes)
"use strict";
(function () {
  const API = "https://data.explore.star.fr/api/explore/v2.1/catalog/datasets/";
  const DS_DESSERTES = "tco-bus-topologie-dessertes-td";
  const DS_PASSAGES = "tco-bus-circulation-passages-tr";
  const DS_LIGNES = "tco-bus-topologie-lignes-td";
  const DS_POINTS = "tco-bus-topologie-pointsarret-td";
  const REFRESH_MS = 30000;
  const CACHE_DAYS = 7;

  const $ = id => document.getElementById(id);
  // Les heures STAR arrivent parfois en « 2026-10-29 05:43:24+0100 », que Safari ne sait pas lire.
  function parseTime(s) {
    if (!s) return NaN;
    return Date.parse(String(s).trim().replace(" ", "T").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  }
  const debugOn = /[?&]debug/.test(location.search);

  const S = {
    stops: [],          // noms d'arrêts
    lines: {},          // idligne -> { short, color, text }
    from: null, to: null,
    routes: null,       // [{ idligne, idarret, nb }] ou null si pas encore calculé
    routeKey: "",
    passages: [],       // { idligne, short, dest, time, realtime, nb }
    lastOk: 0, loading: false, error: null, routeError: null
  };

  // ---------- Outils ----------
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const q = s => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  function store(k, v) { try { localStorage.setItem("bus." + k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem("bus." + k); } catch (e) { return null; } }
  function pick(r, names) {
    for (const n of names) if (r[n] !== undefined && r[n] !== null && r[n] !== "") return r[n];
    return null;
  }
  function pickLike(r, re, not) {
    for (const k of Object.keys(r)) if (re.test(k) && !(not && not.test(k)) && r[k] !== null && r[k] !== "" && typeof r[k] !== "object") return r[k];
    return null;
  }
  const hhmm = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const hhmmss = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function fmt(sec) {
    const s = Math.max(0, Math.round(sec)), m = Math.floor(s / 60);
    return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
  }
  const fmtShort = sec => { const m = Math.floor(sec / 60); return sec <= 0 ? "à l'arrêt" : m < 1 ? "< 1 min" : m + " min"; };

  async function exportJson(ds, params) {
    const u = API + ds + "/exports/json?" + new URLSearchParams(Object.assign({ timezone: "Europe/Paris" }, params));
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) { const e = new Error("HTTP " + res.status); e.status = res.status; throw e; }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Réponse inattendue");
    return data;
  }

  function debug(title, obj) {
    if (!debugOn) return;
    const d = $("b-debug");
    d.hidden = false;
    d.textContent += "== " + title + " ==\n" + JSON.stringify(obj, null, 1).slice(0, 3000) + "\n\n";
  }

  // ---------- Liste des arrêts (mise en cache une semaine) ----------
  async function loadStops() {
    try {
      const c = JSON.parse(load("stops") || "null");
      if (c && c.list && c.list.length > 50 && Date.now() - c.t < CACHE_DAYS * 864e5) { S.stops = c.list; return; }
    } catch (e) {}
    let names = [];
    try {
      const rows = await exportJson(DS_DESSERTES, { select: "nomarret", group_by: "nomarret" });
      names = rows.map(r => r.nomarret);
      debug("arrêts (dessertes)", rows.slice(0, 3));
    } catch (e) {
      const rows = await exportJson(DS_POINTS, {});
      debug("arrêts (points d'arrêt)", rows.slice(0, 2));
      names = rows.map(r => pick(r, ["nom", "nomarret", "libelle"]) || pickLike(r, /^nom/i));
    }
    S.stops = [...new Set(names.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, "fr"));
    if (S.stops.length) store("stops", JSON.stringify({ t: Date.now(), list: S.stops }));
  }

  async function loadLines() {
    try {
      const c = JSON.parse(load("lines") || "null");
      if (c && c.map && Date.now() - c.t < CACHE_DAYS * 864e5) { S.lines = c.map; return; }
    } catch (e) {}
    try {
      const rows = await exportJson(DS_LIGNES, {});
      debug("lignes", rows.slice(0, 2));
      const map = {};
      for (const r of rows) {
        const id = pick(r, ["id", "idligne"]);
        if (id === null) continue;
        let color = pick(r, ["couleurligne", "couleur"]) || pickLike(r, /couleur/i, /texte/i);
        let text = pick(r, ["couleurtexteligne", "couleurtexte"]) || pickLike(r, /couleur.*texte|texte.*couleur/i);
        const fix = c => c ? (String(c).startsWith("#") ? String(c) : "#" + c) : null;
        map[String(id)] = { short: String(pick(r, ["nomcourt", "nomcourtligne"]) || id), color: fix(color), text: fix(text) };
      }
      S.lines = map;
      store("lines", JSON.stringify({ t: Date.now(), map }));
    } catch (e) { /* sans couleurs, tant pis */ }
  }

  // ---------- Lignes directes entre les deux arrêts ----------
  async function findRoutes() {
    const key = S.from + "→" + S.to;
    if (S.routeKey === key && S.routes) return;
    S.routeKey = key; S.routes = null; S.routeError = null; S.passages = []; S.lastOk = 0;
    render();
    try {
      const rows = await exportJson(DS_DESSERTES, {
        select: "idparcours,idarret,nomarret,ordre,idligne",
        where: "nomarret=" + q(S.from) + " or nomarret=" + q(S.to)
      });
      debug("dessertes départ/arrivée", rows.slice(0, 4));
      if (S.routeKey !== key) return;
      const byP = {};
      for (const r of rows) {
        const p = byP[r.idparcours] || (byP[r.idparcours] = { a: [], b: [] });
        (norm(r.nomarret) === norm(S.from) ? p.a : p.b).push(r);
      }
      const best = {};
      for (const p of Object.values(byP)) {
        for (const a of p.a) {
          const after = p.b.filter(b => Number(b.ordre) > Number(a.ordre));
          if (!after.length) continue;
          const nb = Math.min(...after.map(b => Number(b.ordre))) - Number(a.ordre);
          const k = a.idligne + "|" + a.idarret;
          if (!best[k] || nb < best[k].nb) best[k] = { idligne: String(a.idligne), idarret: String(a.idarret), nb };
        }
      }
      S.routes = Object.values(best);
    } catch (e) {
      S.routeError = e;
      S.routes = null;
    }
    render();
    if (S.routes && S.routes.length) refresh();
  }

  // ---------- Prochains passages ----------
  async function fetchPassages(ids, quoted) {
    const where = ids.map(id => "idarret=" + (quoted ? q(id) : id)).join(" or ");
    return exportJson(DS_PASSAGES, { where });
  }

  async function refresh() {
    if (S.loading || !S.routes || !S.routes.length) return;
    S.loading = true;
    $("b-status").classList.add("spin");
    const key = S.routeKey;
    try {
      const ids = [...new Set(S.routes.map(r => r.idarret))];
      let rows;
      try { rows = await fetchPassages(ids, true); }
      catch (e) { if (e.status === 400 && ids.every(i => /^\d+$/.test(i))) rows = await fetchPassages(ids, false); else throw e; }
      debug("passages", rows.slice(0, 3));
      if (S.routeKey !== key) return;
      const want = {};
      for (const r of S.routes) want[r.idarret + "|" + r.idligne] = r;
      S.passages = rows.map(r => {
        const route = want[String(r.idarret) + "|" + String(r.idligne)];
        if (!route) return null;
        const raw = pick(r, ["depart", "arrivee"]) || pickLike(r, /depart|arriv/i);
        const time = raw ? parseTime(raw) : NaN;
        if (isNaN(time)) return null;
        const info = S.lines[String(r.idligne)] || {};
        const prec = String(pick(r, ["precision"]) || "");
        return {
          idligne: String(r.idligne),
          short: String(pick(r, ["nomcourtligne"]) || info.short || r.idligne),
          dest: pick(r, ["destination"]) || "",
          time, nb: route.nb,
          realtime: !prec || /temps\s*r/i.test(prec)
        };
      }).filter(Boolean);
      S.lastOk = Date.now();
      S.error = null;
    } catch (e) {
      S.error = e;
    } finally {
      S.loading = false;
      $("b-status").classList.remove("spin");
      render();
    }
  }

  // ---------- Affichage ----------
  function badge(p) {
    const info = S.lines[p.idligne] || {};
    const st = info.color ? ` style="background:${esc(info.color)};color:${esc(info.text || "#fff")}"` : "";
    return `<span class="badge"${st}>${esc(p.short)}</span>`;
  }

  function render() {
    if (window.favUpdate) window.favUpdate();
    const label = $("b-label"), main = $("b-main"), next = $("b-next"), note = $("b-note"), list = $("b-list");
    const st = $("b-status"), stText = $("b-status-text");
    const setMsg = (title, sub) => {
      label.innerHTML = ""; main.className = "r-main small"; main.textContent = title;
      next.textContent = sub || ""; note.textContent = ""; list.innerHTML = "";
    };

    st.classList.toggle("err", !!(S.error || S.routeError));
    if (!S.stops.length && !S.from) { stText.textContent = S.error ? "Liste des arrêts indisponible · toucher pour réessayer" : "Chargement des arrêts…"; }
    else if (S.error && S.lastOk) stText.textContent = "Mise à jour impossible · données de " + hhmmss(S.lastOk);
    else if (S.error || S.routeError) stText.textContent = "Données STAR injoignables · toucher pour réessayer";
    else if (S.lastOk) stText.textContent = "Temps réel STAR · mis à jour à " + hhmmss(S.lastOk);
    else stText.textContent = S.routes === null && S.from && S.to ? "Recherche des lignes…" : "";

    if (!S.from || !S.to) return setMsg("Choisis tes deux arrêts", "Départ et arrivée");
    if (norm(S.from) === norm(S.to)) return setMsg("Même arrêt au départ et à l'arrivée", "Choisis un autre arrêt d'arrivée.");
    if (S.routeError) return setMsg("Pas de connexion aux données", "");
    if (S.routes === null) return setMsg("Recherche…", "");
    if (!S.routes.length) return setMsg("Pas de bus direct", "Aucune ligne ne relie ces deux arrêts sans changement.");
    if (!S.lastOk) return setMsg(S.error ? "Pas de connexion aux données" : "Chargement…", "");

    const now = Date.now();
    const all = S.passages.filter(p => p.time > now - 20000).sort((a, b) => a.time - b.time);
    if (!all.length) return setMsg("Aucun bus annoncé", "Pas de passage prévu pour l'instant (nuit ou trafic interrompu).");

    const f = all[0], d = (f.time - now) / 1000;
    label.innerHTML = `<div class="r-head">${badge(f)}${f.dest ? "<span>vers " + esc(f.dest) + "</span>" : ""}</div>`;
    main.className = "r-main" + (d < 30 ? " now" : "");
    main.textContent = d <= 0 ? "À l'arrêt" : fmt(d);
    const same = all.filter(p => p !== f && p.idligne === f.idligne)[0];
    next.textContent = same ? "Puis dans " + fmtShort((same.time - now) / 1000) : "";
    const bits = [f.nb + (f.nb > 1 ? " arrêts" : " arrêt") + " jusqu'à " + S.to, "départ " + hhmm(f.time)];
    if (!f.realtime) bits.push("horaire théorique");
    note.textContent = bits.join(" · ");

    list.innerHTML = all.slice(1, 7).map(p => {
        const s = (p.time - now) / 1000;
        return `<li>${badge(p)}<span class="dest">${esc(p.dest || "")}</span><span class="when">${fmtShort(s)}${p.realtime ? "" : '<span class="theo">théorique</span>'}</span></li>`;
      }).join("");
  }

  // ---------- Champs de saisie avec suggestions ----------
  function setupInput(which) {
    const input = $(which), box = $(which + "-sugg");
    let items = [], hl = -1;
    const close = () => { box.hidden = true; hl = -1; };
    const choose = name => {
      input.value = name; close();
      S[which] = name; store(which, name);
      input.blur();
      if (S.from && S.to && norm(S.from) !== norm(S.to)) findRoutes(); else render();
    };
    const update = () => {
      const t = norm(input.value);
      if (!t) { close(); return; }
      const words = t.split(" ");
      items = S.stops.filter(n => { const x = norm(n); return words.every(w => x.includes(w)); })
        .sort((a, b) => (norm(b).startsWith(t) - norm(a).startsWith(t)) || a.localeCompare(b, "fr"))
        .slice(0, 8);
      box.innerHTML = items.map((n, i) => `<li data-i="${i}">${esc(n)}</li>`).join("");
      box.hidden = !items.length;
      hl = -1;
    };
    input.addEventListener("input", () => { S[which] = null; update(); render(); });
    input.addEventListener("focus", () => { input.select(); if (input.value) update(); });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        hl = Math.max(0, Math.min(items.length - 1, hl + (e.key === "ArrowDown" ? 1 : -1)));
        [...box.children].forEach((li, i) => li.classList.toggle("hl", i === hl));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items.length) choose(items[Math.max(0, hl)]);
      } else if (e.key === "Escape") close();
    });
    box.addEventListener("pointerdown", e => {
      const li = e.target.closest("li");
      if (!li) return;
      e.preventDefault();
      choose(items[Number(li.dataset.i)]);
    });
    input.addEventListener("blur", () => {
      setTimeout(close, 150);
      const exact = S.stops.find(n => norm(n) === norm(input.value));
      if (exact && S[which] !== exact) choose(exact);
    });
    const saved = load(which);
    if (saved) { input.value = saved; S[which] = saved; }
  }

  // ---------- Démarrage ----------
  let started = false;
  async function start() {
    if (started) return;
    started = true;
    render();
    try {
      await Promise.all([loadStops(), loadLines()]);
      S.error = null;
    } catch (e) {
      S.error = e;
      started = false;
    }
    render();
    if (S.from && S.to && norm(S.from) !== norm(S.to)) findRoutes();
  }

  setupInput("from");
  setupInput("to");
  $("swap").addEventListener("click", () => {
    [S.from, S.to] = [S.to, S.from];
    $("from").value = S.from || ""; $("to").value = S.to || "";
    store("from", S.from || ""); store("to", S.to || "");
    if (S.from && S.to && norm(S.from) !== norm(S.to)) findRoutes(); else render();
  });
  $("b-status").addEventListener("click", () => {
    if (!started) start();
    else if (S.routeError) { S.routeKey = ""; findRoutes(); }
    else refresh();
  });

  // Pour les favoris
  window.busGet = () => ({ from: S.from, to: S.to, routes: S.routes, lines: S.lines });
  window.busSet = (from, to) => {
    S.from = from; S.to = to;
    $("from").value = from; $("to").value = to;
    store("from", from); store("to", to);
    if (!started) start(); else findRoutes();
  };

  const busVisible = () => document.visibilityState === "visible" && document.body.dataset.tab === "bus";
  window.busShown = () => {
    if (!started) start();
    else if (Date.now() - S.lastOk > 10000) refresh();
  };
  document.addEventListener("visibilitychange", () => { if (busVisible() && started && Date.now() - S.lastOk > 10000) refresh(); });
  setInterval(() => { if (busVisible()) render(); }, 1000);
  setInterval(() => { if (busVisible()) refresh(); }, REFRESH_MS);
})();
