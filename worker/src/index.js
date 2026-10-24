/* Solutions Footprint back end (Cloudflare Worker).

   Public API, called by the website:
     POST /api/submit         one project from the form (with photos and a logo)
     POST /api/submit-batch   several projects from an Excel upload
     POST /api/photos         add photos to a project that is still waiting for review
     GET  /api/status         status of submissions sent from a browser
     POST /api/auth/start     sign in, step 1: email a 6-digit code to an approved email
     POST /api/auth/verify    sign in, step 2: check the code and return a session key
     GET  /api/auth/me        who is signed in
     GET  /api/news           latest ReliefWeb reports for a theme page (women), cached for 3 hours

   Admin API, for signed-in DSU admins only (used by manage.html on the website):
     /admin/api/...           review queue, edit, publish, all projects, organisations, history, approved editors

   Publishing writes data/projects.json (and photos and logos) to the public GitHub
   repository in one commit. GitHub Pages then updates the map within about two minutes.
   Focal point names and emails, and the approved editors, stay in the database and are never published. */

const STATES = [
  "Aj Jazirah", "Blue Nile", "Central Darfur", "East Darfur", "Gedaref", "Kassala",
  "Khartoum", "North Darfur", "North Kordofan", "Northern", "Red Sea", "River Nile",
  "Sennar", "South Darfur", "South Kordofan", "West Darfur", "West Kordofan", "White Nile",
];
const MAX_PHOTOS = 3;
const MAX_FILE = 1024 * 1024; // photos and logos are made smaller in the browser to under 1 MB
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/* ---------------- small helpers ---------------- */
const enc = new TextEncoder();
const nowIso = () => new Date().toISOString();
const khartoumTime = (iso) => (iso ? new Date(new Date(iso).getTime() + 2 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "");
const todayKhartoum = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
const uid = () => crypto.randomUUID().replace(/-/g, "");
const str = (v, max = 300) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, max);
const text = (v, max = 800) => (v == null ? "" : String(v)).trim().slice(0, max);
const numOrNull = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : null; };
const list = (v, max = 40) => (Array.isArray(v) ? v : String(v || "").split(";")).map((x) => str(x, 200)).filter(Boolean).slice(0, max);
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  b64 = String(b64).replace(/^data:[^,]*,/, "");
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256(s) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return bytesToB64(new Uint8Array(sig)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* ---------------- database ---------------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, ref TEXT, lead TEXT, name TEXT, data TEXT NOT NULL,
     private TEXT, published INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, token TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT,
     ref TEXT, source TEXT, batch TEXT, row_no INTEGER, status TEXT NOT NULL DEFAULT 'pending', lead TEXT, name TEXT,
     data TEXT NOT NULL, private TEXT, note TEXT, received_at TEXT, reviewed_at TEXT, ip TEXT, submitted_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS sub_status ON submissions(status, received_at)`,
  `CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, mime TEXT,
     size INTEGER, data BLOB, created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS files_owner ON files(owner)`,
  `CREATE TABLE IF NOT EXISTS refs (prefix TEXT PRIMARY KEY, last INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS logos (acronym TEXT PRIMARY KEY, name TEXT, full TEXT, mark TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, action TEXT, detail TEXT, commit_sha TEXT, by_email TEXT, project_id TEXT, changes TEXT)`,
  `CREATE TABLE IF NOT EXISTS editors (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'admin', agency TEXT, added_by TEXT, added_at TEXT, last_signin TEXT, name TEXT)`,
  `CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, topic TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, org TEXT, date TEXT,
     place TEXT, summary TEXT, quote TEXT, quote_by TEXT, sort INTEGER, created_by TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS signin_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS ratelimit (key TEXT PRIMARY KEY, count INTEGER, window_start INTEGER)`,
];
let schemaReady = false, importedReady = false;
// The projects already on the map are copied into the database the first time the system is used,
// so project numbers continue from the existing ones and nothing on the map is lost.
async function ensureImported(env) {
  if (importedReady) return;
  if (!(await one(env, "SELECT value FROM settings WHERE key='imported'"))) await seed(env);
  await ensureCodes(env);
  importedReady = true;
}
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  // databases made before sign-in existed get the new column for who made each change
  for (const sql of ["ALTER TABLE log ADD COLUMN by_email TEXT", "ALTER TABLE log ADD COLUMN project_id TEXT", "ALTER TABLE log ADD COLUMN changes TEXT", "ALTER TABLE editors ADD COLUMN name TEXT", "ALTER TABLE submissions ADD COLUMN submitted_by TEXT",
    "ALTER TABLE stories ADD COLUMN photo TEXT", "ALTER TABLE stories ADD COLUMN photo_credit TEXT", "ALTER TABLE stories ADD COLUMN photo_alt TEXT"]) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  schemaReady = true;
}
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
const run = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).run();

async function setting(env, key, make) {
  const row = await one(env, "SELECT value FROM settings WHERE key=?", key);
  if (row) return row.value;
  if (!make) return null;
  const value = make();
  await run(env, "INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", key, value);
  return (await one(env, "SELECT value FROM settings WHERE key=?", key)).value;
}
// The change log: who did what, when, and for project edits every field that changed (before and after).
async function addLog(env, action, detail, sha = null, by = null, projectId = null, changes = null) {
  await run(env, "INSERT INTO log(at,action,detail,commit_sha,by_email,project_id,changes) VALUES(?,?,?,?,?,?,?)",
    nowIso(), action, detail, sha, by, projectId, changes && changes.length ? JSON.stringify(changes) : null);
}
const LOG_FIELDS = [
  ["name", "Project name"], ["description", "Description"], ["interventionTypes", "Intervention type"], ["orgType", "Organisation type"],
  ["lead", "Lead organisation"], ["leadName", "Lead full name"], ["leadership", "Leadership"], ["partners", "Implementing partners"],
  ["nationwide", "Nationwide"], ["states", "States"], ["localities", "Localities"], ["criteria", "IASC criteria"], ["coordination", "Coordination"],
  ["start", "Start"], ["end", "End"], ["reportedStatus", "Reported status"], ["budget", "Budget (USD)"], ["share", "Durable solutions share"],
  ["donors", "Donors"], ["people", "People reached"], ["femaleShare", "Women and girls"], ["pwdShare", "Persons with disabilities"],
  ["pwdFemaleShare", "Persons with disabilities, women and girls"], ["peopleSex", "Breakdown by sex and age"], ["remarks", "Remarks"], ["photos", "Photos"],
];
function logValue(k, v) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
  if (k === "start" || k === "end") return String(v).slice(0, 7);
  if (["share", "femaleShare", "pwdShare", "pwdFemaleShare"].includes(k)) return `${Math.round(Number(v) * 1000) / 10}%`;
  if (k === "donors") return v.map((d) => (d.amount != null ? `${d.name}: ${d.amount}` : d.name)).join("; ");
  if (k === "people") return Object.entries(v).filter(([, n]) => n != null).map(([g, n]) => `${PEOPLE_LABELS[g] || g} ${n}`).join("; ");
  if (k === "nationwide") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const PEOPLE_LABELS = { total: "Total", idps: "IDPs", returnees: "Returnees", refugees: "Refugees", host: "Host community", other: "Other" };
// older records keep donors as one text ("donor"); compare them as a list so they are not shown as a change
const donorList = (d) => (d?.donors && d.donors.length ? d.donors : d?.donor ? String(d.donor).split(/;\s*/).filter(Boolean).map((name) => ({ name, amount: null })) : []);
function diffFields(before, after, privBefore, privAfter) {
  const out = [];
  for (const [k, label] of LOG_FIELDS) {
    const a = logValue(k, k === "donors" ? donorList(before) : before?.[k]), b = logValue(k, k === "donors" ? donorList(after) : after?.[k]);
    if (a !== b) out.push({ field: label, from: a, to: b });
  }
  for (const [k, label] of [["fpName", "Focal point"], ["fpEmail", "Focal point email"]]) {
    if (!privAfter) break;
    const a = str(privBefore?.[k]), b = str(privAfter?.[k]);
    if (a !== b) out.push({ field: label, from: a, to: b, private: true });
  }
  return out;
}
async function rateLimited(env, key, max, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await one(env, "SELECT count, window_start FROM ratelimit WHERE key=?", key);
  if (!row || now - row.window_start > windowSec) {
    await run(env, "INSERT INTO ratelimit(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1, window_start=excluded.window_start", key, now);
    return false;
  }
  if (row.count >= max) return true;
  await run(env, "UPDATE ratelimit SET count=count+1 WHERE key=?", key);
  return false;
}

/* ---------------- project numbers ---------------- */
// Same rule as the form and the data script: the lead's acronym in capitals, then a running number.
function refPrefix(lead, hint) {
  const h = String(hint || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  if (h) return h;
  const l = String(lead || "").trim();
  if (l && !/\s/.test(l)) return l.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "ORG";
  const words = l.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|for|the|in)$/i.test(w));
  return (words.map((w) => w[0]).join("").toUpperCase().slice(0, 10)) || "ORG";
}
/* Project codes: country, permanent number, lead agency, start year and end year, for example SD-001-IOM-26-32.
   The number never changes and is never reused; the agency and the years follow the project's current details. */
const pad3 = (n) => String(n).padStart(3, "0");
const yy = (d) => (d && /^\d{4}/.test(String(d)) ? String(d).slice(2, 4) : "00");
const country = (env) => (env.COUNTRY_CODE || "SD").toUpperCase();
const serialOf = (ref) => { const m = String(ref || "").match(/^[A-Z]{2}-(\d{3,})-/); return m ? Number(m[1]) : null; };
const makeCode = (env, serial, lead, start, end) => `${country(env)}-${pad3(serial)}-${refPrefix(lead)}-${yy(start)}-${yy(end)}`;
async function nextSerial(env) {
  await run(env, "INSERT OR IGNORE INTO refs(prefix,last) VALUES('_serial',0)");
  return (await one(env, "UPDATE refs SET last=last+1 WHERE prefix='_serial' RETURNING last")).last;
}
async function newCode(env, p, prefixHint) {
  return `${country(env)}-${pad3(await nextSerial(env))}-${refPrefix(p.lead, prefixHint)}-${yy(p.start)}-${yy(p.end)}`;
}
// One-off change from the old numbers (IOM-001) to the new codes, in order of start date. It is safe to run
// again: projects that already have a new code only get their agency and years brought up to date.
async function ensureCodes(env) {
  const state = await setting(env, "codes_v2");
  if (state === "done") return;
  if (!state) {
    const rows = await all(env, "SELECT id, ref, data FROM projects");
    let max = Math.max(0, ...rows.map((r) => serialOf(r.ref) || 0));
    const order = rows.filter((r) => !serialOf(r.ref)).map((r) => ({ ...r, d: parse(r.data, {}) }))
      .sort((a, b) => String(a.d.start || "9999").localeCompare(String(b.d.start || "9999")) || String(a.ref || "").localeCompare(String(b.ref || "")));
    const stmts = [], moved = [];
    const codes = {};
    for (const r of rows) if (serialOf(r.ref)) { const d = parse(r.data, {}); codes[r.id] = makeCode(env, serialOf(r.ref), d.lead, d.start, d.end); }
    for (const r of order) codes[r.id] = makeCode(env, ++max, r.d.lead, r.d.start, r.d.end);
    for (const r of rows) {
      if (codes[r.id] === r.ref) continue;
      stmts.push(env.DB.prepare("UPDATE projects SET ref=? WHERE id=?").bind(codes[r.id], r.id));
      stmts.push(env.DB.prepare("UPDATE submissions SET ref=? WHERE target_id=?").bind(codes[r.id], r.id));
      stmts.push(env.DB.prepare("INSERT INTO log(at,action,detail,by_email,project_id,changes) VALUES(?,?,?,?,?,?)")
        .bind(nowIso(), "code changed", `${r.ref || r.id} is now ${codes[r.id]}`, null, r.id, JSON.stringify([{ field: "Project code", from: r.ref || "", to: codes[r.id] }])));
      moved.push(`${r.ref || r.id} to ${codes[r.id]}`);
    }
    for (const sub of await all(env, "SELECT id, ref, data FROM submissions WHERE target_id IS NULL AND status='pending'")) {
      if (serialOf(sub.ref)) continue;
      const d = parse(sub.data, {});
      stmts.push(env.DB.prepare("UPDATE submissions SET ref=? WHERE id=?").bind(makeCode(env, ++max, d.lead, d.start, d.end), sub.id));
    }
    stmts.push(env.DB.prepare("INSERT INTO refs(prefix,last) VALUES('_serial',?) ON CONFLICT(prefix) DO UPDATE SET last=max(last,excluded.last)").bind(max));
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('codes_v2','db')"));
    await env.DB.batch(stmts);
    if (moved.length) await addLog(env, "codes", `Project codes changed to country-number-agency-start-end for ${moved.length} projects`);
  }
  // publish the new codes to the website
  if (env.GITHUB_TOKEN) {
    try {
      const sha = await commitFiles(env, await siteFiles(env), "Project codes: country, number, agency, start year and end year");
      await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES('codes_v2','done')");
      await addLog(env, "codes", "New project codes published to the website", sha);
    } catch (e) { console.error("codes not published yet", e); /* tried again on the next request */ }
  }
}
const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
async function uniqueId(env, base) {
  let id = base || uid().slice(0, 12), n = 1;
  while (await one(env, "SELECT 1 FROM projects WHERE id=?", id)) id = `${base}-${++n}`;
  return id;
}

/* ---------------- a project from form answers ---------------- */
function lastDay(ym) { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
function projectFromAnswers(a) {
  const ym = (v) => (/^\d{4}-(0[1-9]|1[0-2])/.test(String(v || "")) ? String(v).slice(0, 7) : "");
  const nationwide = a.scope === "nationwide" || a.nationwide === true;
  const budget = numOrNull(a.budget);
  let share = numOrNull(a.share);
  if (share != null) share = Math.max(0, Math.min(100, share)) / 100;
  const people = {};
  ["total", "idps", "returnees", "refugees", "host", "other"].forEach((k) => {
    const v = numOrNull((a.people || {})[k]);
    people[k] = v == null ? null : Math.max(0, Math.round(v));
  });
  // the total adds up the groups (older entries may only have a total)
  const groupVals = ["idps", "returnees", "refugees", "host", "other"].map((k) => people[k]).filter((v) => v != null);
  if (groupVals.length) people.total = groupVals.reduce((s, v) => s + v, 0);
  const ex = a.peopleExtra || a;
  const toShare = (v) => { const n = numOrNull(v); return n == null ? null : Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000; };
  let peopleSex = null;
  if (ex.peopleSex && typeof ex.peopleSex === "object") {
    peopleSex = {};
    ["idps", "returnees", "refugees", "host", "other"].forEach((g) => {
      const r = ex.peopleSex[g];
      if (!r) return;
      const row = {};
      ["women", "girls", "men", "boys"].forEach((x) => { const n = numOrNull(r[x]); row[x] = n == null ? null : Math.max(0, Math.round(n)); });
      if (Object.values(row).some((v) => v != null)) peopleSex[g] = row;
    });
    if (!Object.keys(peopleSex).length) peopleSex = null;
  }
  const start = ym(a.start), end = ym(a.end);
  // several donors, each with the amount it gives
  const donors = (Array.isArray(a.donors) ? a.donors : []).slice(0, 5) // up to 5 donors per project
    .map((d) => ({ name: str(d && d.name, 160), amount: numOrNull(d && d.amount) }))
    .filter((d) => d.name).map((d) => ({ name: d.name, amount: d.amount != null && d.amount > 0 ? Math.round(d.amount * 100) / 100 : null }));
  return {
    name: str(a.name, 250),
    description: text(a.description, 600) || null,
    interventionTypes: list(a.itypes || a.interventionTypes, 12),
    lead: str(a.lead, 120),
    orgType: str(a.orgType, 60) || null,
    leadership: list(a.leadership, 4).filter((x) => ["WLO", "RLO", "YLO", "OPD"].includes(x)),
    partners: list(a.partners, 30),
    partnerTypes: [],
    nationwide,
    states: nationwide ? [] : list(a.states, 18).filter((s) => STATES.includes(s)),
    localities: nationwide ? [] : list(a.localities, 120),
    criteria: [...new Set((a.criteria || []).map(Number).filter((n) => n >= 1 && n <= 8))].sort(),
    coordination: str(a.coordination, 120) || null,
    start: start ? `${start}-01` : null,
    end: end ? lastDay(end) : null,
    reportedStatus: ["Ongoing", "Pipeline", "Ended"].includes(a.status || a.reportedStatus) ? (a.status || a.reportedStatus) : null,
    budget: budget != null ? Math.round(budget * 100) / 100 : null,
    share: share != null ? Math.round(share * 10000) / 10000 : null,
    dsFunding: budget != null && share != null ? Math.round(budget * share * 100) / 100 : null,
    donor: donors.length ? donors.map((d) => d.name).join("; ") : str(a.donor, 200) || null,
    donors,
    people,
    femaleShare: toShare(ex.femaleShare),
    pwdShare: toShare(ex.pwdShare),
    pwdFemaleShare: toShare(ex.pwdShare) == null ? null : toShare(ex.pwdFemaleShare),
    peopleSex,
    remarks: text(a.remarks, 800) || null,
    photos: [],
  };
}
// Clean a project edited in the admin pages (already in the published shape)
function cleanProject(d) {
  const p = projectFromAnswers({
    ...d, itypes: d.interventionTypes, status: d.reportedStatus, scope: d.nationwide ? "nationwide" : "states",
    start: d.start, end: d.end, share: d.share != null ? d.share * 100 : null,
  });
  if (d.leadName) p.leadName = str(d.leadName, 200);
  return p;
}
function checkAnswers(p) {
  const errs = [];
  if (!p.name) errs.push("Project name is missing");
  if (!p.lead) errs.push("Lead organisation is missing");
  if (!p.nationwide && !p.states.length) errs.push("Choose at least one state, or nationwide");
  if (!p.criteria.length) errs.push("Choose at least one IASC criterion");
  if (p.start && p.end && p.end < p.start) errs.push("End date is before the start date");
  if ((p.donors || []).length > 1 && p.donors.some((d) => d.amount == null)) errs.push("With more than one donor, the amount from each donor is needed");
  return errs;
}

/* ---------------- checks shown to the reviewer ---------------- */
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function nameMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const A = new Set(x.split(" ")), B = new Set(y.split(" "));
  return [...A].filter((w) => B.has(w)).length / new Set([...A, ...B]).size >= 0.7;
}
const sameSet = (a, b) => { const A = new Set((a || []).map(String)), B = new Set((b || []).map(String)); return A.size > 0 && A.size === B.size && [...A].every((v) => B.has(v)); };
function matchPoints(p, q) {
  const pts = [];
  if (nameMatch(p.name, q.name)) pts.push("name");
  if (p.start && q.start && p.start.slice(0, 7) === q.start.slice(0, 7)) pts.push("start month");
  if (p.end && q.end && p.end.slice(0, 7) === q.end.slice(0, 7)) pts.push("end month");
  if (p.budget != null && q.budget != null && Math.abs(p.budget - q.budget) <= Math.max(1, q.budget * 0.01)) pts.push("budget");
  if (p.nationwide ? q.nationwide : sameSet(p.states, q.states)) pts.push("states");
  if (sameSet(p.criteria, q.criteria)) pts.push("IASC criteria");
  return pts;
}
async function computeChecks(env, sub) {
  const p = parse(sub.data, {});
  const out = [];
  const errs = checkAnswers(p);
  errs.forEach((e) => out.push({ level: "error", text: e }));
  if (sub.kind !== "correction") {
    const same = await all(env, "SELECT id, ref, data FROM projects WHERE lower(lead)=lower(?) AND published=1", p.lead || "");
    let best = null;
    same.forEach((r) => { const pts = matchPoints(p, parse(r.data, {})); if (pts.length >= 3 && (!best || pts.length > best.pts.length)) best = { ...r, pts }; });
    if (best) out.push({ level: "warn", kind: "duplicate", ref: best.ref, id: best.id, text: `Looks like ${best.ref || best.id}: same lead and ${best.pts.join(", ")} (${best.pts.length + 1} of 7 points)` });
  }
  const logo = p.lead ? await one(env, "SELECT 1 FROM logos WHERE acronym=?", p.lead) : null;
  if (p.lead && !logo) {
    const sent = await one(env, "SELECT 1 FROM files WHERE owner=? AND kind='logo'", sub.id);
    out.push({ level: sent ? "info" : "warn", kind: "logo", text: sent ? "No logo on the map yet: logo sent with the project" : "No logo on the map yet" });
  }
  const empty = [];
  if (!p.start || !p.end) empty.push("dates");
  if (p.budget == null) empty.push("budget");
  if (p.share == null) empty.push("durable solutions share");
  if (p.people && p.people.total == null) empty.push("people reached");
  if (empty.length) out.push({ level: "info", text: `Empty: ${empty.join(", ")}` });
  return out;
}

/* ---------------- GitHub ---------------- */
async function gh(env, path, opts = {}, repo = env.GITHUB_REPO) {
  if (!env.GITHUB_TOKEN) throw new HttpError(500, "The GitHub key is not set up yet (GITHUB_TOKEN).");
  const r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${repo}${path}`, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: opts.accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "solutions-footprint", "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.raw) return r;
  const t = await r.text();
  if (!r.ok) { const e = new HttpError(r.status === 401 ? 500 : 502, `GitHub said ${r.status}: ${t.slice(0, 200)}`); e.gh = r.status; throw e; }
  return t ? JSON.parse(t) : null;
}
// Paths inside the site (data/projects.json, assets/photos/...) live under SITE_DIR in the repository
const repoPath = (env, path) => `${env.SITE_DIR || ""}${path}`;
async function readRepoFile(env, path) {
  if (!env.GITHUB_TOKEN) { // before the key is added, read the published copy instead
    const r = await fetch(`${env.SITE_URL}${path}`, { cf: { cacheTtl: 0 } });
    if (r.status === 404) return null;
    if (!r.ok) throw new HttpError(502, `Could not read ${path} from the website (${r.status})`);
    return r.text();
  }
  const r = await gh(env, `/contents/${repoPath(env, path)}?ref=${env.GITHUB_BRANCH || "main"}`, { accept: "application/vnd.github.raw", raw: true });
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, `Could not read ${path} from GitHub (${r.status})`);
  return r.text();
}
// One commit with several files. files: [{ path, text } | { path, b64 } | { path, remove: true }]
// Paths are inside the site folder; target = { repo, dir } (the folder of the site in that repository).
async function commitTo(env, target, files, message) {
  const branch = env.GITHUB_BRANCH || "main";
  const at = (path) => `${target.dir || ""}${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await gh(env, `/git/ref/heads/${branch}`, {}, target.repo);
    const base = await gh(env, `/git/commits/${head.object.sha}`, {}, target.repo);
    const tree = [];
    for (const f of files) {
      if (f.remove) { tree.push({ path: at(f.path), mode: "100644", type: "blob", sha: null }); continue; }
      const blob = await gh(env, "/git/blobs", { method: "POST", body: f.b64 ? { content: f.b64, encoding: "base64" } : { content: f.text, encoding: "utf-8" } }, target.repo);
      tree.push({ path: at(f.path), mode: "100644", type: "blob", sha: blob.sha });
    }
    const t = await gh(env, "/git/trees", { method: "POST", body: { base_tree: base.tree.sha, tree } }, target.repo);
    if (t.sha === base.tree.sha) return head.object.sha; // nothing changed
    const author = { name: env.COMMIT_NAME || "Solutions Footprint", email: env.COMMIT_EMAIL || "noreply@example.org", date: nowIso() };
    const c = await gh(env, "/git/commits", { method: "POST", body: { message, tree: t.sha, parents: [head.object.sha], author, committer: author } }, target.repo);
    try {
      await gh(env, `/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: c.sha } }, target.repo);
      return c.sha;
    } catch (e) { if (e.gh !== 422 || attempt === 2) throw e; } // someone else committed meanwhile: try again
  }
}
const primary = (env) => ({ repo: env.GITHUB_REPO, dir: env.SITE_DIR || "" });
const mirror = (env) => (env.MIRROR_REPO ? { repo: env.MIRROR_REPO, dir: env.MIRROR_DIR || "" } : null);

