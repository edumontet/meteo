// Phases de la Lune — algorithme de Jean Meeus (Astronomical Algorithms, chap. 49).
// Précision de l'ordre de la minute, largement suffisante ici.

const RAD = Math.PI / 180;
const SYNODIC = 29.530588861;

function jdToDate(jd) { return new Date((jd - 2440587.5) * 86400000); }
function dateToJd(d) { return d.getTime() / 86400000 + 2440587.5; }

// phase : 0 = nouvelle lune, 0.25 = premier quartier, 0.5 = pleine lune, 0.75 = dernier quartier
function truePhase(k, phase) {
  k = k + phase;
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * RAD;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * RAD;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;
  const s = Math.sin;
  let c;
  if (phase === 0 || phase === 0.5) {
    const a = phase === 0
      ? [-0.40720, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208]
      : [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209];
    c = a[0] * s(Mp) + a[1] * E * s(M) + a[2] * s(2 * Mp) + a[3] * s(2 * F) + a[4] * E * s(Mp - M)
      + a[5] * E * s(Mp + M) + a[6] * E * E * s(2 * M) - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F)
      + 0.00056 * E * s(2 * Mp + M) - 0.00042 * s(3 * Mp) + 0.00042 * E * s(M + 2 * F)
      + 0.00038 * E * s(M - 2 * F) - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(Om);
  } else {
    c = -0.62801 * s(Mp) + 0.17172 * E * s(M) - 0.01183 * E * s(Mp + M) + 0.00862 * s(2 * Mp)
      + 0.00804 * s(2 * F) + 0.00454 * E * s(Mp - M) + 0.00204 * E * E * s(2 * M) - 0.00180 * s(Mp - 2 * F)
      - 0.00070 * s(Mp + 2 * F) - 0.00040 * s(3 * Mp) - 0.00034 * E * s(2 * Mp - M);
    const W = 0.00306 - 0.00038 * E * Math.cos(M) + 0.00026 * Math.cos(Mp) - 0.00002 * Math.cos(Mp - M)
      + 0.00002 * Math.cos(Mp + M) + 0.00002 * Math.cos(2 * F);
    c += phase === 0.25 ? W : -W;
  }
  return jde + c - 69 / 86400; // TT -> UT (approx.)
}

// Liste des phases principales autour d'une date.
export function phasesAround(date, monthsBefore = 1, monthsAfter = 14) {
  const k0 = Math.floor((date.getFullYear() + (date.getMonth() + date.getDate() / 31) / 12 - 2000) * 12.3685);
  const out = [];
  for (let k = k0 - monthsBefore - 1; k <= k0 + monthsAfter; k++) {
    for (const p of [0, 0.25, 0.5, 0.75]) out.push({ phase: p, date: jdToDate(truePhase(k, p)) });
  }
  return out.sort((a, b) => a.date - b.date);
}

export function moonInfo(now = new Date()) {
  const list = phasesAround(now);
  const prevNew = [...list].reverse().find(x => x.phase === 0 && x.date <= now);
  const nextNew = list.find(x => x.phase === 0 && x.date > now);
  const nextFull = list.find(x => x.phase === 0.5 && x.date > now);
  const prevFull = [...list].reverse().find(x => x.phase === 0.5 && x.date <= now);
  const age = (now - prevNew.date) / 86400000;               // jours depuis la nouvelle lune
  const frac = age / ((nextNew.date - prevNew.date) / 86400000); // 0..1 dans la lunaison
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;
  const hoursFromFull = Math.min(Math.abs(now - prevFull.date), Math.abs(nextFull.date - now)) / 3600000;
  const hoursFromNew = Math.min(Math.abs(now - prevNew.date), Math.abs(nextNew.date - now)) / 3600000;
  const waxing = frac < 0.5;
  let name;
  if (hoursFromNew < 24) name = "Nouvelle lune";
  else if (hoursFromFull < 24) name = "Pleine lune";
  else if (Math.abs(frac - 0.25) < 0.034) name = "Premier quartier";
  else if (Math.abs(frac - 0.75) < 0.034) name = "Dernier quartier";
  else if (frac < 0.25) name = "Premier croissant";
  else if (frac < 0.5) name = "Gibbeuse croissante";
  else if (frac < 0.75) name = "Gibbeuse décroissante";
  else name = "Dernier croissant";
  return {
    frac, illum, waxing, name, age,
    nextNew: nextNew.date, nextFull: nextFull.date,
    phases: list
  };
}

// Phase (0..1) à une date donnée, pour les petites icônes.
export function phaseAt(date, phases) {
  const prev = [...phases].reverse().find(x => x.phase === 0 && x.date <= date);
  const next = phases.find(x => x.phase === 0 && x.date > date);
  if (!prev || !next) return 0;
  return (date - prev.date) / (next.date - prev.date);
}

// SVG d'une lune pour une phase 0..1 (hémisphère nord : croissante éclairée à droite).
export function moonSVG(frac, size = 120, opts = {}) {
  const r = size / 2 - (opts.pad ?? 2), cx = size / 2, cy = size / 2;
  const lit = opts.lit || "#F1DFAE", dark = opts.dark || "#1E2A44";
  const id = "m" + Math.random().toString(36).slice(2, 8);
  // terminator: ellipse de demi-axe |cos| * r
  const phaseAngle = frac * 2 * Math.PI;
  const kx = Math.cos(phaseAngle) * r; // >0 : croissant, <0 : gibbeux (pour la moitié croissante)
  const waxing = frac < 0.5;
  const top = `${cx} ${cy - r}`, bottom = `${cx} ${cy + r}`;
  // demi-disque éclairé (droite si croissante, gauche sinon)
  const outerSweep = waxing ? 1 : 0;
  const rx = Math.abs(kx);
  // sens du terminator : bombé vers le côté éclairé quand c'est un croissant
  const crescent = Math.cos(phaseAngle) > 0;
  const innerSweep = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
  const d = `M${top} A${r} ${r} 0 0 ${outerSweep} ${bottom} A${rx} ${r} 0 0 ${innerSweep} ${top} Z`;
  const craters = opts.craters ? `
    <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.28}" r="${r * 0.18}" fill="#000" opacity="0.10"/>
    <circle cx="${cx + r * 0.25}" cy="${cy + r * 0.22}" r="${r * 0.25}" fill="#000" opacity="0.08"/>
    <circle cx="${cx + r * 0.12}" cy="${cy - r * 0.4}" r="${r * 0.09}" fill="#000" opacity="0.10"/>
    <circle cx="${cx - r * 0.35}" cy="${cy + r * 0.35}" r="${r * 0.11}" fill="#000" opacity="0.08"/>` : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs><clipPath id="${id}"><path d="${d}"/></clipPath></defs>
    ${opts.halo ? `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="#F4C76B" opacity="0.10"/>` : ""}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${dark}" stroke="#3A4C70" stroke-width="1"/>
    <g clip-path="url(#${id})"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${lit}"/>${craters}</g>
  </svg>`;
}
