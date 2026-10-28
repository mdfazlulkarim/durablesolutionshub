/* Operational Presence: who is doing what, where (OCHA Sudan 3W), by state and locality.
   The data file (data/presence.enc.json) is encrypted: it opens only with the access code, which the
   person types in; the code is never stored in this repository. Built on the Solutions Footprint styles,
   state map (../mapping/data/geo.json) and helpers (../mapping/assets/js/common.js). */
"use strict";
(() => {
  const esc = SF.esc;
  const fmt = SF.fmtInt;
  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";
  const SEQ = ["#cfe0f5", "#a3c4ec", "#73a5e0", "#4485d2", "#1f5fa8"];
  const ADSWG = ["Aj Jazirah", "Blue Nile", "Gedaref", "Kassala", "White Nile"];
  const ABYEI = "Abyei PCA";
  const GEO_STATE = { Abyei: ABYEI }; // boundary names to the names used in the 3W
  const CODE_KEY = "op-code";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthName = (m, short) => { const [y, mm] = m.split("-"); const n = MONTHS[+mm - 1]; return short ? n.slice(0, 3) : `${n} ${y}`; };
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many || one + "s"}`;
  const TYPE_LABEL = { "UN Agency": "UN agencies", INGO: "International NGOs", NNGO: "National NGOs", "Red Cross": "Red Cross / Red Crescent", Other: "Other" };
  const TYPE_SHORT = { "UN Agency": ["UN agency", "UN agencies"], INGO: ["INGO", "INGOs"], NNGO: ["NNGO", "NNGOs"], "Red Cross": ["Red Cross / Red Crescent", "Red Cross / Red Crescent"], Other: ["other", "other"] };
  const ICON = {
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 4.9"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  };

  /* ================= access code ================= */
  const normCode = (c) => String(c || "").replace(/\s+/g, " ").trim().toLowerCase();
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let ENC = null;
  async function decrypt(code) {
    if (!window.crypto || !crypto.subtle) throw Object.assign(new Error("This browser cannot open the page. Please use an up-to-date browser."), { kind: "browser" });
    if (!ENC) {
      const r = await fetch("data/presence.enc.json", { cache: "no-cache" }).catch(() => null);
      if (!r || !r.ok) throw Object.assign(new Error("The page could not load its data. Please check your connection and try again."), { kind: "load" });
      ENC = await r.json();
    }
    const te = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", te.encode(normCode(code)), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(ENC.salt), iterations: ENC.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(ENC.iv), additionalData: te.encode(ENC.aad) }, key, b64(ENC.data));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) {
      throw Object.assign(new Error("That code does not work. Please check it and try again."), { kind: "code" });
    }
  }
  const store = {
    get() { try { return sessionStorage.getItem(CODE_KEY); } catch (e) { return null; } },
    set(v) { try { sessionStorage.setItem(CODE_KEY, v); } catch (e) { /* storage may be blocked */ } },
    clear() { try { sessionStorage.removeItem(CODE_KEY); } catch (e) { /* storage may be blocked */ } },
  };

  function initGate() {
    const form = $("gate-form"), input = $("gate-code"), go = $("gate-go"), err = $("gate-err"), show = $("gate-show");
    const busy = (on, label) => { go.disabled = on; go.textContent = on ? label || "Opening…" : "Open"; };
    const fail = (e) => { busy(false); err.textContent = e.message; err.hidden = false; input.select(); };
    show.addEventListener("click", () => {
      const on = input.type === "password";
      input.type = on ? "text" : "password";
      show.textContent = on ? "Hide" : "Show";
      show.setAttribute("aria-pressed", String(on));
      input.focus();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!normCode(input.value)) return fail(new Error("Please type the access code."));
      busy(true);
      try {
        const data = await decrypt(input.value);
        store.set(normCode(input.value));
        start(data);
      } catch (x) { fail(x); }
    });
    const saved = store.get();
    if (saved) {
      busy(true);
      decrypt(saved).then(start).catch(() => { store.clear(); busy(false); input.focus(); });
    } else input.focus();
  }

  /* ================= data ================= */
  let D, N, RM, RL, RC, RO, LOC_STATE, COUNTED, GEO, LGEO, AREAS, LOCS, LOC_BY_DATA, SFP = null;
  const S = { month: -1, clusters: new Set(), types: new Set(), org: -1, level: "states", zoom: null, sel: null, ds: false, q: "", sort: { key: "locs", dir: -1 }, showAll: false };

  function prepare(data) {
    D = data;
    const r = D.rows;
    N = r.length / 4;
    RM = new Uint16Array(N); RL = new Uint16Array(N); RC = new Uint16Array(N); RO = new Uint16Array(N);
    for (let i = 0; i < N; i++) { RM[i] = r[4 * i]; RL[i] = r[4 * i + 1]; RC[i] = r[4 * i + 2]; RO[i] = r[4 * i + 3]; }
    LOC_STATE = D.locs.map((l) => D.states[l[1]]);
    COUNTED = D.orgs.map((o) => !o[3]);

    // areas on the state map: 18 states and the Abyei PCA area
    AREAS = {};
    GEO.states.forEach((s) => { AREAS[s.name] = { name: s.name, path: s.path, x: s.x, y: s.y, bbox: s.bbox }; });
    if (GEO.abyei) AREAS[ABYEI] = { name: ABYEI, path: GEO.abyei.path, x: GEO.abyei.x, y: GEO.abyei.y, bbox: GEO.abyei.bbox, abyei: true };
    // localities: every boundary, joined to the 3W by name, plus 3W localities without a boundary
    const dataIdx = {};
    D.locs.forEach((l, i) => { dataIdx[`${LOC_STATE[i]}|${l[0]}`] = i; });
    LOCS = LGEO.localities.map((g) => {
      const state = GEO_STATE[g.state] || g.state;
      const di = dataIdx[`${state}|${g.key}`];
      return { key: g.key, name: g.key, state, path: g.path, x: g.x, y: g.y, bbox: g.bbox, di: di == null ? -1 : di };
    });
    LOC_BY_DATA = {};
    LOCS.forEach((l, i) => { if (l.di >= 0) LOC_BY_DATA[l.di] = i; });
    D.locs.forEach((l, i) => { if (LOC_BY_DATA[i] == null) LOCS.push({ key: l[0], name: l[0], state: LOC_STATE[i], path: null, di: i }); });
  }

  /* rows that pass the filters; "except" leaves one filter out (for counts next to the options) */
  function passes(i, except) {
    if (except !== "month" && S.month >= 0 && RM[i] !== S.month) return false;
    if (except !== "clusters" && S.clusters.size && !S.clusters.has(RC[i])) return false;
    if (except !== "types" && S.types.size && !S.types.has(D.orgs[RO[i]][2])) return false;
    if (except !== "org" && S.org >= 0 && RO[i] !== S.org) return false;
    return true;
  }
  const inArea = (i, area) => {
    if (!area) return true;
    if (area.kind === "state") return LOC_STATE[RL[i]] === area.name;
    return RL[i] === area.di;
  };
  function rowsWhere(except, area) {
    const out = [];
    for (let i = 0; i < N; i++) if (passes(i, except) && inArea(i, area)) out.push(i);
    return out;
  }
  const orgSet = (rows) => { const s = new Set(); rows.forEach((i) => { if (COUNTED[RO[i]]) s.add(RO[i]); }); return s; };

  function perArea(rows) {
    const st = {}, lc = {};
    rows.forEach((i) => {
      const o = RO[i];
      if (!COUNTED[o]) return;
      const sn = LOC_STATE[RL[i]];
      (st[sn] = st[sn] || new Set()).add(o);
      (lc[RL[i]] = lc[RL[i]] || new Set()).add(o);
    });
    return { st, lc };
  }

  /* ================= filters ================= */
  function buildFilters() {
    const m = $("f-month");
    m.innerHTML = `<option value="-1">${esc(`${monthName(D.months[0]).split(" ")[0]} to ${monthName(D.months[D.months.length - 1])}`)} (all)</option>` +
      D.months.map((x, i) => `<option value="${i}">${esc(monthName(x))}</option>`).join("");
    m.addEventListener("change", () => { S.month = +m.value; render(); });

    const o = $("f-org");
    const order = D.orgs.map((x, i) => i).sort((a, b) => (D.orgs[a][1] || D.orgs[a][0]).localeCompare(D.orgs[b][1] || D.orgs[b][0]));
    o.innerHTML = `<option value="-1">All organisations</option>` +
      order.map((i) => { const x = D.orgs[i]; return `<option value="${i}">${esc(x[1] ? `${x[1]}: ${x[0]}` : x[0])}</option>`; }).join("");
    o.addEventListener("change", () => { S.org = +o.value; render(); });

    const opt = (group, i, label) => `<label class="opt no-sw"><input type="checkbox" data-g="${group}" value="${i}"><span>${esc(label)}</span><span class="num" data-n="${group}-${i}"></span></label>`;
    $("f-clusters").innerHTML = D.clusters.map((c, i) => opt("clusters", i, c)).join("");
    $("f-types").innerHTML = D.types.map((t, i) => opt("types", i, TYPE_LABEL[t] || t)).join("");
    document.querySelectorAll(".filters input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
      const set = S[cb.dataset.g];
      cb.checked ? set.add(+cb.value) : set.delete(+cb.value);
      render();
    }));
    $("clear-all").addEventListener("click", clearAll);
  }
  function clearAll() {
    S.month = -1; S.org = -1; S.clusters.clear(); S.types.clear();
    $("f-month").value = "-1"; $("f-org").value = "-1";
    document.querySelectorAll(".filters input[type=checkbox]").forEach((cb) => { cb.checked = false; });
    render();
  }
  function updateCounts() {
    const area = selArea();
    ["clusters", "types"].forEach((g) => {
      const counts = {};
      for (let i = 0; i < N; i++) {
        if (!passes(i, g) || !inArea(i, area) || !COUNTED[RO[i]]) continue;
        const k = g === "clusters" ? RC[i] : D.orgs[RO[i]][2];
        (counts[k] = counts[k] || new Set()).add(RO[i]);
      }
      document.querySelectorAll(`[data-n^="${g}-"]`).forEach((el) => {
        const k = +el.dataset.n.split("-")[1];
        const n = counts[k] ? counts[k].size : 0;
        el.textContent = fmt(n);
        el.closest(".opt").classList.toggle("is-empty", n === 0);
      });
    });
  }
  function renderTags() {
    const tags = [];
    if (S.month >= 0) tags.push({ t: monthName(D.months[S.month]), off: () => { S.month = -1; $("f-month").value = "-1"; } });
    if (S.org >= 0) tags.push({ t: D.orgs[S.org][1] || D.orgs[S.org][0], off: () => { S.org = -1; $("f-org").value = "-1"; } });
    S.clusters.forEach((c) => tags.push({ t: D.clusters[c], off: () => { S.clusters.delete(c); document.querySelector(`[data-g=clusters][value="${c}"]`).checked = false; } }));
    S.types.forEach((c) => tags.push({ t: TYPE_LABEL[D.types[c]] || D.types[c], off: () => { S.types.delete(c); document.querySelector(`[data-g=types][value="${c}"]`).checked = false; } }));
    const el = $("showing");
    const period = S.month >= 0 ? monthName(D.months[S.month]) : `${monthName(D.months[0])} to ${monthName(D.months[D.months.length - 1])}`;
    el.innerHTML = tags.length
      ? `<span>Showing:</span>${tags.map((x, i) => `<span class="tag">${esc(x.t)}<button type="button" data-i="${i}" aria-label="Remove ${esc(x.t)}">×</button></span>`).join("")}`
      : `<span>Showing all organisations and clusters, ${esc(period)}.</span>`;
    el.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => { tags[+b.dataset.i].off(); render(); }));
  }

  /* ================= summary cards ================= */
  function renderKPIs(rows) {
    const orgs = orgSet(rows);
    const clusters = new Set(), states = new Set(), locs = new Set(), adswg = new Set();
    rows.forEach((i) => {
      if (!COUNTED[RO[i]]) return;
      clusters.add(RC[i]); locs.add(RL[i]);
      const s = LOC_STATE[RL[i]];
      states.add(s);
      if (ADSWG.includes(s)) adswg.add(RO[i]);
    });
    const types = {};
    orgs.forEach((o) => { const t = D.types[D.orgs[o][2]]; types[t] = (types[t] || 0) + 1; });
    const typeLine = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${fmt(n)} ${(TYPE_SHORT[t] || [t, t])[n === 1 ? 0 : 1]}`).join(", ");
    const card = (ico, label, value, sub) => `<div class="card kpi"><div class="kpi-label"><span class="kpi-ico">${ico}</span>${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${esc(sub)}</div></div>`;
    $("kpis").innerHTML =
      card(ICON.people, "Organisations", fmt(orgs.size), typeLine || "None reported") +
      card(ICON.layers, "Clusters", fmt(clusters.size), `of ${D.clusters.length} in the data`) +
      card(ICON.map, "States", fmt(states.size - (states.has(ABYEI) ? 1 : 0)), `with reported presence${states.has(ABYEI) ? ", plus Abyei PCA" : ""}`) +
      card(SF.icons.pin, "Localities", fmt(locs.size), `with reported presence`) +
      card(ICON.target, "In ADSWG states", fmt(adswg.size), "organisations in the five states");
  }

  /* ================= map ================= */
  function el(name, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  // class width: a round number (5, 10, 15, 20 ...) so that five classes cover the highest value
  function niceStep(raw) {
    if (raw <= 0) return 1;
    if (raw <= 5) return Math.ceil(raw);
    return Math.ceil(raw / 5) * 5;
  }
  function bins(max) {
    if (max <= 5) {
      const out = [];
      for (let i = 1; i <= Math.max(max, 1); i++) out.push({ lo: i, hi: i, label: `${i}` });
      return out;
    }
    const step = niceStep(max / 5), out = [];
    for (let i = 0; i < 5; i++) {
      const lo = i * step + 1, hi = (i + 1) * step;
      if (lo > max) break;
      out.push({ lo, hi, label: lo === hi ? `${lo}` : `${lo}-${hi}` });
    }
    return out;
  }
  function binColour(v, bs) {
    if (!(v > 0)) return "var(--map-none)";
    let idx = bs.findIndex((b) => v <= b.hi);
    if (idx < 0) idx = bs.length - 1;
    return SEQ[Math.min(SEQ.length - 1, idx + Math.max(0, SEQ.length - bs.length))];
  }

  const M = { areas: {}, locs: [] };
  let VB = null, zoomAnim = null;
  function buildMap() {
    const svg = $("map");
    VB = [0, 0, GEO.width, GEO.height];
    svg.setAttribute("viewBox", VB.join(" "));
    el("rect", { class: "water", x: -2000, y: -2000, width: GEO.width + 4000, height: GEO.height + 4000 }, svg);
    const gLand = el("g", {}, svg);
    GEO.land.forEach((c) => el("path", { d: c.path, class: "land" }, gLand));
    const gCountry = el("g", {}, svg);
    GEO.labels.forEach((l) => { el("text", { x: l.x, y: l.y, class: "country-lbl", "text-anchor": l.anchor || "middle" }, gCountry).textContent = l.name; });

    const gStates = el("g", {}, svg);
    const gLocs = el("g", {}, svg);
    M.stateLines = el("g", {}, svg);
    if (GEO.outline) el("path", { d: GEO.outline, class: "sudan-outline" }, svg);
    if (GEO.undeterminedBoundary) el("path", { d: GEO.undeterminedBoundary, class: "border-undetermined" }, svg);
    const gAdswg = el("g", {}, svg);
    M.hover = el("path", { class: "hover-outline", d: "" }, svg);
    M.sel = el("path", { class: "sel-outline", d: "" }, svg);
    M.labels = el("g", {}, svg);
    M.locLabels = el("g", {}, svg);
    M.ds = el("g", {}, svg);

    Object.values(AREAS).forEach((a) => {
      const path = el("path", { d: a.path, class: a.abyei ? "state abyei-fill" : "state", tabindex: 0, role: "button", "data-name": a.name }, gStates);
      const label = el("text", { class: a.abyei ? "lbl lbl-abyei" : "lbl", "text-anchor": "middle" }, M.labels);
      label.textContent = a.name;
      el("path", { d: a.path, class: "state-line" }, M.stateLines);
      if (ADSWG.includes(a.name)) el("path", { d: a.path, class: "adswg" }, gAdswg);
      M.areas[a.name] = { path, label, a };
      const pick = () => pickState(a.name);
      path.addEventListener("click", pick);
      path.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      hoverable(path, () => ({ kind: "state", name: a.name }), a.path);
    });
    LOCS.forEach((l, i) => {
      if (!l.path) { M.locs[i] = null; return; }
      const path = el("path", { d: l.path, class: "loc", role: "button", tabindex: -1 }, gLocs);
      const label = el("text", { class: "loc-lbl", x: l.x, y: l.y }, M.locLabels);
      label.textContent = l.name;
      M.locs[i] = { path, label };
      const pick = () => pickLocality(i);
      path.addEventListener("click", pick);
      path.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      hoverable(path, () => ({ kind: "loc", i }), l.path);
    });

    $("map-back").innerHTML = `${SF.icons.back}Back to all of Sudan`;
    $("map-back").addEventListener("click", () => { S.zoom = null; S.sel = null; render(); });
    document.querySelectorAll("#level button").forEach((b) => b.addEventListener("click", () => {
      S.level = b.dataset.v; S.zoom = null; S.sel = null; render();
    }));
    $("ds-toggle").addEventListener("change", async (e) => {
      S.ds = e.target.checked;
      if (S.ds && !SFP) await loadFootprint();
      render();
    });
    const lt = $("legend-toggle"), lb = $("op-legend-body");
    lt.addEventListener("click", () => {
      lb.hidden = !lb.hidden;
      lt.textContent = lb.hidden ? "Show legend" : "Hide legend";
      lt.setAttribute("aria-expanded", String(!lb.hidden));
    });
  }
  function hoverable(node, what, d) {
    node.addEventListener("mousemove", (e) => showTip(e, what()));
    node.addEventListener("mouseenter", () => M.hover.setAttribute("d", d));
    node.addEventListener("mouseleave", () => { hideTip(); M.hover.setAttribute("d", ""); });
    node.addEventListener("focus", () => { M.hover.setAttribute("d", d); });
    node.addEventListener("blur", () => { M.hover.setAttribute("d", ""); });
  }

  function pickState(name) {
    if (S.zoom === name && S.sel && S.sel.kind === "state") { S.zoom = null; S.sel = null; }
    else { S.zoom = name; S.sel = { kind: "state", name }; }
    render(true);
  }
  function pickLocality(i) {
    const l = LOCS[i];
    if (S.sel && S.sel.kind === "loc" && S.sel.i === i) S.sel = { kind: "state", name: l.state };
    else S.sel = { kind: "loc", i, di: l.di, name: l.name, state: l.state };
    S.zoom = l.state;
    render(true);
  }
  // the selected area as a filter on rows
  const selArea = () => (!S.sel ? null : S.sel.kind === "state" ? { kind: "state", name: S.sel.name } : { kind: "loc", di: S.sel.di });

  function targetViewBox() {
    const W = GEO.width, H = GEO.height;
    if (!S.zoom || !AREAS[S.zoom]) return [0, 0, W, H];
    const [x0, y0, x1, y1] = AREAS[S.zoom].bbox;
    const bw = x1 - x0, bh = (y1 - y0) + 120; // room for the legend
    let w = Math.min(Math.max(bw * 1.35, bh * 1.2 * (W / H), 220), W);
    const h = w * (H / W);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 45;
    return [cx - w / 2, cy - h / 2, w, h];
  }
  function animateTo(target) {
    if (zoomAnim) cancelAnimationFrame(zoomAnim);
    const svg = $("map"), from = VB.slice(), t0 = performance.now();
    const dur = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 480;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      VB = from.map((v, i) => v + (target[i] - v) * ease(k));
      svg.setAttribute("viewBox", VB.join(" "));
      placeOverlays();
      if (k < 1) zoomAnim = requestAnimationFrame(step);
    };
    zoomAnim = requestAnimationFrame(step);
  }
  const scaleK = () => GEO.width / VB[2];

  let DSC = null; // Solutions Footprint project counts for the current view
  function placeOverlays() {
    const k = scaleK();
    const showLocLabels = !!S.zoom;
    Object.values(M.areas).forEach(({ label, a }) => {
      const hasDs = DSC && !S.zoom && DSC.st[a.name];
      label.setAttribute("x", a.x);
      label.setAttribute("y", a.y + (hasDs ? 21 : a.abyei ? 22 : 4) / k);
      label.setAttribute("font-size", (a.abyei ? 11 : 11.5) / k);
      label.style.strokeWidth = `${3 / k}px`;
      label.style.display = S.zoom ? "none" : "";
    });
    LOCS.forEach((l, i) => {
      const m = M.locs[i];
      if (!m) return;
      const selected = S.sel && S.sel.kind === "loc" && S.sel.i === i;
      const fits = (l.bbox[2] - l.bbox[0]) >= (l.name.length * 5.4) / k;
      const on = showLocLabels && l.state === S.zoom && (fits || selected);
      m.label.style.display = on ? "" : "none";
      if (!on) return;
      const hasDs = DSC && DSC.lc[l.key];
      m.label.setAttribute("font-size", 10 / k);
      m.label.setAttribute("y", l.y + (hasDs ? 19 : 3.5) / k);
      m.label.style.strokeWidth = `${2.6 / k}px`;
    });
    M.ds.querySelectorAll(".ds-mark").forEach((g) => {
      g.setAttribute("transform", `translate(${g.dataset.x} ${g.dataset.y}) scale(${1 / k})`);
    });
  }

  function renderMap(rows) {
    const { st, lc } = perArea(rows);
    const zoomed = !!S.zoom;
    const locLevel = S.level === "localities" || zoomed;
    // colour scale over what is on screen
    let vals;
    if (zoomed) vals = LOCS.filter((l) => l.state === S.zoom && l.di >= 0).map((l) => (lc[l.di] ? lc[l.di].size : 0));
    else if (locLevel) vals = LOCS.filter((l) => l.di >= 0).map((l) => (lc[l.di] ? lc[l.di].size : 0));
    else vals = Object.keys(AREAS).map((n) => (st[n] ? st[n].size : 0));
    const bs = bins(Math.max(0, ...vals));
    const stateBins = zoomed ? bins(Math.max(0, ...Object.keys(AREAS).map((n) => (st[n] ? st[n].size : 0)))) : bs;

    Object.values(M.areas).forEach(({ path, a }) => {
      const n = st[a.name] ? st[a.name].size : 0;
      path.style.fill = binColour(n, stateBins);
      path.classList.toggle("is-dim", zoomed && S.zoom !== a.name);
      path.style.visibility = (locLevel && !zoomed) || (zoomed && S.zoom === a.name) ? "hidden" : "";
      path.setAttribute("aria-label", `${a.name}: ${plural(n, "organisation")}`);
    });
    M.stateLines.style.display = locLevel ? "" : "none";
    LOCS.forEach((l, i) => {
      const m = M.locs[i];
      if (!m) return;
      const visible = zoomed ? l.state === S.zoom : locLevel;
      const n = l.di >= 0 && lc[l.di] ? lc[l.di].size : 0;
      m.path.style.display = visible ? "" : "none";
      m.path.style.fill = binColour(n, bs);
      m.path.setAttribute("tabindex", visible && zoomed ? 0 : -1);
      m.path.setAttribute("aria-label", `${l.name}, ${l.state}: ${plural(n, "organisation")}`);
    });

    // selected outline
    let selPath = "";
    if (S.sel && S.sel.kind === "state" && AREAS[S.sel.name]) selPath = AREAS[S.sel.name].path;
    if (S.sel && S.sel.kind === "loc" && LOCS[S.sel.i] && LOCS[S.sel.i].path) selPath = LOCS[S.sel.i].path;
    M.sel.setAttribute("d", selPath);

    renderDs();
    placeOverlays();
    const target = targetViewBox();
    if (target.some((v, i) => Math.abs(v - VB[i]) > 0.5)) animateTo(target);
    $("map-back").hidden = !zoomed;
    document.querySelectorAll("#level button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === (locLevel ? "localities" : "states"))));
    $("map-title").textContent = zoomed ? `Organisations by locality, ${S.zoom}` : locLevel ? "Organisations by locality" : "Organisations by state";
    const off = Math.max(0, SEQ.length - bs.length);
    $("legend-bins").innerHTML = bs.map((b, i) => `<span><i style="background:${SEQ[i + off]}"></i>${b.label}</span>`).join("") +
      `<span class="none"><i style="background:var(--map-none);border:1px solid var(--line-2)"></i>None reported</span>`;
    $("legend-ds").hidden = !S.ds;
    MAPSTATE = { st, lc };
  }
  let MAPSTATE = null;

  /* Solutions Footprint projects (public data of the Solutions Footprint) */
  async function loadFootprint() {
    try {
      const d = await fetch("../mapping/data/projects.json", { cache: "no-cache" }).then((r) => r.json());
      SFP = (d.projects || d).filter((p) => p && p.name);
    } catch (e) { SFP = []; SF.toast("The Solutions Footprint projects could not be loaded."); }
  }
  function footprintIn(area) {
    if (!SFP) return { list: [], nationwide: [] };
    const nationwide = SFP.filter((p) => p.nationwide);
    let list = SFP.filter((p) => !p.nationwide);
    if (area && area.kind === "state") list = list.filter((p) => (p.states || []).includes(area.name));
    if (area && area.kind === "loc") {
      const l = LOCS[S.sel.i];
      list = list.filter((p) => (p.states || []).includes(l.state) && (p.localities || []).includes(l.key));
    }
    return { list, nationwide };
  }
  function renderDs() {
    M.ds.innerHTML = "";
    DSC = null;
    if (!S.ds || !SFP) return;
    DSC = { st: {}, lc: {} };
    SFP.forEach((p) => {
      if (p.nationwide) return;
      (p.states || []).forEach((s) => { DSC.st[s] = (DSC.st[s] || 0) + 1; });
      (p.localities || []).forEach((l) => { DSC.lc[l] = (DSC.lc[l] || 0) + 1; });
    });
    const mark = (x, y, n, title, onClick) => {
      const g = el("g", { class: "ds-mark", "data-x": x, "data-y": y, role: "img", "aria-label": title }, M.ds);
      el("title", {}, g).textContent = title;
      el("circle", { r: n > 9 ? 10 : 8.5, class: "ds-dot" }, g);
      el("text", { class: "ds-num", dy: "0.35em", "font-size": 10.5 }, g).textContent = n;
      g.addEventListener("click", onClick);
    };
    if (!S.zoom) {
      Object.entries(DSC.st).forEach(([s, n]) => {
        const a = AREAS[s];
        if (a) mark(a.x, a.y - 2, n, `${s}: ${plural(n, "Solutions Footprint project")}`, () => pickState(s));
      });
    } else {
      LOCS.forEach((l, i) => {
        if (l.state !== S.zoom || !l.path || !DSC.lc[l.key]) return;
        // only projects in this state that name this locality
        const n = SFP.filter((p) => !p.nationwide && (p.states || []).includes(l.state) && (p.localities || []).includes(l.key)).length;
        if (n) mark(l.x, l.y - 4, n, `${l.name}: ${plural(n, "Solutions Footprint project")}`, () => pickLocality(i));
      });
    }
  }

  /* tooltip */
  const tip = () => $("map-tip");
  function showTip(e, what) {
    if (!MAPSTATE) return;
    let name, sub, n, extra = "";
    if (what.kind === "state") {
      name = what.name;
      n = MAPSTATE.st[name] ? MAPSTATE.st[name].size : 0;
      sub = ADSWG.includes(name) ? "ADSWG state" : "";
      if (DSC && DSC.st[name]) extra = `<br>${plural(DSC.st[name], "Solutions Footprint project")}`;
    } else {
      const l = LOCS[what.i];
      name = l.name; sub = l.state;
      n = l.di >= 0 && MAPSTATE.lc[l.di] ? MAPSTATE.lc[l.di].size : 0;
    }
    const t = tip();
    t.innerHTML = `<strong>${esc(name)}</strong>${sub ? `${esc(sub)}<br>` : ""}${n ? plural(n, "organisation") : "No organisations reported"}${extra}`;
    const wrap = $("map-wrap").getBoundingClientRect();
    t.style.left = `${Math.max(90, Math.min(wrap.width - 90, e.clientX - wrap.left))}px`;
    t.style.top = `${Math.max(60, e.clientY - wrap.top)}px`;
    t.hidden = false;
  }
  function hideTip() { tip().hidden = true; }

  /* ================= side panel ================= */
  function barRows(entries, max, colour = "var(--brand)") {
    return entries.map(([label, n]) => `
      <div class="bar-row"><span title="${esc(label)}">${esc(label)}</span><div class="bar"><i style="width:${max ? Math.max(3, (n / max) * 100) : 0}%;background:${colour}"></i></div><span class="n">${fmt(n)}</span></div>`).join("");
  }
  function renderPanel(rows) {
    const area = selArea();
    const orgs = orgSet(rows);
    const byCluster = {}, byType = {}, orgLocs = {}, orgClusters = {}, locs = new Set(), months = new Set();
    rows.forEach((i) => {
      const o = RO[i];
      if (!COUNTED[o]) return;
      (byCluster[RC[i]] = byCluster[RC[i]] || new Set()).add(o);
      (orgLocs[o] = orgLocs[o] || new Set()).add(RL[i]);
      (orgClusters[o] = orgClusters[o] || new Set()).add(RC[i]);
      locs.add(RL[i]); months.add(RM[i]);
    });
    orgs.forEach((o) => { const t = D.types[D.orgs[o][2]]; byType[t] = (byType[t] || 0) + 1; });

    let kicker = "Selected area", name = "All of Sudan", third;
    if (S.sel && S.sel.kind === "state") {
      kicker = "State"; name = S.sel.name;
      const total = LOCS.filter((l) => l.state === name).length;
      third = { l: "Localities", v: `${fmt(locs.size)}<span class="op-of"> of ${fmt(total)}</span>` };
    } else if (S.sel && S.sel.kind === "loc") {
      kicker = `Locality, ${S.sel.state}`; name = S.sel.name;
      third = { l: "Months reported", v: `${fmt(months.size)}<span class="op-of"> of ${fmt(S.month >= 0 ? 1 : D.months.length)}</span>` };
    } else {
      third = { l: "Localities", v: fmt(locs.size) };
    }
    const isAdswg = (S.sel && S.sel.kind === "state" && ADSWG.includes(S.sel.name)) || (S.sel && S.sel.kind === "loc" && ADSWG.includes(S.sel.state));
    const areaOpts = [`<option value="">All of Sudan</option>`].concat(Object.keys(AREAS).sort((a, b) => a.localeCompare(b))
      .map((n) => `<option value="${esc(n)}"${S.zoom === n ? " selected" : ""}>${esc(n)}</option>`)).join("");

    const clusterRows = Object.entries(byCluster).map(([c, s]) => [D.clusters[c], s.size]).sort((a, b) => b[1] - a[1]);
    const typeRows = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => [TYPE_LABEL[t] || t, n]);
    const top = [...orgs].map((o) => ({ o, n: S.sel && S.sel.kind === "loc" ? orgClusters[o].size : orgLocs[o].size }))
      .sort((a, b) => b.n - a.n || (D.orgs[a.o][1] || D.orgs[a.o][0]).localeCompare(D.orgs[b.o][1] || D.orgs[b.o][0])).slice(0, 8);
    const topTitle = S.sel && S.sel.kind === "loc" ? "Organisations here" : "Widest coverage";
    const topNote = S.sel && S.sel.kind === "loc" ? "by number of clusters" : "by number of localities";

    let notMapped = "";
    if (!S.sel || S.sel.kind === "state") {
      const off = D.locs.map((l, i) => ({ l, i })).filter(({ l, i }) => !l[2] && (!S.sel || LOC_STATE[i] === S.sel.name) && rows.some((r) => RL[r] === i));
      if (off.length) notMapped = `<p class="op-panel-note">${off.map(({ l, i }) => `${esc(l[0])} (${esc(LOC_STATE[i])})`).join(", ")} ${off.length === 1 ? "has" : "have"} no boundary on the map; ${off.length === 1 ? "its" : "their"} partners are counted in the state.</p>`;
    }

    let ds = "";
    if (S.ds && SFP) {
      const { list, nationwide } = footprintIn(area);
      const show = list.slice(0, 5);
      ds = `<div class="op-ds-box"><h3>Solutions Footprint</h3>
        <div>${list.length ? plural(list.length, "project") : "No projects"} ${area ? (S.sel.kind === "loc" ? "naming this locality" : "in this state") : "in states"}${nationwide.length ? `, plus ${plural(nationwide.length, "nationwide project")}` : ""}.</div>
        ${show.length ? `<ul>${show.map((p) => `<li>${esc(p.name)} <span class="gap-word">(${esc(p.lead || "")})</span></li>`).join("")}</ul>` : ""}
        <div style="margin-top:6px"><a href="../mapping/">Open the Solutions Footprint</a></div></div>`;
    }

    const p = $("panel");
    p.classList.add("op-panel");
    p.innerHTML = `
      <div class="sp-head">
        <div><div class="sp-kicker">${esc(kicker)}</div><h2 class="sp-name">${esc(name)}${isAdswg ? '<span class="op-badge">ADSWG</span>' : ""}</h2></div>
        <div class="sp-select"><label for="area-select">Area</label><select id="area-select">${areaOpts}</select></div>
      </div>
      <div class="mini-kpis">
        <div class="mini"><div class="l">Organisations</div><div class="v">${fmt(orgs.size)}</div></div>
        <div class="mini"><div class="l">Clusters</div><div class="v">${fmt(clusterRows.length)}</div></div>
        <div class="mini"><div class="l">${esc(third.l)}</div><div class="v">${third.v}</div></div>
      </div>
      ${orgs.size ? `
      <div class="sp-section">Organisations per cluster</div>${barRows(clusterRows, clusterRows.length ? clusterRows[0][1] : 0)}
      <div class="sp-section">Organisation types</div>${barRows(typeRows, typeRows.length ? typeRows[0][1] : 0, "#4485d2")}
      <div class="sp-section">${topTitle}<small>${topNote}</small></div>
      <div class="op-top">${top.map(({ o, n }) => `<button type="button" data-org="${o}"><b>${esc(D.orgs[o][1] || D.orgs[o][0])}</b><em>${fmt(n)}</em></button>`).join("")}</div>`
      : `<p class="op-empty">No organisations reported here for the current filters.</p>`}
      ${notMapped}${ds}`;
    $("area-select").addEventListener("change", (e) => {
      const v = e.target.value;
      if (!v) { S.zoom = null; S.sel = null; render(); } else { S.zoom = v; S.sel = { kind: "state", name: v }; render(); }
    });
    p.querySelectorAll("[data-org]").forEach((b) => b.addEventListener("click", () => { S.org = +b.dataset.org; $("f-org").value = String(S.org); render(); }));
  }

  /* ================= per month ================= */
  function renderTrend() {
    const area = selArea();
    const per = D.months.map(() => new Set());
    for (let i = 0; i < N; i++) if (passes(i, "month") && inArea(i, area) && COUNTED[RO[i]]) per[RM[i]].add(RO[i]);
    const vals = per.map((s) => s.size), max = Math.max(1, ...vals);
    $("trend-sub").textContent = `${S.sel ? S.sel.name : "All of Sudan"}. Select a month to filter the page.`;
    $("trend").innerHTML = D.months.map((m, i) => `
      <button type="button" data-m="${i}" aria-pressed="${S.month === i}" aria-label="${esc(monthName(m))}: ${plural(vals[i], "organisation")}">
        <span class="v">${fmt(vals[i])}</span><span class="col" style="height:${Math.max(2, (vals[i] / max) * 100)}%"></span><span class="m">${esc(monthName(m, true))}</span>
      </button>`).join("");
    $("trend").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const m = +b.dataset.m;
      S.month = S.month === m ? -1 : m;
      $("f-month").value = String(S.month);
      render();
    }));
  }

  /* ================= who is where ================= */
  function renderTable(rows) {
    const per = {};
    rows.forEach((i) => {
      const o = RO[i];
      const r = (per[o] = per[o] || { o, clusters: new Set(), states: new Set(), locs: new Set(), months: new Set() });
      r.clusters.add(RC[i]); r.locs.add(RL[i]); r.months.add(RM[i]);
      if (LOC_STATE[RL[i]] !== ABYEI) r.states.add(LOC_STATE[RL[i]]);
    });
    const q = S.q.toLowerCase();
    let list = Object.values(per).filter((r) => !q || D.orgs[r.o][0].toLowerCase().includes(q) || (D.orgs[r.o][1] || "").toLowerCase().includes(q));
    const nameOf = (r) => (D.orgs[r.o][1] || D.orgs[r.o][0]).toLowerCase();
    const key = {
      name: (r) => nameOf(r), type: (r) => D.types[D.orgs[r.o][2]], clusters: (r) => r.clusters.size,
      states: (r) => r.states.size, locs: (r) => r.locs.size, months: (r) => r.months.size,
    }[S.sort.key];
    list.sort((a, b) => {
      if (COUNTED[a.o] !== COUNTED[b.o]) return COUNTED[a.o] ? -1 : 1; // unnamed partners last
      const x = key(a), y = key(b);
      const c = typeof x === "string" ? x.localeCompare(y) : x - y;
      return c * S.sort.dir || nameOf(a).localeCompare(nameOf(b));
    });
    const total = list.length;
    const LIMIT = 20;
    if (!S.showAll) list = list.slice(0, LIMIT);
    const th = (k, label, num) => {
      const on = S.sort.key === k;
      return `<th class="${num ? "num" : ""}"><button type="button" data-sort="${k}" aria-sort="${on ? (S.sort.dir > 0 ? "ascending" : "descending") : "none"}">${label}${on ? (S.sort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
    };
    const inLoc = S.sel && S.sel.kind === "loc";
    $("orgs-title").textContent = `Who is where${S.sel ? `: ${S.sel.name}` : ""}`;
    $("org-table").innerHTML = total ? `
      <thead><tr>${th("name", "Organisation")}${th("type", "Type")}${th("clusters", "Clusters")}${inLoc ? "" : th("states", "States", true)}${inLoc ? "" : th("locs", "Localities", true)}${th("months", "Months", true)}</tr></thead>
      <tbody>${list.map((r) => {
        const o = D.orgs[r.o];
        const nm = COUNTED[r.o]
          ? `<button type="button" class="op-pick" data-org="${r.o}" title="Show only this organisation">${esc(o[0])}</button>${o[1] ? `<span class="o-acr">${esc(o[1])}</span>` : ""}`
          : `<span class="o-name">${esc(o[0])}</span><span class="o-acr">not counted as an organisation</span>`;
        return `<tr><td>${nm}</td><td class="o-type">${esc(D.types[o[2]])}</td>
          <td><div class="op-chips">${[...r.clusters].sort((a, b) => a - b).map((c) => `<span class="op-chip">${esc(D.clusters[c])}</span>`).join("")}</div></td>
          ${inLoc ? "" : `<td class="num">${fmt(r.states.size)}</td><td class="num">${fmt(r.locs.size)}</td>`}<td class="num">${fmt(r.months.size)}</td></tr>`;
      }).join("")}</tbody>` : `<tbody><tr><td class="op-empty">No organisations match.</td></tr></tbody>`;
    $("org-more").innerHTML = total > LIMIT
      ? `<span>${S.showAll ? `Showing all ${fmt(total)}` : `Showing ${LIMIT} of ${fmt(total)}`}</span><button type="button" class="link-btn" id="org-all">${S.showAll ? "Show fewer" : "Show all"}</button>`
      : `<span>${plural(total, "entry", "entries")}</span>`;
    $("org-all")?.addEventListener("click", () => { S.showAll = !S.showAll; renderTable(rowsWhere(null, selArea())); });
    $("org-table").querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.sort;
      S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : k === "name" || k === "type" ? 1 : -1 };
      renderTable(rowsWhere(null, selArea()));
    }));
    $("org-table").querySelectorAll("[data-org]").forEach((b) => b.addEventListener("click", () => {
      S.org = +b.dataset.org; $("f-org").value = String(S.org); render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
  }

  /* ================= about ================= */
  function renderAbout() {
    const first = monthName(D.months[0]), last = monthName(D.months[D.months.length - 1]);
    $("note-line").innerHTML = `${SF.icons.info}<span>Partner numbers are based on programmatic coverage and do not necessarily indicate physical presence. Source: ${esc(D.source.org)}, 3W, ${esc(first)} to ${esc(last)}.</span>`;
    $("footer-text").textContent = `Operational Presence, Durable Solutions Hub | Sudan. Data: ${D.source.org}, 3W, ${first} to ${last}.`;
    $("about-body").innerHTML = `
      <ul>
        <li><b>Source:</b> ${esc(D.source.title)}, ${esc(D.source.org)}, ${esc(first)} to ${esc(last)}. See the <a href="${esc(D.source.dashboard)}" target="_blank" rel="noopener">OCHA operational presence dashboard</a> and <a href="${esc(D.source.url)}" target="_blank" rel="noopener">OCHA Sudan on HDX</a>.</li>
        <li><b>What is counted:</b> an organisation is counted in a locality when it reported activities there for at least one cluster, in the selected months. With all months selected, an organisation counts once even if it reported in several months.</li>
        <li><b>Coverage, not presence:</b> partner numbers reflect programmatic coverage and do not necessarily indicate physical presence.</li>
        <li><b>Other totals:</b> OCHA's operational presence dashboard can show different totals, as it may cover a longer period and partners reporting outside the response plan.</li>
        <li><b>Solutions Footprint projects:</b> the switch above the map adds the projects published on the <a href="../mapping/">Solutions Footprint</a>, by state, and by locality when a project names its localities.</li>
        ${(D.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}
        <li><b>Access:</b> this page opens only with the access code. Please share the code with coordination partners only.</li>
      </ul>`;
  }

  /* ================= page ================= */
  function render(scroll) {
    const rows = rowsWhere(null, null);
    const area = selArea();
    const areaRows = area ? rows.filter((i) => inArea(i, area)) : rows;
    renderTags();
    updateCounts();
    renderKPIs(rows);
    renderMap(rows);
    renderPanel(areaRows);
    renderTrend();
    renderTable(areaRows);
    if (scroll && window.innerWidth < 1280) $("panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function chrome() {
    $("gh-link").innerHTML = SF.icons.github;
    $("li-link").innerHTML = SF.icons.linkedin;
    const tb = $("theme-btn");
    const paint = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      tb.innerHTML = dark ? SF.icons.sun : SF.icons.moon;
      tb.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      tb.title = dark ? "Light mode" : "Dark mode";
    };
    tb.addEventListener("click", () => SF.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    document.addEventListener("sf-theme", paint);
    paint();
    $("lock-btn").addEventListener("click", () => { store.clear(); location.reload(); });
    let t;
    $("org-search").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); S.showAll = false; renderTable(rowsWhere(null, selArea())); }, 150); });
  }

  let started = false;
  async function start(data) {
    if (started) return;
    started = true;
    try {
      [GEO, LGEO] = await Promise.all([
        fetch("../mapping/data/geo.json").then((r) => r.json()),
        fetch("data/localities-geo.json").then((r) => r.json()),
      ]);
    } catch (e) {
      started = false;
      const err = $("gate-err");
      err.textContent = "The map could not load. Please check your connection and try again.";
      err.hidden = false;
      $("gate-go").disabled = false; $("gate-go").textContent = "Open";
      return;
    }
    prepare(data);
    $("gate").hidden = true;
    $("app").hidden = false;
    document.title = "Operational Presence | Durable Solutions Hub | Sudan";
    chrome();
    buildFilters();
    buildMap();
    renderAbout();
    render();
  }

  initGate();
})();