// Every change goes to the hub and, in the same moment, to the second site (the git page), so both stay identical.
async function commitFiles(env, files, message) {
  // Never write the map data before the projects already on the map have been imported
  if (!(await setting(env, "imported"))) throw new HttpError(409, "First import the current map data (button on the Review queue page), so the projects already on the map are kept.");
  const sha = await commitTo(env, primary(env), files, message);
  await mirrorFiles(env, files, message);
  return sha;
}
async function mirrorFiles(env, files, message) {
  const m = mirror(env);
  if (!m) return;
  try {
    // after a failed copy, send everything again (data, photos and logos), not only this change
    const full = (await setting(env, "mirror_status")) !== "ok";
    await commitTo(env, m, full ? await fullSiteFiles(env) : files, message);
    await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES('mirror_status','ok')");
  } catch (e) {
    console.error("second site not updated", e.message);
    await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES('mirror_status',?)", `${nowIso()} ${String(e.message).slice(0, 300)}`);
  }
}
// The whole published site data: the data files plus every photo and logo, read from the hub repository
async function fullSiteFiles(env) {
  const p = primary(env), branch = env.GITHUB_BRANCH || "main";
  const tree = await gh(env, `/git/trees/${branch}?recursive=1`, {}, p.repo);
  const want = (tree.tree || []).filter((x) => x.type === "blob" && x.path.startsWith(p.dir) && /^(assets\/photos\/|assets\/img\/logos\/)/.test(x.path.slice(p.dir.length)));
  const files = [];
  for (const x of want) {
    const blob = await gh(env, `/git/blobs/${x.sha}`, {}, p.repo);
    files.push({ path: x.path.slice(p.dir.length), b64: String(blob.content || "").replace(/\s+/g, "") });
  }
  // photos removed on the hub are removed on the second site too
  const m = mirror(env);
  const have = await gh(env, `/git/trees/${branch}?recursive=1`, {}, m.repo).catch(() => ({ tree: [] }));
  const keep = new Set(files.map((f) => f.path));
  (have.tree || []).filter((x) => x.type === "blob" && x.path.startsWith(m.dir) && x.path.slice(m.dir.length).startsWith("assets/photos/") && !keep.has(x.path.slice(m.dir.length)))
    .forEach((x) => files.push({ path: x.path.slice(m.dir.length), remove: true }));
  return [...files, ...(await siteFiles(env))];
}
// Alerts about new projects and changes waiting for review: an email to ALERT_EMAILS (and, if set up,
// an issue in the private INBOX_REPO). Alerts are best effort and never stop a submission.
async function notify(env, title, body) {
  const to = String(env.ALERT_EMAILS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (to.length && env.RESEND_API_KEY) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1c2230;max-width:560px">
      <p style="margin:0 0 6px;color:#1d5fae;font-size:12px;font-weight:bold;letter-spacing:.04em">DURABLE SOLUTIONS HUB | SUDAN</p>
      <p style="font-size:17px;font-weight:bold;margin:0 0 12px">${esc(title)}</p>
      <p style="white-space:pre-line;margin:0">${esc(body).replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>')}</p></div>`;
    for (const addr of to) { try { await sendMail(env, addr, title.slice(0, 200), body, html); } catch (e) { console.error("alert not sent", e.message); } }
  }
  if (env.INBOX_REPO && env.GITHUB_TOKEN) {
    try { await gh(env, "/issues", { method: "POST", body: { title: title.slice(0, 200), body } }, env.INBOX_REPO); } catch (e) { /* alerts are best effort */ }
  }
}

/* ---------------- publishing ---------------- */
async function siteFiles(env) {
  const rows = await all(env, "SELECT id, ref, data FROM projects WHERE published=1");
  const projects = rows.map((r) => ({ id: r.id, ...parse(r.data, {}), ref: r.ref })).sort((a, b) => (a.lead || "").localeCompare(b.lead || "") || (a.name || "").localeCompare(b.name || ""));
  const refs = {};
  (await all(env, "SELECT id, ref FROM projects WHERE ref IS NOT NULL ORDER BY id")).forEach((r) => (refs[r.id] = r.ref));
  const logos = {};
  (await all(env, "SELECT * FROM logos ORDER BY acronym")).forEach((l) => (logos[l.acronym] = { full: l.full, mark: l.mark, name: l.name }));
  return [
    { path: "data/projects.json", text: JSON.stringify({ lastUpdated: todayKhartoum(), projects }, null, 1) },
    { path: "data/project-refs.json", text: JSON.stringify(refs, null, 1) },
    { path: "data/logos.json", text: JSON.stringify(logos, null, 1) },
  ];
}
// Work out the final photo list: kept published paths plus new uploaded files (up to 3)
async function photoChanges(env, ref, wanted, before) {
  const files = [], photos = [], usedFiles = [];
  const keep = (wanted || []).filter((w) => w.path).map((w) => w.path).filter((p) => (before || []).includes(p));
  const taken = new Set(keep.map((p) => (p.match(/-(\d)\.\w+$/) || [])[1]));
  const ordered = [];
  for (const w of wanted || []) {
    if (ordered.length >= MAX_PHOTOS) break;
    if (w.path && keep.includes(w.path)) { ordered.push(w.path); continue; }
    if (!w.file) continue;
    const f = await one(env, "SELECT id, mime, data FROM files WHERE id=?", w.file);
    if (!f) continue;
    let i = 1; while (taken.has(String(i))) i++;
    taken.add(String(i));
    const base = serialOf(ref) ? ref.split("-").slice(0, 2).join("-") : ref; // SD-001: stays the same when the years change
    const path = `assets/photos/${base}-${i}.${IMAGE_TYPES[f.mime] || "jpg"}`;
    files.push({ path, b64: String(f.data) });
    ordered.push(path); usedFiles.push(f.id);
  }
  photos.push(...ordered);
  (before || []).filter((p) => !photos.includes(p) && !files.some((f) => f.path === p)).forEach((p) => files.push({ path: p, remove: true }));
  return { files, photos, usedFiles };
}
async function logoChanges(env, acronym, name, fileId) {
  if (!fileId || !acronym) return [];
  const f = await one(env, "SELECT id, mime, data FROM files WHERE id=?", fileId);
  if (!f) return [];
  const key = refPrefix(acronym);
  const ext = IMAGE_TYPES[f.mime] || "png";
  const full = `assets/img/logos/${key}.${ext}`, mark = `assets/img/logos/${key}-mark.${ext}`;
  const b64 = String(f.data);
  await run(env, "INSERT INTO logos(acronym,name,full,mark,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(acronym) DO UPDATE SET name=excluded.name, full=excluded.full, mark=excluded.mark, updated_at=excluded.updated_at",
    acronym, name || acronym, full, mark, nowIso());
  await run(env, "DELETE FROM files WHERE id=?", fileId);
  return [{ path: full, b64 }, { path: mark, b64 }];
}
async function publishProject(env, { id, ref, data, priv, photos, logo, logoName, message, published = 1 }) {
  const existing = id ? await one(env, "SELECT * FROM projects WHERE id=?", id) : null;
  const before = existing ? parse(existing.data, {}).photos || [] : [];
  const p = cleanProject(data);
  const errs = checkAnswers(p);
  if (errs.length && published) throw new HttpError(400, `Cannot publish: ${errs.join("; ")}`);
  if (!id) id = await uniqueId(env, slug(`${p.lead}-${p.name}`));
  // the code keeps its number; the agency and years follow the project's lead and dates
  const serial = serialOf(existing?.ref) || serialOf(ref) || await nextSerial(env);
  ref = makeCode(env, serial, p.lead, p.start, p.end);
  const ph = await photoChanges(env, ref, photos, before);
  p.photos = ph.photos;
  const changes = existing ? diffFields(parse(existing.data, {}), p, parse(existing.private, {}), priv) : [];
  if (existing && existing.ref !== ref) changes.unshift({ field: "Project code", from: existing.ref || "", to: ref });
  if (existing && !!existing.published !== !!published) changes.push({ field: "On the map", from: existing.published ? "Yes" : "No", to: published ? "Yes" : "No" });
  const t = nowIso();
  await run(env, `INSERT INTO projects(id,ref,lead,name,data,private,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET ref=excluded.ref, lead=excluded.lead, name=excluded.name, data=excluded.data,
    private=excluded.private, published=excluded.published, updated_at=excluded.updated_at`,
    id, ref, p.lead, p.name, JSON.stringify(p), JSON.stringify(priv || parse(existing?.private, {}) || {}), published ? 1 : 0, existing?.created_at || t, t);
  const lg = await logoChanges(env, p.lead, logoName, logo);
  const sha = await commitFiles(env, [...ph.files, ...lg, ...(await siteFiles(env))], message || `${!published ? "Hide" : existing ? "Update" : "Publish"} ${ref}: ${p.name}`);
  for (const f of ph.usedFiles) await run(env, "DELETE FROM files WHERE id=?", f);
  return { id, ref, sha, project: p, changes };
}

/* ---------------- request handling ---------------- */
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-SF-Admin", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {};
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const clientIp = (req) => req.headers.get("CF-Connecting-IP") || "local";

async function readJson(req, limit = 8 * 1024 * 1024) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > limit) throw new HttpError(413, "The upload is too large.");
  const t = await req.text();
  if (t.length > limit) throw new HttpError(413, "The upload is too large.");
  try { return JSON.parse(t); } catch { throw new HttpError(400, "The request could not be read."); }
}
async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
}
async function saveImage(env, owner, kind, img) {
  if (!img || !img.data) return null;
  const mime = IMAGE_TYPES[img.type] ? img.type : null;
  if (!mime) throw new HttpError(400, "Photos and logos must be JPG, PNG or WebP images.");
  // Photos are kept as base64 text, exactly as they are sent to GitHub, so nothing is converted here
  const b64 = String(img.data).replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, "The photo could not be read.");
  const size = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
  if (size > MAX_FILE) throw new HttpError(413, "Each photo or logo must be under 1 MB.");
  const head = b64ToBytes(b64.slice(0, 16));
  const isJpg = head[0] === 0xff && head[1] === 0xd8, isPng = head[0] === 0x89 && head[1] === 0x50, isWebp = head[8] === 0x57 && head[9] === 0x45;
  if (!(isJpg || isPng || isWebp)) throw new HttpError(400, "Photos and logos must be JPG, PNG or WebP images.");
  const realMime = isJpg ? "image/jpeg" : isPng ? "image/png" : "image/webp";
  const id = uid();
  await env.DB.prepare("INSERT INTO files(id,owner,kind,name,mime,size,data,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(id, owner, kind, str(img.name, 120) || kind, realMime, size, b64, nowIso()).run();
  return id;
}

