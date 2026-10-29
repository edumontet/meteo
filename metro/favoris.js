// Favoris : jusqu'à 10 recherches enregistrées (métro ou bus), avec le prochain passage de chacune
// affiché en direct dans un petit tableau en haut de l'appli. Toucher une ligne rouvre la recherche.
// S'appuie sur metro.js (LINES, same, parseRecord, directionOf, parseTime) et sur bus.js (busGet / busSet).
"use strict";
(function () {
  const MAX = 10;
  const API = "https://data.explore.star.fr/api/explore/v2.1/catalog/datasets/";
  const REFRESH_MS = 30000;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const q = s => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

  let favs = [];
  try { favs = JSON.parse(localStorage.getItem("favoris") || "[]").filter(f => f && f.t); } catch (e) {}
  const save = () => { try { localStorage.setItem("favoris", JSON.stringify(favs)); } catch (e) {} };
  const keyOf = f => f.t === "metro" ? `m|${f.line}|${f.station}|${f.dir}` : `b|${f.from}|${f.to}`;

  const data = { metro: [], bus: [], lastOk: 0, loading: false };
  let editing = false;

  // ---------- Données ----------
  async function exportJson(ds, params) {
    const res = await fetch(API + ds + "/exports/json?" + new URLSearchParams(Object.assign({ timezone: "Europe/Paris" }, params)), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }
  async function refresh() {
    if (data.loading || !favs.length) return;
    data.loading = true;
    try {
      const jobs = [];
      if (favs.some(f => f.t === "metro")) {
        jobs.push(exportJson("tco-metro-circulation-passages-tr", { where: "depart < now(minutes=90) or depart is null" })
          .catch(() => exportJson("tco-metro-circulation-passages-tr", {}))
          .then(rows => { data.metro = rows.map(parseRecord).filter(Boolean); }));
      }
      const stops = [...new Set(favs.filter(f => f.t === "bus").flatMap(f => (f.routes || []).map(r => r.idarret)))];
      if (stops.length) {
        jobs.push(exportJson("tco-bus-circulation-passages-tr", {
          select: "idarret,idligne,nomcourtligne,destination,depart,arrivee,precision",
          where: stops.map(id => "idarret=" + q(id)).join(" or ")
        }).then(rows => {
          data.bus = rows.map(r => ({
            idarret: String(r.idarret), idligne: String(r.idligne), short: r.nomcourtligne, dest: r.destination,
            time: parseTime(r.depart || r.arrivee)
          })).filter(p => !isNaN(p.time));
        }));
      }
      await Promise.all(jobs);
      data.lastOk = Date.now();
    } catch (e) { /* on garde les anciennes données, nouvel essai au prochain tour */ }
    data.loading = false;
    draw();
  }

  function busLines() {
    try { const c = JSON.parse(localStorage.getItem("bus.lines")); if (c && c.map) return c.map; } catch (e) {}
    return {};
  }

  // Prochains passages d'un favori
  function nextOf(f) {
    const now = Date.now();
    if (f.t === "metro") {
      return data.metro
        .filter(p => p.line === f.line && same(p.station, f.station) && p.time > now - 20000 && directionOf(p) === f.dir)
        .sort((a, b) => a.time - b.time);
    }
    const want = new Set((f.routes || []).map(r => r.idarret + "|" + r.idligne));
    return data.bus.filter(p => want.has(p.idarret + "|" + p.idligne) && p.time > now - 20000).sort((a, b) => a.time - b.time);
  }

  const fmt = sec => {
    const s = Math.max(0, Math.round(sec)), m = Math.floor(s / 60);
    return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
  };
  const fmtShort = sec => { const m = Math.floor(sec / 60); return m < 1 ? "< 1 min" : m + " min"; };

  // ---------- Tableau ----------
  function current() {
    const tab = document.body.dataset.tab;
    if (tab === "bus" && window.busGet) { const b = window.busGet(); return b.from && b.to ? keyOf({ t: "bus", ...b }) : null; }
    if (window.metroGet) { const m = window.metroGet(); return keyOf({ t: "metro", ...m }); }
    return null;
  }

  function draw() {
    const list = $("fav-list");
    $("fav-empty").hidden = favs.length > 0;
    $("fav-edit").hidden = favs.length === 0;
    if (!favs.length) editing = false;
    $("favs").classList.toggle("editing", editing);
    $("fav-edit").textContent = editing ? "Terminé" : "Modifier";
    const now = Date.now(), cur = current(), lines = busLines();

    // On ne reconstruit les lignes que si la liste a changé, sinon on met juste à jour les textes.
    const sig = favs.map(keyOf).join("\n");
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = favs.map((f, i) => `<li data-i="${i}"><span class="f-tag"></span><span class="f-text"><span class="f-name"></span><span class="f-sub"></span></span><span class="f-when"></span><button type="button" class="f-del" data-del="${i}" aria-label="Supprimer ce favori">×</button></li>`).join("");
    }
    [...list.children].forEach((li, i) => {
      const f = favs[i], n = nextOf(f), first = n[0];
      const tag = li.querySelector(".f-tag"), name = li.querySelector(".f-name"), sub = li.querySelector(".f-sub"), when = li.querySelector(".f-when");
      li.classList.toggle("on", keyOf(f) === cur);
      let subTxt;
      if (f.t === "metro") {
        tag.className = "f-tag metro-" + f.line.toLowerCase();
        tag.textContent = f.line;
        tag.removeAttribute("style");
        name.textContent = `${f.station} → ${f.dir}`;
        subTxt = "Métro " + f.line;
      } else {
        const info = first ? lines[first.idligne] || {} : {};
        tag.className = "f-tag";
        tag.textContent = first ? (first.short || info.short || "Bus") : "Bus";
        tag.style.background = info.color || "#2A3A5C";
        tag.style.color = info.text || "#EAF0FA";
        name.textContent = `${f.from} → ${f.to}`;
        subTxt = first && first.dest ? "vers " + first.dest : "Bus";
        if (!(f.routes || []).length) subTxt = "Pas de bus direct";
      }
      const second = n[1];
      if (second) subTxt += " · puis " + fmtShort((second.time - now) / 1000);
      sub.textContent = subTxt;

      if (!data.lastOk) { when.className = "f-when none"; when.textContent = "…"; }
      else if (!first) { when.className = "f-when none"; when.textContent = "Aucun"; }
      else {
        const d = (first.time - now) / 1000;
        when.className = "f-when" + (d < 60 ? " soon" : "");
        when.textContent = d <= 0 ? (f.t === "metro" ? "À quai" : "À l'arrêt") : fmt(d);
      }
    });
    updateButtons();
  }

  // ---------- Boutons « Ajouter aux favoris » ----------
  function setBtn(btn, key, possible) {
    const label = btn.querySelector("span");
    btn.hidden = !possible;
    const saved = key && favs.some(f => keyOf(f) === key);
    btn.classList.toggle("saved", !!saved);
    label.textContent = saved ? "Dans tes favoris" : favs.length >= MAX ? `${MAX} favoris au maximum` : "Ajouter aux favoris";
  }
  function updateButtons() {
    if (window.metroGet) {
      const m = window.metroGet();
      setBtn($("fav-metro"), keyOf({ t: "metro", ...m }), m.station && m.dir && !same(m.station, m.dir));
    }
    if (window.busGet) {
      const b = window.busGet();
      setBtn($("fav-bus"), b.from && b.to ? keyOf({ t: "bus", ...b }) : null, !!(b.from && b.to && Array.isArray(b.routes)));
    }
  }
  function toggle(fav) {
    const k = keyOf(fav), i = favs.findIndex(f => keyOf(f) === k);
    if (i >= 0) favs.splice(i, 1);
    else if (favs.length < MAX) favs.push(fav);
    else return;
    save();
    draw();
    if (i < 0) refresh();
  }
  $("fav-metro").addEventListener("click", () => {
    const m = window.metroGet();
    toggle({ t: "metro", line: m.line, station: m.station, dir: m.dir });
  });
  $("fav-bus").addEventListener("click", () => {
    const b = window.busGet();
    toggle({ t: "bus", from: b.from, to: b.to, routes: (b.routes || []).map(r => ({ idligne: r.idligne, idarret: r.idarret })) });
  });

  // ---------- Interactions avec le tableau ----------
  $("fav-edit").addEventListener("click", () => { editing = !editing; draw(); });
  $("fav-list").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) { favs.splice(Number(del.dataset.del), 1); save(); draw(); return; }
    const li = e.target.closest("li");
    if (!li || editing) return;
    const f = favs[Number(li.dataset.i)];
    if (f.t === "metro") {
      if (location.hash !== "#metro") location.hash = "#metro";
      window.metroSet(f.line, f.station, f.dir);
    } else {
      if (location.hash !== "#bus") location.hash = "#bus";
      window.busSet(f.from, f.to);
    }
    draw();
  });

  // Appelé par metro.js et bus.js à chaque rafraîchissement d'écran
  let pending = false;
  window.favUpdate = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; updateButtons(); });
  };

  draw();
  refresh();
  setInterval(() => { if (!document.hidden && favs.length) draw(); }, 1000);
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - data.lastOk > 10000) refresh(); });
})();
