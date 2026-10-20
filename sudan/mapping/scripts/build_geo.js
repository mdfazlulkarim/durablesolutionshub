// Builds the map files the site reads:
//   data/geo.json         pre-projected SVG paths: 18 states, Abyei, neighbouring countries
//   data/localities.json  localities (admin 2) grouped by state, for the form
//
// Run again only when a boundary file changes:
//   npm install d3-geo topojson-server topojson-simplify topojson-client polylabel world-atlas@2.0.2
//   node scripts/build_geo.js [states.geojson] [localities.geojson]
// The site itself needs no libraries.

const fs = require("fs");
const path = require("path");
const d3 = require("d3-geo");
const { topology } = require("topojson-server");
const { presimplify, simplify, quantile } = require("topojson-simplify");
const { feature, mesh } = require("topojson-client");
const polylabel = require("polylabel");
const world = require("world-atlas/countries-50m.json");

const ROOT = path.join(__dirname, "..");
const ADM1 = process.argv[2] || path.join(ROOT, "data/boundaries/geoBoundaries-SDN-ADM1_simplified.geojson");
const ADM2 = process.argv[3] || path.join(ROOT, "data/boundaries/geoBoundaries-SDN-ADM2_simplified.geojson");

// Boundary names to the standard English state names used on the site
const NAME_FIX = { "Gezira": "Aj Jazirah", "Al Jazirah": "Aj Jazirah", "Abyei PCA": "Abyei" };
const nameField = (p) => p.shapeName || p.ADM1_EN || p.ADM2_EN || p.admin1Name_en || p.name;

const reverseRings = (g) => {
  if (g.type === "Polygon") g.coordinates.forEach((r) => r.reverse());
  else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach((r) => r.reverse()));
};
// d3 expects clockwise outer rings; many GeoJSON files use the opposite order.
const rewind = (fc) => { fc.features.forEach((f) => { if (d3.geoArea(f) > 2 * Math.PI) reverseRings(f.geometry); }); return fc; };

function loadSimplified(file, keep) {
  const gj = JSON.parse(fs.readFileSync(file, "utf8"));
  let topo = presimplify(topology({ layer: gj }));
  topo = simplify(topo, quantile(topo, keep));
  loadSimplified.topo = topo;
  return rewind(feature(topo, topo.objects.layer));
}

const states = loadSimplified(ADM1, 0.35);
const statesTopo = loadSimplified.topo;
const W = 860, H = 920;
const proj = d3.geoMercator().fitExtent([[56, 24], [W - 56, H - 240]], states);
proj.clipExtent([[0, 0], [W, H]]);
const pathGen = d3.geoPath(proj).digits(1);

/* ---------- states ---------- */
const stateOut = states.features.map((f) => {
  const name = NAME_FIX[nameField(f.properties)] || nameField(f.properties);
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null, bestArea = -1;
  for (const poly of polys) {
    const a = Math.abs(d3.geoArea({ type: "Polygon", coordinates: poly }));
    if (a > bestArea) { bestArea = a; best = poly; }
  }
  const lp = polylabel(best.map((ring) => ring.map((pt) => proj(pt))), 0.5);
  const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
  return { name, path: pathGen(f), x: Math.round(lp[0]), y: Math.round(lp[1]), bbox: [x0, y0, x1, y1].map(Math.round) };
});

/* ---------- neighbouring countries (Natural Earth, public domain) ---------- */
const countries = feature(world, world.objects.countries).features;
const LABELS = {
  "818": { name: "EGYPT", at: [31.5, 22.6] },
  "434": { name: "LIBYA", at: [23.2, 21.4] },
  "148": { name: "CHAD", at: [21.4, 15.2] },
  "140": { name: "CENTRAL AFRICAN REP.", at: [22.2, 9.75] },
  "728": { name: "SOUTH SUDAN", at: [33.3, 8.9] },
  "231": { name: "ETHIOPIA", at: [37.2, 10.6] },
  "232": { name: "ERITREA", at: [38.6, 16.4] },
  "682": { name: "SAUDI ARABIA", at: [39.8, 22.6], anchor: "end" },
};
const land = [];
for (const c of countries) {
  const d = pathGen(c);
  if (!d) continue;
  const [[x0, y0], [x1, y1]] = pathGen.bounds(c);
  if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
  land.push({ id: c.id, name: c.properties.name, path: d });
}
const labels = Object.entries(LABELS).map(([id, l]) => {
  const [x, y] = proj(l.at);
  return { id, name: l.name, x: Math.round(x), y: Math.round(y), anchor: l.anchor || "middle" };
}).filter((l) => l.x > 10 && l.x < W + 5 && l.y > 10 && l.y < H - 6);
// Sudan and South Sudan boundary, drawn dashed (not yet determined)
const sdnSsd = pathGen(mesh(world, world.objects.countries, (a, b) =>
  (a.id === "729" && b.id === "728") || (a.id === "728" && b.id === "729")));

const result = {
  source: "States: geoBoundaries (gbOpen) SDN ADM1, from OCHA. Neighbouring countries: Natural Earth. Simplified, for illustration only.",
  width: W,
  height: H,
  land,
  labels,
  undeterminedBoundary: sdnSsd,
  // outer edge of Sudan (all states together), drawn as a thin dark line
  outline: pathGen(mesh(statesTopo, statesTopo.objects.layer, (a, b) => a === b)),
  states: stateOut.filter((s) => s.name !== "Abyei").sort((a, b) => a.name.localeCompare(b.name)),
  abyei: stateOut.find((s) => s.name === "Abyei") || null,
};
fs.writeFileSync(path.join(ROOT, "data/geo.json"), JSON.stringify(result));

/* ---------- localities grouped by state (point in polygon) ---------- */
const adm2 = rewind(JSON.parse(fs.readFileSync(ADM2, "utf8")));
const byState = {};
let unmatched = [];
for (const f of adm2.features) {
  const name = nameField(f.properties).trim();
  const c = d3.geoCentroid(f);
  let st = states.features.find((s) => d3.geoContains(s, c));
  if (!st) {
    // fall back to the nearest state centroid
    let best = null, bd = Infinity;
    for (const s of states.features) { const dd = d3.geoDistance(c, d3.geoCentroid(s)); if (dd < bd) { bd = dd; best = s; } }
    st = best; unmatched.push(name);
  }
  const sname = NAME_FIX[nameField(st.properties)] || nameField(st.properties);
  (byState[sname] = byState[sname] || []).push(name);
}
Object.values(byState).forEach((l) => l.sort((a, b) => a.localeCompare(b)));
fs.writeFileSync(path.join(ROOT, "data/localities.json"), JSON.stringify({
  source: "geoBoundaries (gbOpen) SDN ADM2, from OCHA ROSEA, CC BY 3.0 IGO. Admin 2 = locality.",
  states: byState,
}, null, 1));

console.log("geo.json", (fs.statSync(path.join(ROOT, "data/geo.json")).size / 1024).toFixed(1) + " KB;",
  result.land.length, "countries;", result.labels.length, "labels;", adm2.features.length, "localities;",
  "matched by nearest centroid:", unmatched.join(", ") || "none");