/* Store one submission (form or Excel row). Returns { id, token, ref } */
async function storeSubmission(env, item, meta) {
  const a = item.answers || {};
  const p = projectFromAnswers(a);
  const errs = checkAnswers(p);
  // new submissions must give the people reached and the share of women and girls
  if (!(p.people.total > 0)) errs.push("People reached is missing");
  if (p.femaleShare == null) errs.push("The share of women and girls is missing");
  if (errs.length) throw new HttpError(400, errs.join("; "));
  const priv = { fpName: str(item.private?.fpName, 120), fpEmail: str(item.private?.fpEmail, 160) };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(priv.fpEmail)) throw new HttpError(400, "A valid focal point email is needed.");
  const id = uid(), token = uid();
  let kind = "new", target = null, ref;
  if (item.correction && item.correction.id) {
    const cur = await one(env, "SELECT id, ref FROM projects WHERE id=?", str(item.correction.id, 100));
    if (cur) { kind = "correction"; target = cur.id; ref = cur.ref; }
  }
  if (!ref) ref = await newCode(env, p, a.refPrefix);
  if (a.leadName) p.leadName = str(a.leadName, 200);
  await run(env, `INSERT INTO submissions(id,token,kind,target_id,ref,source,batch,row_no,status,lead,name,data,private,received_at,ip)
    VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)`,
    id, token, kind, target, ref, meta.source, meta.batch || null, meta.row || null, p.lead, p.name, JSON.stringify(p), JSON.stringify(priv), nowIso(), meta.ipHash);
  const photos = (item.photos || []).slice(0, MAX_PHOTOS);
  for (const ph of photos) await saveImage(env, id, "photo", ph);
  if (item.logo) await saveImage(env, id, "logo", item.logo);
  return { id, token, ref, kind, name: p.name, lead: p.lead };
}

