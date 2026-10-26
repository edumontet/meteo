#!/usr/bin/env bash
# Régénère js/tides-engine.js (prédicteur Neaps + constantes TICON-4 de Saint-Malo et Brest).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm install --ignore-scripts @neaps/tide-database @neaps/tide-predictor esbuild >/dev/null
cat > extract.mjs <<'EOF'
import { stationsById } from "@neaps/tide-database";
import { writeFileSync } from "fs";
const pick = id => { const s = stationsById.get(id); return { id: s.id, name: s.name, source: s.source, msl: s.datums.MSL, datums: s.datums,
  constituents: s.harmonic_constituents.map(c => ({ name: c.name, amplitude: +c.amplitude.toFixed(5), phase: +c.phase.toFixed(3) })) }; };
writeFileSync("stations.json", JSON.stringify({ saintMalo: pick("ticon/saint_malo-410-fra-refmar"), brest: pick("ticon/brest-822-fra-uhslc_fd") }));
EOF
node extract.mjs
printf 'import { createTidePredictor } from "@neaps/tide-predictor";\nimport stations from "./stations.json";\nexport { createTidePredictor, stations };\n' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --minify --platform=browser --outfile="$ROOT/js/tides-engine.js"
rm -rf "$TMP"
