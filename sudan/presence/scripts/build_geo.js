// Builds data/localities-geo.json: pre-projected SVG paths for the 189 localities (admin 2),
// drawn in exactly the same projection as the state map of the Solutions Footprint
// (../mapping/data/geo.json), so both layers line up.
//
// Run again only when a boundary file changes:
//   npm install d3-geo topojson-server topojson-simplify topojson-client polylabel
//   node scripts/build_geo.js
// The page itself needs no libraries.

const fs = require("fs");
const path = require("path");
const d3 = require("d3-geo");
const { topology } = require("topojson-server");
const { presimplify, simplify, quantile } = require("topojson-simplify");
const { feature } = require("topojson-client");
const polylabelLib = require("polylabel");
const polylabel = polylabelLib.default || polylabelLib; // newer versions export it as default

const ROOT = path.join(__dirname, "..");
const BOUNDS = path.join(ROOT, "../mapping/data/boundaries");
const ADM1 = path.join(BOUNDS, "geoBoundaries-SDN-ADM1_simplified.geojson");
const ADM2 = path.join(BOUNDS, "geoBoundaries-SDN-ADM2_simplified.geojson");

const NAME_FIX = { "Gezira": "Aj Jazirah", "Al Jazirah": "Aj Jazirah", "Abyei PCA": "Abyei" };
// Localities whose centre falls just outside their state in the simplified state file
const STATE_FIX = { "Al Fashaga": "Gedaref" };
// Short state codes, used where two localities share a name (as in the OCHA 3W: Ar Rahad-GD, Ar Rahad-NK)
const STATE_CODE = { "Gedaref": "GD", "North Kordofan": "NK" };
const nameField = (p) => p.shapeName || p.ADM1_EN || p.ADM2_EN || p.admin1Name_en || p.name;

const reverseRings = (g) => {
  if (g.type === "Polygon") g.coordinates.forEach((r) => r.reverse());
  else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach((r) => r.reverse()));
};
const rewind = (fc) => { fc.features.forEach((f) => { if (d3.geoArea(f) > 2 * Math.PI) reverseRings(f.geometry); }); return fc; };

function loadSimplified(file, keep) {
  const gj = JSON.parse(fs.readFileSync(file, "utf8"));
  let topo = presimplify(topology({ layer: gj }));
  topo = simplify(topo, quantile(topo, keep));
  return rewind(feature(topo, topo.objects.layer));
}

// Same projection as ../mapping/scripts/build_geo.js
const states = loadSimplified(ADM1, 0.35);
const W = 860, H = 920;
const proj = d3.geoMercator().fitExtent([[56, 24], [W - 56, H - 240]], states);
proj.clipExtent([[0, 0], [W, H]]);
const pathGen = d3.geoPath(proj).digits(1);

const adm2 = loadSimplified(ADM2, 0.3);
const out = adm2.features.map((f) => {
  const name = nameField(f.properties).trim();
  const c = d3.geoCentroid(f);
  let st = states.features.find((s) => d3.geoContains(s, c));
  if (!st) {
    let best = null, bd = Infinity;
    for (const s of states.features) { const dd = d3.geoDistance(c, d3.geoCentroid(s)); if (dd < bd) { bd = dd; best = s; } }
    st = best;
  }
  const state = STATE_FIX[name] || NAME_FIX[nameField(st.properties)] || nameField(st.properties);
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let bestPoly = null, bestArea = -1;
  for (const poly of polys) {
    const a = Math.abs(d3.geoArea({ type: "Polygon", coordinates: poly }));
    if (a > bestArea) { bestArea = a; bestPoly = poly; }
  }
  const lp = polylabel(bestPoly.map((ring) => ring.map((pt) => proj(pt))), 0.5);
  const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
  return { name, state, path: pathGen(f), x: Math.round(lp[0] * 10) / 10, y: Math.round(lp[1] * 10) / 10, bbox: [x0, y0, x1, y1].map(Math.round) };
});

// A key per locality that matches the OCHA 3W spelling
const seen = {};
out.forEach((l) => { seen[l.name] = (seen[l.name] || 0) + 1; });
out.forEach((l) => { l.key = seen[l.name] > 1 ? `${l.name}-${STATE_CODE[l.state] || l.state}` : l.name; });
out.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

const file = path.join(ROOT, "data/localities-geo.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({
  source: "Localities: geoBoundaries (gbOpen) SDN ADM2, from OCHA ROSEA, CC BY 3.0 IGO. Simplified, for illustration only.",
  width: W,
  height: H,
  localities: out.map(({ key, name, state, path: d, x, y, bbox }) => ({ key, name, state, path: d, x, y, bbox })),
}));
console.log("localities-geo.json", (fs.statSync(file).size / 1024).toFixed(1) + " KB;", out.length, "localities;",
  "shared names:", Object.keys(seen).filter((k) => seen[k] > 1).join(", ") || "none");