/* Latest reports for the theme pages, from the ReliefWeb API (needs an approved appname in RELIEFWEB_APPNAME).
   Results are cached for 3 hours, so ReliefWeb is asked at most a few times a day. */
const NEWS_TOPICS = {
  women: { filter: { operator: "AND", conditions: [{ field: "primary_country.iso3", value: "sdn" }, { field: "theme.name", value: "Gender" }] } },
  disability: { filter: { field: "primary_country.iso3", value: "sdn" }, query: { value: "disability OR disabilities", fields: ["title", "body"] } },
};
const plain = (t, max) => String(t || "").replace(/<[^>]+>/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "")
  .replace(/^\s*[-*+]\s+/gm, "").replace(/[#*_>`|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
async function newsApi(env, ctx, url) {
  const topic = NEWS_TOPICS[url.searchParams.get("topic")] ? url.searchParams.get("topic") : "women";
  if (!env.RELIEFWEB_APPNAME) return json({ ok: true, configured: false, items: [] }, 200, { "Cache-Control": "public, max-age=600" });
  const key = new Request(`https://news.cache/${topic}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache && (await cache.match(key));
  if (hit) return new Response(hit.body, hit);
  const t = NEWS_TOPICS[topic];
  const r = await fetch(`${env.RELIEFWEB_API || "https://api.reliefweb.int"}/v2/reports?appname=${encodeURIComponent(env.RELIEFWEB_APPNAME)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset: "latest", profile: "list", limit: 12, filter: t.filter, ...(t.query ? { query: t.query } : {}),
      fields: { include: ["title", "url_alias", "url", "date.original", "date.created", "source.shortname", "source.name", "body"] } }),
  }).catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => null) : null;
  if (!j || !Array.isArray(j.data)) return json({ ok: true, configured: true, items: [], error: "ReliefWeb did not answer" }, 200, { "Cache-Control": "public, max-age=300" });
  const items = j.data.map((d) => { const f = d.fields || {}; const src = (f.source || [])[0] || {};
    return { title: plain(f.title, 300), url: f.url_alias || f.url, date: (f.date && (f.date.original || f.date.created)) || null, source: src.shortname || src.name || "", summary: plain(f.body, 240) }; })
    .filter((x) => x.title && /^https:\/\//.test(x.url || ""));
  const res = json({ ok: true, configured: true, topic, items, fetchedAt: nowIso() }, 200, { "Cache-Control": "public, max-age=10800" });
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function publicApi(req, env, ctx, url) {
  if (url.pathname === "/api/news" && req.method === "GET") return newsApi(env, ctx, url);
  const ip = clientIp(req);
  const ipHash = (await sha256(`${ip}|${await setting(env, "salt", uid)}`)).slice(0, 16);
  const adminUrl = `${env.SITE_URL || ""}manage.html`;

  if (url.pathname === "/api/submit" && req.method === "POST") {
    const body = await readJson(req);
    if (body.website) return json({ ok: true, ref: "", id: "", token: "" }); // filled by bots only
    if (await rateLimited(env, `sub:${ipHash}`, 30, 3600)) throw new HttpError(429, "Too many submissions from this connection. Please try again in an hour.");
    if (!(await turnstileOk(env, body.turnstile, ip))) throw new HttpError(403, "The spam check failed. Please reload the page and try again.");
    const r = await storeSubmission(env, body, { source: "form", ipHash });
    ctx.waitUntil(notify(env, `${r.kind === "correction" ? "Correction" : "New project"} ${r.ref}: ${r.name}`,
      `Lead: ${r.lead}\nFrom: the online form\n\nReview it here: ${adminUrl}#/review/${r.id}`));
    return json({ ok: true, id: r.id, token: r.token, ref: r.ref });
  }

  if (url.pathname === "/api/submit-batch" && req.method === "POST") {
    const body = await readJson(req, 4 * 1024 * 1024);
    if (body.website) return json({ ok: true, items: [] });
    if (await rateLimited(env, `batch:${ipHash}`, 10, 3600)) throw new HttpError(429, "Too many uploads from this connection. Please try again in an hour.");
    if (!(await turnstileOk(env, body.turnstile, ip))) throw new HttpError(403, "The spam check failed. Please reload the page and try again.");
    const rows = (body.rows || []).slice(0, 60);
    if (!rows.length) throw new HttpError(400, "No rows to send.");
    const batch = uid().slice(0, 12), items = [];
    for (const row of rows) {
      try { items.push({ row: row.row, ok: true, ...(await storeSubmission(env, row, { source: "excel", batch, row: row.row, ipHash })) }); }
      catch (e) { items.push({ row: row.row, ok: false, error: e.message }); }
    }
    const good = items.filter((i) => i.ok);
    if (good.length) ctx.waitUntil(notify(env, `${good.length} new project${good.length === 1 ? "" : "s"} from an Excel upload (${[...new Set(good.map((g) => g.lead))].join(", ")})`,
      good.map((g) => `- ${g.ref}: ${g.name}`).join("\n") + `\n\nReview them here: ${adminUrl}`));
    return json({ ok: true, items: items.map(({ row, ok, id, token, ref, error }) => ({ row, ok, id, token, ref, error })) });
  }

  if (url.pathname === "/api/photos" && req.method === "POST") {
    const body = await readJson(req);
    if (await rateLimited(env, `photo:${ipHash}`, 30, 3600)) throw new HttpError(429, "Too many uploads. Please try again in an hour.");
    const sub = await one(env, "SELECT id, token, status FROM submissions WHERE id=?", str(body.id, 64));
    if (!sub || !safeEqual(sub.token, body.token || "")) throw new HttpError(404, "Submission not found.");
    if (sub.status !== "pending") throw new HttpError(409, "This project has already been reviewed. Please email the photos to the Durable Solutions Unit.");
    const have = (await one(env, "SELECT count(*) AS n FROM files WHERE owner=? AND kind='photo'", sub.id)).n;
    const add = (body.photos || []).slice(0, Math.max(0, MAX_PHOTOS - have));
    for (const ph of add) await saveImage(env, sub.id, "photo", ph);
    if (body.logo) await saveImage(env, sub.id, "logo", body.logo);
    return json({ ok: true, photos: have + add.length });
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    const pairs = String(url.searchParams.get("items") || "").split(",").slice(0, 100).map((x) => x.split(":"));
    const out = {};
    for (const [id, token] of pairs) {
      if (!id || !token) continue;
      const s = await one(env, "SELECT id, token, status, ref, (SELECT count(*) FROM files f WHERE f.owner=submissions.id AND f.kind='photo') AS photos FROM submissions WHERE id=?", id);
      if (s && safeEqual(s.token, token)) out[id] = { status: s.status, ref: s.ref, photos: s.photos };
      else if (!out[id]) out[id] = { status: "unknown" };
    }
    return json({ ok: true, items: out });
  }

  throw new HttpError(404, "Not found.");
}

/* ---------------- sign-in with an emailed code ---------------- */
// Only approved emails can sign in: the owners in ADMIN_EMAILS (set in wrangler.toml) and the
// people a DSU admin adds on the "Approved editors" page. Removing someone ends their session at once.
// Roles: "admin" (DSU, all projects, publishes), "agency" (one agency's projects; changes go to the review queue)
// and "viewer" (early access to the theme pages, such as Women and girls; no access to projects or the Manage pages).
// "pages" lists the theme pages a person may open: the owners and viewers only, for now.
const SESSION_HOURS = 24;
const CODE_MINUTES = 10;
const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 160);
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const owners = (env) => String(env.ADMIN_EMAILS || "").split(",").map(normEmail).filter(Boolean);
const contact = (env) => env.CONTACT_EMAIL || "dswg.sd@undp.org";
const toB64url = (b64) => b64.replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
const fromB64url = (s) => s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);

async function sessionSecret(env) { return setting(env, "session_secret", () => uid() + uid()); }
const ownerName = async (env, email) => (await setting(env, `name:${email}`)) || String(env.ADMIN_NAMES || "").split(",").map((x) => x.trim())[owners(env).indexOf(email)] || "";
async function approved(env, email) {
  if (!email) return null;
  if (owners(env).includes(email)) return { email, name: await ownerName(env, email), role: "admin", agency: null, owner: true, pages: ["women"] };
  const r = await one(env, "SELECT email, name, role, agency FROM editors WHERE email=?", email);
  if (!r) return null;
  const role = r.role === "agency" && r.agency ? "agency" : r.role === "viewer" ? "viewer" : "admin";
  return { email: r.email, name: r.name || "", role, agency: role === "agency" ? r.agency : null, owner: false, pages: role === "viewer" ? ["women"] : [] };
}
const nameOf = async (env, email) => (email ? (await approved(env, email))?.name || "" : "");
async function makeToken(env, email) {
  const exp = Date.now() + SESSION_HOURS * 3600e3;
  const body = toB64url(bytesToB64(enc.encode(JSON.stringify({ e: email, x: exp }))));
  return { token: `${body}.${await hmac(await sessionSecret(env), `s.${body}`)}`, expires: exp };
}
async function signedIn(env, req) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+([\w-]+)\.([\w-]+)$/);
  if (!m) return null;
  if (!safeEqual(m[2], await hmac(await sessionSecret(env), `s.${m[1]}`))) return null;
  const p = parse(new TextDecoder().decode(b64ToBytes(fromB64url(m[1]))), {});
  if (!p.e || !(Number(p.x) > Date.now())) return null;
  return approved(env, p.e);
}
async function sendMail(env, to, subject, textBody, html) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, `Sign-in emails are not set up yet. Please contact the DSWG at ${contact(env)}.`);
  const r = await fetch(`${env.RESEND_API || "https://api.resend.com"}/emails`, {
    method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM || "Durable Solutions Hub <no-reply@durablesolutionshub.org>", to: [to], subject, text: textBody, html }),
  });
  if (!r.ok) {
    console.error("email not sent", r.status, (await r.text().catch(() => "")).slice(0, 300));
    throw new HttpError(502, "The sign-in email could not be sent. Please try again in a few minutes.");
  }
}
function codeEmail(code) {
  const text = `Your sign-in code for the Durable Solutions Hub is ${code}\n\nIt works for ${CODE_MINUTES} minutes. If you did not ask for this code, you can ignore this email.\n\nDurable Solutions Hub | Sudan`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1c2230;max-width:480px">
    <p style="margin:0 0 6px;color:#1d5fae;font-size:12px;font-weight:bold;letter-spacing:.04em">DURABLE SOLUTIONS HUB | SUDAN</p>
    <p>Your sign-in code is:</p>
    <p style="font-size:30px;font-weight:bold;letter-spacing:8px;margin:8px 0 14px">${code}</p>
    <p>It works for ${CODE_MINUTES} minutes. If you did not ask for this code, you can ignore this email.</p></div>`;
  return { subject: `${code} is your Durable Solutions Hub sign-in code`, text, html };
}

async function authApi(req, env, url, ipHash) {
  if (url.pathname === "/api/auth/start" && req.method === "POST") {
    const body = await readJson(req, 5000);
    const email = normEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "Please enter a valid email address.");
    if (await rateLimited(env, `auth-ip:${ipHash}`, 20, 900)) throw new HttpError(429, "Too many attempts. Please wait 15 minutes and try again.");
    if (await rateLimited(env, `auth-mail:${(await sha256(email)).slice(0, 24)}`, 5, 900)) throw new HttpError(429, "Too many codes asked for this email. Please wait 15 minutes and try again.");
    if (!(await approved(env, email))) {
      return json({ ok: false, code: "not_approved", error: `This email is not on the approved list. Please contact the DSWG at ${contact(env)}, or your agency focal point, to be added.` }, 403);
    }
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    await run(env, `INSERT INTO signin_codes(email,code_hash,expires,attempts,sent_at) VALUES(?,?,?,0,?)
      ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires, attempts=0, sent_at=excluded.sent_at`,
      email, await sha256(`${email}|${code}|${await sessionSecret(env)}`), Date.now() + CODE_MINUTES * 60e3, Date.now());
    const m = codeEmail(code);
    await sendMail(env, email, m.subject, m.text, m.html);
    return json({ ok: true, minutes: CODE_MINUTES, ...(env.DEV_SHOW_CODE === "1" ? { devCode: code } : {}) });
  }
  if (url.pathname === "/api/auth/verify" && req.method === "POST") {
    const body = await readJson(req, 5000);
    const email = normEmail(body.email), code = String(body.code || "").replace(/\D/g, "");
    if (await rateLimited(env, `verify-ip:${ipHash}`, 40, 900)) throw new HttpError(429, "Too many attempts. Please wait 15 minutes and try again.");
    const row = await one(env, "SELECT * FROM signin_codes WHERE email=?", email);
    if (!row || row.expires < Date.now()) throw new HttpError(400, "This code has expired or has already been used. Please ask for a new code.");
    if (row.attempts >= 5) {
      await run(env, "DELETE FROM signin_codes WHERE email=?", email);
      throw new HttpError(400, "Too many wrong codes. Please ask for a new code.");
    }
    if (!safeEqual(row.code_hash, await sha256(`${email}|${code}|${await sessionSecret(env)}`))) {
      await run(env, "UPDATE signin_codes SET attempts=attempts+1 WHERE email=?", email);
      throw new HttpError(400, "That code is not right. Please check the email and try again.");
    }
    await run(env, "DELETE FROM signin_codes WHERE email=?", email);
    const who = await approved(env, email);
    if (!who) throw new HttpError(403, `This email is not on the approved list. Please contact the DSWG at ${contact(env)}.`);
    await run(env, "UPDATE editors SET last_signin=? WHERE email=?", nowIso(), email);
    if (who.owner) await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", `signin:${email}`, nowIso());
    const t = await makeToken(env, email);
    return json({ ok: true, token: t.token, expires: t.expires, email, name: who.name, role: who.role, agency: who.agency, owner: who.owner, pages: who.pages });
  }
  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const who = await signedIn(env, req);
    if (!who) throw new HttpError(401, "Please sign in.");
    return json({ ok: true, ...who });
  }
  return null;
}

async function seed(env) {
  // Safe to run more than once: projects already in the database are left as they are
  const data = parse(await readRepoFile(env, "data/projects.json"), { projects: [] });
  const refs = parse(await readRepoFile(env, "data/project-refs.json"), {});
  const logos = parse(await readRepoFile(env, "data/logos.json"), {});
  const t = nowIso();
  const stmts = [];
  const known = new Set((await all(env, "SELECT id FROM projects")).map((r) => r.id));
  const fresh = (data.projects || []).filter((p) => !known.has(p.id));
  for (const p of fresh) {
    const { id, ref, ...rest } = p;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO projects(id,ref,lead,name,data,private,published,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)")
      .bind(id, ref || refs[id] || null, rest.lead || null, rest.name || null, JSON.stringify(rest), "{}", t, t));
  }
  const max = {};
  Object.values(refs).concat((data.projects || []).map((p) => p.ref)).filter(Boolean).forEach((r) => {
    const m = String(r).match(/^(.*)-(\d+)$/);
    if (m) max[m[1]] = Math.max(max[m[1]] || 0, Number(m[2]));
  });
  const serials = Object.values(refs).concat((data.projects || []).map((p) => p.ref)).map(serialOf).filter(Boolean);
  if (serials.length) stmts.push(env.DB.prepare("INSERT INTO refs(prefix,last) VALUES('_serial',?) ON CONFLICT(prefix) DO UPDATE SET last=max(last,excluded.last)").bind(Math.max(...serials)));
  Object.entries(max).forEach(([k, v]) => stmts.push(env.DB.prepare("INSERT INTO refs(prefix,last) VALUES(?,?) ON CONFLICT(prefix) DO UPDATE SET last=max(last,excluded.last)").bind(k, v)));
  Object.entries(logos).forEach(([k, l]) => stmts.push(env.DB.prepare("INSERT OR IGNORE INTO logos(acronym,name,full,mark,updated_at) VALUES(?,?,?,?,?)").bind(k, l.name || k, l.full, l.mark, t)));
  if (stmts.length) await env.DB.batch(stmts);
  await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES('imported',?)", nowIso());
  await addLog(env, "import", `Imported ${fresh.length} projects from the website`);
  return { imported: fresh.length };
}

async function subDetail(env, s, fileUrl) {
  const files = await all(env, "SELECT id, kind, name, size FROM files WHERE owner=? ORDER BY created_at", s.id);
  const current = s.target_id ? await one(env, "SELECT id, ref, data FROM projects WHERE id=?", s.target_id) : null;
  return {
    id: s.id, kind: s.kind, ref: s.ref, source: s.source, row: s.row_no, status: s.status, receivedAt: s.received_at,
    reviewedAt: s.reviewed_at, note: s.note, targetId: s.target_id, by: s.submitted_by || null, byName: await nameOf(env, s.submitted_by),
    data: parse(s.data, {}), private: parse(s.private, {}),
    photos: await Promise.all(files.filter((f) => f.kind === "photo").map(async (f) => ({ file: f.id, url: await fileUrl(f.id), name: f.name, size: f.size }))),
    logo: (await Promise.all(files.filter((f) => f.kind === "logo").map(async (f) => ({ file: f.id, url: await fileUrl(f.id), name: f.name }))))[0] || null,
    current: current ? { id: current.id, ref: current.ref, data: parse(current.data, {}) } : null,
    checks: await computeChecks(env, s),
  };
}

// The stories already on the website are copied into the database the first time the Stories page is opened
async function ensureStories(env) {
  if (await setting(env, "stories_imported")) return;
  const cur = parse(await readRepoFile(env, "data/stories.json"), { items: [] });
  const t = nowIso();
  const stmts = (cur.items || []).map((x) => env.DB.prepare("INSERT OR IGNORE INTO stories(id,topic,title,url,org,date,place,summary,quote,quote_by,sort,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(str(x.id, 80) || uid(), x.topic || "women", str(x.title, 200), str(x.url, 600), str(x.org, 120), x.date || null, str(x.place, 120), str(x.summary, 450), str(x.quote, 220), str(x.quoteBy, 120), Number(x.sort) || 0, null, t, t));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('stories_imported',?)").bind(t));
  await env.DB.batch(stmts);
}
async function storiesFile(env) {
  const rows = await all(env, "SELECT * FROM stories ORDER BY topic, sort, date DESC");
  const items = rows.map((r) => ({ id: r.id, topic: r.topic, title: r.title, url: r.url, org: r.org || "", date: r.date || "", place: r.place || "", summary: r.summary || "", quote: r.quote || "", quoteBy: r.quote_by || "", sort: r.sort || 0,
    ...(r.photo ? { photo: r.photo, photoCredit: r.photo_credit || "", photoAlt: r.photo_alt || "" } : {}) }));
  return { path: "data/stories.json", text: JSON.stringify({ updated: todayKhartoum(), items }, null, 1) };
}

const roleDesc = (f) => (f.role === "agency" ? `${f.agency} admin` : f.role === "viewer" ? "early access to the Women and girls page" : "DSU admin");

async function adminApi(req, env, ctx, url) {
  const path = url.pathname.replace(/^\/admin\/api/, "");
  const ip = clientIp(req);

  let m;
  // Photos waiting for review are shown with a signed link, so they also load in an <img> tag
  if ((m = path.match(/^\/file\/([a-f0-9]+)$/)) && req.method === "GET") {
    const k = url.searchParams.get("k") || "";
    if (!safeEqual(k, await hmac(await sessionSecret(env), `f.${m[1]}`))) throw new HttpError(404, "File not found.");
    const f = await one(env, "SELECT mime, data FROM files WHERE id=?", m[1]);
    if (!f) throw new HttpError(404, "File not found.");
    return new Response(b64ToBytes(String(f.data)), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  }

  const who = await signedIn(env, req);
  if (!who) throw new HttpError(401, "Please sign in.");
  const by = who.email;
  await ensureImported(env);
  if (req.method !== "GET" && req.headers.get("X-SF-Admin") !== "1") throw new HttpError(403, "Request refused.");
  const fileUrl = async (id) => `${url.origin}/admin/api/file/${id}?k=${await hmac(await sessionSecret(env), `f.${id}`)}`;
  if (who.role === "agency") return agencyApi(req, env, ctx, url, path, who, fileUrl);
  if (who.role !== "admin") throw new HttpError(403, "Only DSU admins and agency admins can use these pages.");

  if (path === "/me") {
    const counts = {};
    (await all(env, "SELECT status, count(*) AS n FROM submissions GROUP BY status")).forEach((r) => (counts[r.status] = r.n));
    const proj = await one(env, "SELECT count(*) AS n, sum(published) AS pub FROM projects");
    const oldest = await one(env, "SELECT min(received_at) AS t FROM submissions WHERE status='pending'");
    return json({ ok: true, counts, projects: proj.n || 0, published: proj.pub || 0, oldestPending: oldest?.t || null, imported: !!(await setting(env, "imported")),
      setup: { github: !!env.GITHUB_TOKEN, inbox: !!env.INBOX_REPO, turnstile: !!env.TURNSTILE_SECRET, email: !!env.RESEND_API_KEY, mirror: env.MIRROR_REPO || null, mirrorStatus: await setting(env, "mirror_status") }, siteUrl: env.SITE_URL, me: who });
  }
  if (path === "/setup" && req.method === "POST") return json({ ok: true, ...(await seed(env)) });
  if (path === "/mirror-sync" && req.method === "POST") {
    if (!mirror(env)) throw new HttpError(400, "No second site is set up.");
    await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES('mirror_status','sync')");
    await mirrorFiles(env, [], "Copy the hub data, photos and logos");
    const st = await setting(env, "mirror_status");
    if (st !== "ok") throw new HttpError(502, `The git page could not be updated: ${st.replace(/^\S+\s/, "")}`);
    await addLog(env, "git page copied", "All data, photos and logos copied from the hub to the git page", null, by);
    return json({ ok: true });
  }

  if (path === "/queue") {
    const status = ["pending", "published", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
    const rows = await all(env, `SELECT * FROM submissions WHERE status=? ORDER BY ${status === "pending" ? "received_at ASC" : "reviewed_at DESC"} LIMIT 300`, status);
    const items = [];
    for (const s of rows) {
      const photos = (await one(env, "SELECT count(*) AS n FROM files WHERE owner=? AND kind='photo'", s.id)).n;
      items.push({ id: s.id, ref: s.ref, kind: s.kind, name: s.name, lead: s.lead, source: s.source, row: s.row_no, receivedAt: s.received_at, reviewedAt: s.reviewed_at, photos,
        by: s.submitted_by || null, byName: await nameOf(env, s.submitted_by), checks: status === "pending" ? await computeChecks(env, s) : [] });
    }
    return json({ ok: true, items });
  }

  if ((m = path.match(/^\/submission\/([a-f0-9]+)$/))) {
    const s = await one(env, "SELECT * FROM submissions WHERE id=?", m[1]);
    if (!s) throw new HttpError(404, "Submission not found.");
    if (req.method === "GET") return json({ ok: true, item: await subDetail(env, s, fileUrl) });
    if (req.method === "PUT") {
      const body = await readJson(req);
      const p = cleanProject(body.data || {});
      if (body.data?.leadName) p.leadName = str(body.data.leadName, 200);
      await run(env, "UPDATE submissions SET data=?, private=?, note=?, lead=?, name=? WHERE id=?", JSON.stringify(p), JSON.stringify(body.private || {}), text(body.note, 2000), p.lead, p.name, s.id);
      await syncFiles(env, s.id, body.photos);
      return json({ ok: true, item: await subDetail(env, await one(env, "SELECT * FROM submissions WHERE id=?", s.id), fileUrl) });
    }
  }
  if ((m = path.match(/^\/submission\/([a-f0-9]+)\/(publish|reject|reopen)$/)) && req.method === "POST") {
    const s = await one(env, "SELECT * FROM submissions WHERE id=?", m[1]);
    if (!s) throw new HttpError(404, "Submission not found.");
    const body = await readJson(req);
    if (m[2] === "reject") {
      await run(env, "UPDATE submissions SET status='rejected', reviewed_at=?, note=? WHERE id=?", nowIso(), text(body.note, 2000), s.id);
      await run(env, "DELETE FROM files WHERE owner=?", s.id);
      await addLog(env, "not published", `${s.ref}: ${s.name}. Sent ${s.submitted_by ? `by ${await nameOf(env, s.submitted_by) || s.submitted_by}` : s.source === "excel" ? "from an Excel upload" : "from the form"} on ${khartoumTime(s.received_at)}${body.note ? `. Note: ${text(body.note, 300)}` : ""}`, null, by, s.target_id);
      return json({ ok: true });
    }
    if (m[2] === "reopen") {
      await run(env, "UPDATE submissions SET status='pending', reviewed_at=NULL WHERE id=?", s.id);
      return json({ ok: true });
    }
    if (s.status !== "pending") throw new HttpError(409, "This submission has already been reviewed.");
    const data = body.data || parse(s.data, {});
    const target = body.asUpdateOf || s.target_id || null;
    const cur = target ? await one(env, "SELECT * FROM projects WHERE id=?", target) : null;
    const before = cur ? parse(cur.data, {}).photos || [] : [];
    let photos = body.photosFinal || [...before.map((p) => ({ path: p })), ...(body.photos || []).filter((x) => x.file)];
    // a new submission treated as an update of a published project keeps that project's photos
    if (cur && !s.target_id && body.photosFinal) photos = [...before.map((p) => ({ path: p })), ...photos.filter((x) => x.file)];
    const logoFile = (await one(env, "SELECT id FROM files WHERE owner=? AND kind='logo'", s.id))?.id;
    const r = await publishProject(env, {
      id: cur?.id, ref: cur?.ref || s.ref, data, priv: (({ _photosKeep, ...rest }) => rest)({ ...parse(cur?.private, {}), ...(body.private || parse(s.private, {})) }),
      photos, logo: logoFile, logoName: data.leadName ? String(data.leadName).replace(/^[^,]*,\s*/, "") : null,
      message: `${cur ? "Update" : "Publish"} ${cur?.ref || s.ref}: ${str(data.name, 80)}`,
    });
    await run(env, "UPDATE submissions SET status='published', reviewed_at=?, data=?, note=?, ref=? WHERE id=?", nowIso(), JSON.stringify(r.project), text(body.note, 2000), r.ref, s.id);
    await run(env, "DELETE FROM files WHERE owner=?", s.id);
    const sentWhen = khartoumTime(s.received_at);
    await addLog(env, cur ? "updated" : "published", `${r.ref}: ${r.project.name}. Sent ${s.submitted_by ? `by ${await nameOf(env, s.submitted_by) || s.submitted_by}` : s.source === "excel" ? "from an Excel upload" : "from the form"} on ${sentWhen}, approved by ${who.name || by}`, r.sha, by, r.id, r.changes);
    return json({ ok: true, ref: r.ref, id: r.id, commit: r.sha });
  }

  if (path === "/projects") {
    const rows = await all(env, "SELECT id, ref, lead, name, published, updated_at, data FROM projects ORDER BY lead, name");
    return json({ ok: true, items: rows.map((r) => { const d = parse(r.data, {}); return { id: r.id, ref: r.ref, lead: r.lead, name: r.name, published: !!r.published, updatedAt: r.updated_at, states: d.nationwide ? ["Nationwide"] : d.states || [], start: d.start, end: d.end, budget: d.budget, people: d.people?.total ?? null }; }) });
  }
  if ((m = path.match(/^\/project\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1]);
    if (req.method === "GET") {
      const r = await one(env, "SELECT * FROM projects WHERE id=?", id);
      if (!r) throw new HttpError(404, "Project not found.");
      const files = await all(env, "SELECT id, name, size FROM files WHERE owner=? AND kind='photo' ORDER BY created_at", `project:${id}`);
      const data = parse(r.data, {});
      return json({ ok: true, item: { id: r.id, ref: r.ref, published: !!r.published, data, private: parse(r.private, {}), updatedAt: r.updated_at,
        photos: [...(data.photos || []).map((p) => ({ path: p, url: `${env.SITE_URL}${p}` })), ...(await Promise.all(files.map(async (f) => ({ file: f.id, url: await fileUrl(f.id), name: f.name }))))] } });
    }
    if (req.method === "PUT") {
      const body = await readJson(req);
      const isNew = id === "new";
      const r = await publishProject(env, {
        id: isNew ? null : id, ref: null, data: body.data || {}, priv: body.private || {}, photos: body.photos || [],
        published: body.published === false ? 0 : 1, message: body.message || null,
      });
      await run(env, "DELETE FROM files WHERE owner=?", `project:${id}`);
      await addLog(env, isNew ? "added" : body.published === false ? "hidden" : "edited", `${r.ref}: ${r.project.name}`, r.sha, by, r.id, r.changes);
      return json({ ok: true, id: r.id, ref: r.ref, commit: r.sha });
    }
    if (req.method === "DELETE") {
      const r = await one(env, "SELECT * FROM projects WHERE id=?", id);
      if (!r) throw new HttpError(404, "Project not found.");
      const photos = parse(r.data, {}).photos || [];
      await run(env, "DELETE FROM projects WHERE id=?", id);
      const sha = await commitFiles(env, [...photos.map((p) => ({ path: p, remove: true })), ...(await siteFiles(env))], `Remove ${r.ref}: ${r.name}`);
      await addLog(env, "deleted", `${r.ref}: ${r.name}`, sha, by, id);
      return json({ ok: true, commit: sha });
    }
  }

  // Uploads made in the admin pages (photos for a project or submission, logos)
  if (path === "/file" && req.method === "POST") {
    const body = await readJson(req);
    const owner = /^((project|story):[\w-]+|[a-f0-9]{32})$/.test(body.owner || "") ? body.owner : null;
    if (!owner) throw new HttpError(400, "Unknown owner.");
    const id = await saveImage(env, owner, body.kind === "logo" ? "logo" : "photo", body.image);
    return json({ ok: true, file: id, url: await fileUrl(id) });
  }
  if ((m = path.match(/^\/file\/([a-f0-9]+)$/)) && req.method === "DELETE") { await run(env, "DELETE FROM files WHERE id=?", m[1]); return json({ ok: true }); }

  if (path === "/orgs") {
    const logos = await all(env, "SELECT * FROM logos ORDER BY acronym");
    const leads = await all(env, "SELECT lead, count(*) AS n, sum(published) AS pub FROM projects GROUP BY lead ORDER BY lead");
    return json({ ok: true, logos: logos.map((l) => ({ ...l, fullUrl: `${env.SITE_URL}${l.full}`, markUrl: `${env.SITE_URL}${l.mark}` })), leads });
  }
  if (path === "/logo" && req.method === "POST") {
    const body = await readJson(req);
    const acronym = str(body.acronym, 40);
    if (!acronym) throw new HttpError(400, "Acronym missing.");
    const fileId = await saveImage(env, `project:logo`, "logo", body.image);
    const files = await logoChanges(env, acronym, str(body.name, 200), fileId);
    const sha = await commitFiles(env, [...files, ...(await siteFiles(env))], `Logo for ${acronym}`);
    await addLog(env, "logo", acronym, sha, by);
    return json({ ok: true, commit: sha });
  }
  // Stories highlighted on the theme pages (women and girls; persons with disabilities). Published as data/stories.json.
  if (path === "/stories" && req.method === "GET") {
    await ensureStories(env);
    const items = await all(env, "SELECT * FROM stories ORDER BY topic, sort, date DESC");
    return json({ ok: true, items: items.map((i) => ({ ...i, photoUrl: i.photo ? `${env.SITE_URL}${i.photo}` : null })) });
  }
  if ((path === "/stories" && req.method === "POST") || ((m = path.match(/^\/stories\/([\w-]+)$/)) && (req.method === "PUT" || req.method === "DELETE"))) {
    await ensureStories(env);
    const id = m ? m[1] : null;
    if (id && !(await one(env, "SELECT id FROM stories WHERE id=?", id))) throw new HttpError(404, "Story not found.");
    let what;
    const photoFiles = [], usedFiles = [];
    if (req.method === "DELETE") {
      const s0 = await one(env, "SELECT title, photo FROM stories WHERE id=?", id);
      await run(env, "DELETE FROM stories WHERE id=?", id);
      if (s0.photo) photoFiles.push({ path: s0.photo, remove: true });
      what = ["story removed", s0.title];
    } else {
      const b = await readJson(req, 20000);
      const st = {
        topic: ["women", "disability"].includes(b.topic) ? b.topic : "women", title: str(b.title, 200), url: str(b.url, 600), org: str(b.org, 120),
        date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : null, place: str(b.place, 120), summary: str(b.summary, 450),
        quote: str(b.quote, 220), quote_by: str(b.quoteBy, 120), sort: Math.max(0, Math.min(999, Number(b.sort) || 0)),
      };
      if (!st.title) throw new HttpError(400, "The title is missing.");
      if (!/^https:\/\/[^\s]+$/.test(st.url)) throw new HttpError(400, "The link must start with https://");
      // Photo: a new upload (photoFile), removed (photoRemove), or kept as it is. A photo always needs a credit.
      const sid = id || `${slug(st.title).slice(0, 40)}-${uid().slice(0, 6)}`;
      const before = id ? (await one(env, "SELECT photo FROM stories WHERE id=?", id)).photo : null;
      let photo = before;
      if (b.photoFile) {
        const f = await one(env, "SELECT id, mime, data FROM files WHERE id=?", String(b.photoFile));
        if (!f) throw new HttpError(400, "The photo was not found. Please add it again.");
        photo = `assets/img/stories/${sid}-${uid().slice(0, 4)}.${IMAGE_TYPES[f.mime] || "jpg"}`;
        photoFiles.push({ path: photo, b64: String(f.data) }); usedFiles.push(f.id);
      } else if (b.photoRemove) photo = null;
      if (before && before !== photo) photoFiles.push({ path: before, remove: true });
      st.photo = photo; st.photo_credit = photo ? str(b.photoCredit, 160) : null; st.photo_alt = photo ? str(b.photoAlt, 200) : null;
      if (photo && !st.photo_credit) throw new HttpError(400, "Please add the photo credit, for example: UNFPA Sudan / name of the photographer.");
      if (id) {
        await run(env, "UPDATE stories SET topic=?, title=?, url=?, org=?, date=?, place=?, summary=?, quote=?, quote_by=?, sort=?, photo=?, photo_credit=?, photo_alt=?, updated_at=? WHERE id=?",
          st.topic, st.title, st.url, st.org, st.date, st.place, st.summary, st.quote, st.quote_by, st.sort, st.photo, st.photo_credit, st.photo_alt, nowIso(), id);
        what = ["story changed", st.title];
      } else {
        await run(env, "INSERT INTO stories(id,topic,title,url,org,date,place,summary,quote,quote_by,sort,photo,photo_credit,photo_alt,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          sid, st.topic, st.title, st.url, st.org, st.date, st.place, st.summary, st.quote, st.quote_by, st.sort, st.photo, st.photo_credit, st.photo_alt, by, nowIso(), nowIso());
        what = ["story added", st.title];
      }
    }
    const sha = await commitFiles(env, [await storiesFile(env), ...photoFiles], `Stories: ${what[0].replace("story ", "")} "${what[1].slice(0, 60)}"`);
    for (const fid of usedFiles) await run(env, "DELETE FROM files WHERE id=?", fid);
    await addLog(env, what[0], what[1], sha, by);
    return json({ ok: true, commit: sha });
  }

  // Approved editors: who can sign in. Owners (ADMIN_EMAILS) are fixed; the rest are added here by a DSU admin.
  if (path === "/editors" && req.method === "GET") {
    const rows = await all(env, "SELECT email, name, role, agency, added_by, added_at, last_signin FROM editors ORDER BY role, agency, email");
    const own = [];
    for (const e of owners(env)) own.push({ email: e, name: await ownerName(env, e), role: "admin", agency: null, owner: true, last_signin: await setting(env, `signin:${e}`) });
    const leads = (await all(env, "SELECT DISTINCT lead FROM projects WHERE lead IS NOT NULL ORDER BY lead")).map((r) => r.lead);
    return json({ ok: true, items: [...own, ...rows.filter((r) => !owners(env).includes(r.email)).map((r) => ({ ...r, owner: false }))], me: who.email, leads });
  }
  const editorFields = (body) => {
    const role = body.role === "agency" ? "agency" : body.role === "viewer" ? "viewer" : "admin";
    const agency = role === "agency" ? str(body.agency, 40) : null;
    if (role === "agency" && !agency) throw new HttpError(400, "Choose the agency this person can edit.");
    return { name: str(body.name, 120), role, agency };
  };
  if (path === "/editors" && req.method === "POST") {
    const body = await readJson(req, 5000);
    const email = normEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "Please enter a valid email address.");
    const f = editorFields(body);
    if (!f.name) throw new HttpError(400, "Please enter the person's name.");
    if (owners(env).includes(email) || (await one(env, "SELECT email FROM editors WHERE email=?", email))) throw new HttpError(409, "This email is already on the list.");
    await run(env, "INSERT INTO editors(email,name,role,agency,added_by,added_at) VALUES(?,?,?,?,?,?)", email, f.name, f.role, f.agency, by, nowIso());
    await addLog(env, "editor added", `${f.name} <${email}>, ${roleDesc(f)}`, null, by);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/editors\/(.+)$/)) && req.method === "PUT") {
    const email = normEmail(decodeURIComponent(m[1]));
    const body = await readJson(req, 5000);
    if (owners(env).includes(email)) {
      await run(env, "INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", `name:${email}`, str(body.name, 120));
      return json({ ok: true });
    }
    const f = editorFields(body);
    const r = await run(env, "UPDATE editors SET name=?, role=?, agency=? WHERE email=?", f.name, f.role, f.agency, email);
    if (!r.meta?.changes) throw new HttpError(404, "This email is not on the list.");
    await addLog(env, "editor changed", `${f.name} <${email}>, ${roleDesc(f)}`, null, by);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/editors\/(.+)$/)) && req.method === "DELETE") {
    const email = normEmail(decodeURIComponent(m[1]));
    if (owners(env).includes(email)) throw new HttpError(400, "This email is set as an owner and cannot be removed here.");
    await run(env, "DELETE FROM editors WHERE email=?", email);
    await run(env, "DELETE FROM signin_codes WHERE email=?", email);
    await addLog(env, "editor removed", email, null, by);
    return json({ ok: true });
  }
  if (path === "/log") {
    const project = url.searchParams.get("project");
    const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit")) || 500));
    const rows = project ? await all(env, "SELECT * FROM log WHERE project_id=? ORDER BY id DESC LIMIT ?", project, limit) : await all(env, "SELECT * FROM log ORDER BY id DESC LIMIT ?", limit);
    const names = {};
    for (const r of rows) if (r.by_email && !(r.by_email in names)) names[r.by_email] = await nameOf(env, r.by_email);
    return json({ ok: true, repo: env.GITHUB_REPO, items: rows.map((r) => ({ ...r, by_name: names[r.by_email] || "", changes: parse(r.changes, []) })) });
  }
  if (path === "/export") {
    const projects = (await all(env, "SELECT * FROM projects ORDER BY lead, name")).map((r) => ({ id: r.id, ref: r.ref, published: !!r.published, ...parse(r.data, {}), private: parse(r.private, {}) }));
    const submissions = (await all(env, "SELECT id, kind, target_id, ref, source, status, lead, name, data, private, note, received_at, reviewed_at FROM submissions ORDER BY received_at"))
      .map((s) => ({ ...s, data: parse(s.data, {}), private: parse(s.private, {}) }));
    return new Response(JSON.stringify({ exportedAt: nowIso(), projects, submissions }, null, 1), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="solutions-footprint-backup-${todayKhartoum()}.json"`, "Cache-Control": "no-store" },
    });
  }
  throw new HttpError(404, "Not found.");
}

/* ---------------- agency admins ----------------
   They see and edit only the projects their agency leads. Saving never publishes: it puts the change in the
   DSU review queue (as a correction, or as a new project), where only a DSU admin can publish it. */
async function agencyApi(req, env, ctx, url, path, who, fileUrl) {
  const agency = who.agency;
  const by = who.email;
  const owner = `agency:${(await sha256(by)).slice(0, 24)}`; // photos they upload before sending
  const mine = (lead) => String(lead || "").toLowerCase() === String(agency).toLowerCase();
  const pendingFor = (target) => one(env, "SELECT * FROM submissions WHERE status='pending' AND submitted_by=? AND target_id IS ? ORDER BY received_at DESC", by, target);
  let m;
  if (path === "/me") {
    const counts = { pending: (await one(env, "SELECT count(*) AS n FROM submissions WHERE status='pending' AND submitted_by=?", by)).n };
    return json({ ok: true, counts, me: who, siteUrl: env.SITE_URL, setup: {} });
  }
  if (path === "/projects") {
    const rows = await all(env, "SELECT id, ref, lead, name, published, updated_at, data FROM projects WHERE lower(lead)=lower(?) ORDER BY name", agency);
    const pend = new Set((await all(env, "SELECT target_id FROM submissions WHERE status='pending' AND submitted_by=?", by)).map((r) => r.target_id));
    return json({ ok: true, agency, items: rows.map((r) => { const d = parse(r.data, {}); return { id: r.id, ref: r.ref, lead: r.lead, name: r.name, published: !!r.published, updatedAt: r.updated_at, states: d.nationwide ? ["Nationwide"] : d.states || [], start: d.start, end: d.end, budget: d.budget, people: d.people?.total ?? null, pending: pend.has(r.id) }; }) });
  }
  if ((m = path.match(/^\/project\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1]);
    const isNew = id === "new";
    const r = isNew ? null : await one(env, "SELECT * FROM projects WHERE id=?", id);
    if (!isNew && (!r || !mine(r.lead))) throw new HttpError(404, "Project not found.");
    if (req.method === "GET") {
      const data = parse(r.data, {});
      const p = await pendingFor(r.id);
      return json({ ok: true, item: { id: r.id, ref: r.ref, published: !!r.published, data, private: parse(r.private, {}), updatedAt: r.updated_at,
        photos: (data.photos || []).map((x) => ({ path: x, url: `${env.SITE_URL}${x}` })),
        pending: p ? { at: p.received_at, data: parse(p.data, {}), private: parse(p.private, {}),
          photos: await Promise.all((await all(env, "SELECT id, name FROM files WHERE owner=? AND kind='photo' ORDER BY created_at", p.id)).map(async (f) => ({ file: f.id, url: await fileUrl(f.id), name: f.name }))) } : null } });
    }
    if (req.method === "PUT") {
      const body = await readJson(req);
      const p = cleanProject(body.data || {});
      p.lead = r ? r.lead : agency; // agencies cannot move a project to another lead
      const errs = checkAnswers(p);
      if (errs.length) throw new HttpError(400, errs.join("; "));
      const photos = Array.isArray(body.photos) ? body.photos : [];
      const keep = r ? photos.filter((x) => x.path && (parse(r.data, {}).photos || []).includes(x.path)).map((x) => x.path) : [];
      const was = r ? parse(r.private, {}) : {};
      const priv = { fpName: str(body.private?.fpName, 120) || was.fpName || "", fpEmail: str(body.private?.fpEmail, 160) || was.fpEmail || "", ...(r ? { _photosKeep: keep } : {}) };
      const prev = r ? await pendingFor(r.id) : null;
      const sid = prev ? prev.id : uid();
      if (prev) {
        await run(env, "UPDATE submissions SET data=?, private=?, name=?, received_at=? WHERE id=?", JSON.stringify(p), JSON.stringify(priv), p.name, nowIso(), sid);
      } else {
        const ref = r ? r.ref : await newCode(env, p);
        await run(env, `INSERT INTO submissions(id,token,kind,target_id,ref,source,status,lead,name,data,private,received_at,submitted_by)
          VALUES(?,?,?,?,?,'agency','pending',?,?,?,?,?,?)`, sid, uid(), r ? "correction" : "new", r ? r.id : null, ref, p.lead, p.name, JSON.stringify(p), JSON.stringify(priv), nowIso(), by);
      }
      // photos: new uploads move to the submission; photos removed in the editor are dropped
      const want = new Set(photos.filter((x) => x.file).map((x) => x.file).slice(0, MAX_PHOTOS));
      for (const f of await all(env, "SELECT id FROM files WHERE (owner=? OR owner=?) AND kind='photo'", owner, sid)) {
        if (want.has(f.id)) await run(env, "UPDATE files SET owner=? WHERE id=?", sid, f.id);
        else await run(env, "DELETE FROM files WHERE id=?", f.id);
      }
      const ref = (await one(env, "SELECT ref FROM submissions WHERE id=?", sid)).ref;
      await addLog(env, "sent for review", `${ref}: ${p.name} (${agency}, waiting for DSU review)`, null, by, r ? r.id : null,
        r ? diffFields(parse(r.data, {}), { ...p, photos: [...keep, ...[...want].map(() => "(new photo)")] }, parse(r.private, {}), priv) : []);
      ctx.waitUntil(notify(env, `${r ? "Change" : "New project"} ${ref} from ${who.name || by} (${agency})`, `${p.name}\n\nReview it here: ${env.SITE_URL || ""}manage.html#/review/${sid}`));
      return json({ ok: true, ref, status: "pending" });
    }
  }
  if (path === "/file" && req.method === "POST") {
    const body = await readJson(req);
    const have = (await one(env, "SELECT count(*) AS n FROM files WHERE owner=?", owner)).n;
    if (have >= 12) throw new HttpError(429, "Too many photos waiting. Please send your changes first.");
    const id = await saveImage(env, owner, "photo", body.image);
    return json({ ok: true, file: id, url: await fileUrl(id) });
  }
  if ((m = path.match(/^\/file\/([a-f0-9]+)$/)) && req.method === "DELETE") {
    await run(env, "DELETE FROM files WHERE id=? AND owner=?", m[1], owner);
    return json({ ok: true });
  }
  if (path === "/changes") {
    const rows = await all(env, "SELECT id, ref, kind, name, status, received_at, reviewed_at, target_id FROM submissions WHERE submitted_by=? ORDER BY received_at DESC LIMIT 200", by);
    return json({ ok: true, items: rows.map((r) => ({ ref: r.ref, kind: r.kind, name: r.name, status: r.status, receivedAt: r.received_at, reviewedAt: r.reviewed_at, targetId: r.target_id })) });
  }
  throw new HttpError(403, "This page is for DSU admins only.");
}

// Keep the uploaded files of a submission in line with the photos kept in the editor
async function syncFiles(env, owner, photos) {
  if (!Array.isArray(photos)) return;
  const keep = new Set(photos.filter((p) => p.file).map((p) => p.file));
  const have = await all(env, "SELECT id FROM files WHERE owner=? AND kind='photo'", owner);
  for (const f of have) if (!keep.has(f.id)) await run(env, "DELETE FROM files WHERE id=?", f.id);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/api/") ? corsHeaders(req, env) : {};
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      // The admin pages are part of the website now (manage.html); old links are sent there
      if (url.pathname === "/" || url.pathname === "" || url.pathname === "/admin" || url.pathname === "/admin/") {
        return Response.redirect(`${env.SITE_URL || ""}manage.html${url.hash || ""}`, 302);
      }
      await ensureSchema(env);
      let r;
      if (url.pathname.startsWith("/api/auth/")) {
        const ipHash = (await sha256(`${clientIp(req)}|${await setting(env, "salt", uid)}`)).slice(0, 16);
        r = await authApi(req, env, url, ipHash);
        if (!r) throw new HttpError(404, "Not found.");
      } else if (url.pathname.startsWith("/api/")) {
        if (req.method === "POST") await ensureImported(env);
        r = await publicApi(req, env, ctx, url);
      } else if (url.pathname.startsWith("/admin/api/")) {
        r = await adminApi(req, env, ctx, url);
      } else return new Response("Not found", { status: 404 });
      Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
      return r;
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return json({ ok: false, error: e.status ? e.message : "Something went wrong on the server. Please try again." }, status, cors);
    }
  },
};
