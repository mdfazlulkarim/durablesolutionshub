/* Shared settings and helpers for every page. */
"use strict";

const SF = (window.SF = window.SF || {});

SF.config = {
  contactEmail: "dswg.sd@undp.org",
  dataUrl: "data/projects.json",
  geoUrl: "data/geo.json",
  orgsUrl: "data/organisations.json",
  localitiesUrl: "data/localities.json",
  refsUrl: "data/project-refs.json",
  templateUrl: "assets/templates/solutions-footprint-projects-template.xlsx",
  logosUrl: "data/logos.json",
  hdxAdminUrl: "https://data.humdata.org/dataset/cod-ab-sdn",
  // Back end that receives projects directly (no email needed). Leave empty to use email only.
  apiUrl: "https://solutions-footprint.ds-sudan.workers.dev",
  // Back end used for signing in (DSU admins now, agency editors later). Leave empty to hide the Sign in button.
  authUrl: "https://solutions-footprint.ds-sudan.workers.dev",
  // Optional spam protection (Cloudflare Turnstile site key). Leave empty if not used.
  turnstileSiteKey: "",
  githubUrl: "https://github.com/mdfazlulkarim",
  linkedinUrl: "https://www.linkedin.com/in/fazlulkarim/",
};

/* Test mode: turned on from test.html, in one browser only. Projects sent from that browser go to the
   review queue on the back end; everyone else keeps using email until apiUrl above is set. */
// Show the short address (…/sudan/mapping/) instead of …/index.html
try { if (/\/index\.html$/.test(location.pathname)) history.replaceState(null, "", location.pathname.replace(/index\.html$/, "") + location.search + location.hash); } catch (e) { /* not important */ }

SF.TEST_API = "https://solutions-footprint.ds-sudan.workers.dev";
SF.themePages = /github\.io$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
try {
  if (localStorage.getItem("sf-test-mode") === "on") {
    if (!SF.config.apiUrl) SF.config.apiUrl = SF.TEST_API;
    if (!SF.config.authUrl) SF.config.authUrl = SF.TEST_API;
    SF.testMode = true;
  }
} catch (e) { /* storage may be blocked */ }

SF.CRITERIA = [
  { n: 1, name: "Safety and security", short: "Safety and security", ring: "Safety", color: "#2A78D6", hint: "Protection, social cohesion, mine action, disaster risk reduction",
    brief: "People live in long-term safety and security, without risk of attacks, violence, harassment or landmines, and can move freely." },
  { n: 2, name: "Adequate standard of living", short: "Standard of living", ring: "Standard of living", color: "#EB6834", hint: "Water, health, education, shelter and other basic services",
    brief: "People have at least a minimum level of food, water, housing, health care and basic education, without discrimination." },
  { n: 3, name: "Access to livelihoods and employment", short: "Livelihoods and employment", ring: "Livelihoods", color: "#1BAF7A", hint: "Jobs, skills, cash-for-work, markets",
    brief: "People can find work or other ways to earn a living that let them meet their basic needs." },
  { n: 4, name: "Housing, land and property", short: "Housing, land and property", ring: "Housing and land", color: "#EDA100", hint: "Restoring homes, land and property rights",
    brief: "People can get back their homes, land and property, or receive fair compensation, through mechanisms that work." },
  { n: 5, name: "Access to documentation", short: "Documentation", ring: "Documentation", color: "#E87BA4", hint: "Civil and legal documents, legal counselling",
    brief: "People can obtain or replace personal and other documents, such as identity cards, birth certificates and property deeds." },
  { n: 6, name: "Family reunification", short: "Family reunification", ring: "Family reunification", color: "#008300", hint: "Tracing and reuniting separated families",
    brief: "Family members separated by displacement can find each other and reunite if they wish." },
  { n: 7, name: "Participation in public affairs", short: "Participation in public affairs", ring: "Participation", color: "#6250D6", hint: "Voice in local decisions, community groups",
    brief: "People can take part in public affairs and community decisions on an equal footing with residents, including voting." },
  { n: 8, name: "Access to effective remedies and justice", short: "Remedies and justice", ring: "Remedies and justice", color: "#E34948", hint: "Access to justice and redress for violations",
    brief: "People can seek justice and redress for violations linked to their displacement, including through courts and reparation schemes." },
];
SF.IASC_SOURCE = { label: "IASC Framework on Durable Solutions for Internally Displaced Persons (2010)", url: "https://interagencystandingcommittee.org/node/2875" };
SF.GAP_COLOR = "var(--gap)";
SF.critIcon = (n, color) => {
  const svg = (SF.OCHA && SF.OCHA[String(n)]) || "";
  return color ? svg.replace("<svg ", `<svg style="color:${color}" `) : svg;
};
SF.icon = (key) => (SF.OCHA && SF.OCHA[key]) || "";

SF.STATES = [
  "Aj Jazirah", "Blue Nile", "Central Darfur", "East Darfur", "Gedaref", "Kassala",
  "Khartoum", "North Darfur", "North Kordofan", "Northern", "Red Sea", "River Nile",
  "Sennar", "South Darfur", "South Kordofan", "West Darfur", "West Kordofan", "White Nile",
];

SF.INTERVENTION_TYPES = [
  "Basic services rehabilitation", "Livelihoods and cash-for-work", "Shelter and housing",
  "Legal aid and documentation", "Social cohesion and peacebuilding",
  "Local governance and urban planning", "Data, evidence and preparedness", "Family reunification support",
];
SF.ORG_TYPES = [
  { key: "UN agency", label: "UN agencies" },
  { key: "International NGO", label: "International NGOs" },
  { key: "National NGO", label: "National NGOs" },
  { key: "Red Cross / Red Crescent", label: "Red Cross / Red Crescent" },
  { key: "Authorities", label: "Authorities" },
  { key: "Other", label: "Other" },
];
SF.LEADERSHIP = [
  { key: "WLO", label: "Women-led organisation (WLO)" },
  { key: "RLO", label: "Refugee-led organisation (RLO)" },
  { key: "YLO", label: "Youth-led organisation (YLO)" },
  { key: "OPD", label: "Organisation of persons with disabilities (OPD)" },
];
SF.TARGET_GROUPS = [
  { key: "idps", label: "IDPs" },
  { key: "returnees", label: "Returnees" },
  { key: "refugees", label: "Refugees" },
  { key: "host", label: "Host community" },
  { key: "other", label: "Other or not specified" },
];
SF.COORDINATION_OPTIONS = [
  "Durable Solutions Working Group (DSWG)", "Area Durable Solutions Working Group (ADSWG)",
  "Information Management Working Group (IMWG)", "Protection Cluster", "Shelter Cluster",
  "Health Cluster", "Education Cluster", "WASH Cluster", "Food Security and Livelihoods Cluster",
  "Legal Aid Working Group", "Other",
];
// Agency logos: full logo for the strip and pop-ups, square mark for small badges
SF.LOGOS = {
  IOM: { full: "assets/img/logos/IOM.png", mark: "assets/img/logos/IOM-mark.png", name: "International Organization for Migration" },
  UNDP: { full: "assets/img/logos/UNDP.png", mark: "assets/img/logos/UNDP-mark.png", name: "United Nations Development Programme" },
  UNFPA: { full: "assets/img/logos/UNFPA.png", mark: "assets/img/logos/UNFPA-mark.png", name: "United Nations Population Fund" },
  UNHCR: { full: "assets/img/logos/UNHCR.png", mark: "assets/img/logos/UNHCR-mark.png", name: "United Nations High Commissioner for Refugees" },
};
/* Donors: a project can name several, each with the amount it gives. Older entries have one text field. */
SF.MAX_DONORS = 5;
SF.donorList = (p) => (p.donors && p.donors.length ? p.donors.map((d) => d.name).filter(Boolean) : p.donor ? [p.donor] : []);
SF.donorText = (p) => (p.donors && p.donors.length
  ? p.donors.map((d) => (d.amount != null ? `${d.name} (${SF.fmtMoney(d.amount)})` : d.name)).join(", ")
  : p.donor || "");
// Split an amount (for example funding towards durable solutions) across the donors, in line with what each gives
SF.donorSplit = (p, total) => {
  const ds = (p.donors || []).filter((d) => d.name);
  const sum = ds.reduce((a, d) => a + (d.amount || 0), 0);
  if (ds.length > 1 && sum > 0 && ds.every((d) => d.amount > 0)) return ds.map((d) => [d.name, (total * d.amount) / sum]);
  return [[SF.donorList(p)[0] || "Donor not reported", total]];
};

// Logos added later through the admin pages are listed in data/logos.json
SF.loadLogos = () => SF.loadJSON(SF.config.logosUrl).then((l) => { Object.assign(SF.LOGOS, l || {}); }).catch(() => {});

/* Make a photo or logo smaller in the browser, to under 1 MB, before it is sent.
   Returns { name, type, data (base64), size, origSize, url (for a preview) }. */
SF.MAX_IMAGE = 950 * 1024;
SF.shrinkImage = async (file, opts = {}) => {
  const max = opts.maxBytes || SF.MAX_IMAGE, side = opts.maxSide || 1600;
  const okType = /^image\/(jpeg|png|webp)$/.test(file.type);
  const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const done = async (blob, type) => ({ name: file.name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg"), type, data: await toB64(blob), size: blob.size, origSize: file.size, url: URL.createObjectURL(blob) });
  if (okType && file.size <= max && !opts.force) return { ...(await done(file, file.type)), name: file.name, type: file.type };
  const src = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`"${file.name}" could not be opened as a photo. Please use a JPG or PNG file.`)); i.src = src; });
  URL.revokeObjectURL(src);
  const png = !!opts.keepPng && file.type === "image/png";
  let scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  for (let round = 0; round < 8; round++) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = c.getContext("2d");
    if (!png) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(img, 0, 0, c.width, c.height);
    for (const q of png ? [null] : [0.85, 0.75, 0.65]) {
      const blob = await new Promise((r) => c.toBlob(r, png ? "image/png" : "image/jpeg", q || undefined));
      if (blob && blob.size <= max) return done(blob, png ? "image/png" : "image/jpeg");
    }
    scale *= 0.75;
  }
  throw new Error(`"${file.name}" could not be made smaller than 1 MB.`);
};
SF.fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

SF.logoImg = (org, kind = "mark", cls = "") => {
  const l = SF.LOGOS[org];
  if (l) return `<img src="${l[kind]}" alt="${SF.esc(org)}" class="${cls}" loading="lazy">`;
  // no logo yet: a short badge (the acronym, or the initials of a long name)
  const name = String(org || "");
  const short = name.length <= 7 ? name : name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|for|the|in)$/i.test(w)).map((w) => w[0].toUpperCase()).join("").slice(0, 4);
  return `<span title="${SF.esc(name)}">${SF.esc(kind === "full" ? name : short)}</span>`;
};

/* ---------- dates ---------- */
SF.today = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();
SF.parseDate = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
SF.addMonths = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, date.getDate());
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
SF.fmtMonth = (d) => (d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "");
SF.fmtDateLong = (d) => (d ? `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : "");

/* Prepare a project for display: dates as Date objects and status from the dates. */
SF.enrich = (p) => {
  p._start = SF.parseDate(p.start);
  p._end = SF.parseDate(p.end);
  p.status = SF.deriveStatus(p);
  p._endingSoon = p.status === "Ongoing" && p._end && p._end >= SF.today && p._end <= SF.addMonths(SF.today, 6);
  p.partners = p.partners || [];
  p.partnerTypes = p.partnerTypes || [];
  p.leadership = p.leadership || [];
  p.photos = p.photos || [];
  p._orgs = [p.lead, ...p.partners].filter(Boolean);
  return p;
};
SF.deriveStatus = (p) => {
  const t = SF.today;
  if (p.reportedStatus === "Pipeline" && (!p._start || p._start > t)) return "Pipeline";
  if (p._end && p._end < t) return "Ended";
  if (p._start && p._start > t) return "Pipeline";
  if (p._start || p._end) return "Ongoing";
  return p.reportedStatus || null;
};

/* ---------- numbers ---------- */
SF.fmtInt = (n) => (n == null ? "" : Math.round(n).toLocaleString("en-US"));
SF.fmtMoney = (v, opts = {}) => {
  if (v == null || isNaN(v)) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e8 || opts.round ? 0 : 1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(a >= 1e5 || opts.round ? 0 : 1).replace(/\.0$/, "")}K`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
};
SF.fmtUSD = (v) => (v == null || isNaN(v) ? "" : `$${Math.round(v).toLocaleString("en-US")}`);
SF.fmtPct = (s) => (s == null ? "" : `${Math.round(s * 100)}%`);

SF.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

SF.loadJSON = async (url) => {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Could not load ${url}`);
  return r.json();
};
SF.toast = (msg) => {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
};

/* ---------- theme (light / dark) ---------- */
SF.setTheme = (t) => {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("sf-theme", t); } catch (e) { /* storage may be blocked */ }
  document.dispatchEvent(new CustomEvent("sf-theme", { detail: t }));
};

/* ---------- header and footer, shared by all pages ---------- */
SF.icons = {
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/></svg>',
  form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.7.5.6 5.6.6 11.9c0 5 3.3 9.3 7.8 10.8.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.5-1.5 7.8-5.8 7.8-10.8C23.4 5.6 18.3.5 12 .5z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6h.1c.5-.9 1.6-1.8 3.4-1.8 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM7.1 20.5H3.5V9h3.6v11.5zM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0z"/></svg>',
};

/* The "Add your project" menu: one project (form) or several (Excel template) */
SF.addMenuHTML = (id = "add") => `
  <div class="dropdown">
    <button class="btn btn-primary" id="${id}-btn" aria-haspopup="true" aria-expanded="false" aria-controls="${id}-menu">${SF.icons.plus}Add your project${SF.icons.chevron}</button>
    <div class="dropdown-menu" id="${id}-menu" role="menu" hidden>
      <a class="menu-item" role="menuitem" href="add.html"><span class="mi-ico">${SF.icons.form}</span><span><b>Add one project</b><small>Fill in a short online form.</small></span></a>
      <a class="menu-item" role="menuitem" href="add-multiple.html"><span class="mi-ico">${SF.icons.sheet}</span><span><b>Add multiple projects</b><small>Fill in the Excel template, one row per project, and send them all at once.</small></span></a>
    </div>
  </div>`;
SF.bindDropdown = (id) => {
  const btn = document.getElementById(`${id}-btn`), menu = document.getElementById(`${id}-menu`);
  if (!btn || !menu) return;
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) menu.querySelector("a,button")?.focus(); });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { close(); btn.focus(); } });
  menu.addEventListener("click", () => setTimeout(close, 50));
};

/* Template links save the file straight away instead of opening it in the browser,
   including when the page is embedded in another site. */
SF.downloadTemplate = async (e) => {
  if (e) e.preventDefault();
  const url = SF.config.templateUrl;
  const name = url.split("/").pop();
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const blob = new Blob([await r.arrayBuffer()], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    SF.toast("Template downloaded");
  } catch (err) {
    SF.toast("Your download did not start. Right-click the link and choose Save link as.");
  }
};
SF.bindTemplateLinks = (root = document) => {
  root.querySelectorAll("[data-template]").forEach((a) => {
    if (a.dataset.bound) return;
    a.dataset.bound = "1";
    a.href = SF.config.templateUrl;
    a.setAttribute("download", SF.config.templateUrl.split("/").pop());
    a.addEventListener("click", SF.downloadTemplate);
  });
};

SF.renderHeader = (active) => {
  const el = document.getElementById("site-header");
  if (!el) return;
  const nav = [
    { key: "map", href: "./", label: "Map" },
    // Phase 2 and 3 views stay hidden until they are released:
    // { key: "projects", href: "projects.html", label: "Projects" },
    // { key: "gaps", href: "gaps.html", label: "Gaps" },
    { key: "about", href: "about.html", label: "About the data" },
    // Theme pages live on the git page only (mdfazlulkarim.github.io)
    ...(SF.themePages ? [{ key: "women", href: "women.html", label: "Women and girls" }] : []),
    { key: "mine", href: "my-submissions.html", label: "My submissions" },
  ];
  const action = active === "add" ? `<a class="btn" href="./">Back to the map</a>` : SF.addMenuHTML("add");
  el.className = "site-header";
  if (SF.testMode && !document.getElementById("test-bar")) {
    el.insertAdjacentHTML("beforebegin", `<div class="test-bar" id="test-bar"><b>Test mode, in this browser only.</b> Projects you send go to the new review queue, not by email. <a href="test.html">Test page</a> · <button type="button" id="test-off">Leave test mode</button></div>`);
    document.getElementById("test-off").addEventListener("click", () => { try { localStorage.removeItem("sf-test-mode"); } catch (e) {} location.reload(); });
  }
  el.innerHTML = `
    <div class="header-inner">
      <a class="brand" href="./" aria-label="Solutions Footprint home">
        <img class="brand-logo" src="assets/img/un-sudan-logo.png" alt="United Nations Sudan" width="153" height="42">
        <span class="brand-divider" aria-hidden="true"></span>
        <span>
          <span class="brand-kicker">Durable Solutions Hub | Sudan</span><br>
          <span class="brand-title">Solutions Footprint</span>
        </span>
      </a>
      <nav class="main-nav" aria-label="Views">
        ${nav.map((n) => `<a href="${n.href}"${n.key === active ? ' aria-current="page"' : ""}>${n.label}</a>`).join("")}
      </nav>
      <div class="header-actions">
        <button type="button" class="btn icon-toggle" id="theme-btn"></button>
        ${action}
        ${SF.config.authUrl ? '<div class="dropdown" id="acct"></div>' : ""}
      </div>
    </div>`;
  const tb = document.getElementById("theme-btn");
  const paint = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    tb.innerHTML = dark ? SF.icons.sun : SF.icons.moon;
    tb.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    tb.title = dark ? "Light mode" : "Dark mode";
  };
  tb.addEventListener("click", () => SF.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  document.addEventListener("sf-theme", paint);
  paint();
  SF.bindDropdown("add");
  SF.bindTemplateLinks();
  SF.auth.drawButton();
};

/* ---------- sign in with an emailed 6-digit code ----------
   For DSU admins now, and for approved agency editors later. Only emails on the approved list get a code.
   The session key is kept in this browser for 24 hours, or until Sign out. */
SF.auth = {
  KEY: "sf-session",
  get() {
    try { const s = JSON.parse(localStorage.getItem(SF.auth.KEY) || "null"); return s && s.token && s.expires > Date.now() ? s : null; } catch (e) { return null; }
  },
  save(s) { try { localStorage.setItem(SF.auth.KEY, JSON.stringify(s)); } catch (e) { /* storage may be blocked */ } },
  clear() { try { localStorage.removeItem(SF.auth.KEY); } catch (e) { /* storage may be blocked */ } },
  async post(path, body) {
    let r;
    try {
      r = await fetch(SF.config.authUrl + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { throw Object.assign(new Error("The sign-in service could not be reached. Please check your connection and try again."), { code: "offline" }); }
    const j = await r.json().catch(() => ({ ok: false, error: "The sign-in service did not answer properly. Please try again." }));
    if (!j.ok) throw Object.assign(new Error(j.error || "Something went wrong. Please try again."), { code: j.code || "" });
    return j;
  },
  initials(s) {
    const parts = (s.name ? String(s.name).split(/\s+/) : String(s.email || "").split("@")[0].split(/[._-]+/)).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  },
  roleLabel: (s) => (s.role === "admin" ? "DSU admin" : `${s.agency || "Agency"} admin`),
  drawButton() {
    const host = document.getElementById("acct");
    if (!host) return;
    const s = SF.auth.get();
    if (!s) {
      host.innerHTML = `<button type="button" class="btn signin-btn" id="signin-btn">${SF.icons.user}<span>Sign in</span></button>`;
      document.getElementById("signin-btn").addEventListener("click", () => SF.auth.open());
      return;
    }
    const admin = s.role === "admin";
    host.innerHTML = `
      <button type="button" class="avatar-btn" id="acct-btn" aria-haspopup="true" aria-expanded="false" aria-controls="acct-menu" title="Signed in as ${SF.esc(s.name || s.email)}">${SF.esc(SF.auth.initials(s))}</button>
      <div class="dropdown-menu acct-menu" id="acct-menu" role="menu" hidden>
        <div class="acct-who"><b>${SF.esc(s.name || s.email)}</b>${s.name ? `${SF.esc(s.email)}<br>` : "Signed in<br>"}<span class="acct-role">${SF.esc(SF.auth.roleLabel(s))}</span></div>
        ${admin ? `<a class="menu-item" role="menuitem" href="manage.html#/projects">Manage all projects</a>
        <a class="menu-item" role="menuitem" href="manage.html#/queue">Review queue</a>
        <a class="menu-item" role="menuitem" href="manage.html#/editors">Approved editors</a>` : `<a class="menu-item" role="menuitem" href="manage.html#/projects">${SF.esc(s.agency || "My agency")} projects</a>
        <a class="menu-item" role="menuitem" href="manage.html#/changes">Sent for review</a>`}
        <button type="button" class="menu-item" role="menuitem" id="signout-btn">Sign out</button>
      </div>`;
    SF.bindDropdown("acct");
    document.getElementById("signout-btn").addEventListener("click", () => SF.auth.signOut());
  },
  signOut() {
    SF.auth.clear();
    SF.toast("Signed out");
    if (/manage\.html$/.test(location.pathname)) location.href = "./";
    else SF.auth.drawButton();
  },
  // The sign-in window: email, then the code from the email
  open(note) {
    let d = document.getElementById("signin");
    if (!d) {
      d = document.createElement("dialog");
      d.className = "modal signin-modal"; d.id = "signin"; d.setAttribute("aria-labelledby", "signin-title");
      document.body.appendChild(d);
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    }
    let email = "";
    try { email = localStorage.getItem("sf-signin-email") || ""; } catch (e) { /* storage may be blocked */ }
    const close = '<button type="button" class="modal-close" aria-label="Close" data-close>&times;</button>';
    const wire = () => d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
    const busy = (b, on, label) => { if (on) { b.dataset.l = b.textContent; b.textContent = label; b.disabled = true; } else { b.textContent = b.dataset.l || b.textContent; b.disabled = false; } };

    const stepEmail = (msg) => {
      d.innerHTML = `${close}<form class="signin-box" id="si-form" novalidate>
        <h2 id="signin-title">Sign in</h2>
        <p>${note ? SF.esc(note) + " " : ""}For DSU and approved agency editors. We will email you a 6-digit code. No password needed.</p>
        <label class="field-label" for="si-email">Work email</label>
        <input class="input" id="si-email" type="email" autocomplete="email" inputmode="email" required value="${SF.esc(email)}">
        <div class="signin-err" id="si-err" role="alert">${msg ? SF.esc(msg) : ""}</div>
        <button type="submit" class="btn btn-primary signin-go" id="si-go">Send code</button>
      </form>`;
      wire();
      const input = d.querySelector("#si-email");
      setTimeout(() => input.focus(), 30);
      d.querySelector("#si-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = d.querySelector("#si-err"), go = d.querySelector("#si-go");
        email = input.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Please enter a valid email address."; input.focus(); return; }
        err.textContent = ""; busy(go, true, "Sending the code");
        try {
          const r = await SF.auth.post("/api/auth/start", { email });
          try { localStorage.setItem("sf-signin-email", email); } catch (x) { /* storage may be blocked */ }
          stepCode(r);
        } catch (x) {
          busy(go, false);
          if (x.code === "not_approved") stepRefused(x.message); else err.textContent = x.message;
        }
      });
    };
    const stepRefused = (msg) => {
      d.innerHTML = `${close}<div class="signin-box">
        <h2 id="signin-title">Sign in</h2>
        <div class="signin-stop" role="alert"><b>${SF.esc(email)} is not on the approved list.</b><br>${SF.esc(msg.replace(/^This email is not on the approved list\.\s*/, ""))}</div>
        <p class="signin-small">Partners can still add projects with "Add your project", no sign-in needed.</p>
        <button type="button" class="btn signin-go" id="si-back">Use a different email</button>
      </div>`;
      wire();
      d.querySelector("#si-back").addEventListener("click", () => stepEmail());
    };
    const stepCode = (r) => {
      d.innerHTML = `${close}<form class="signin-box" id="si-form" novalidate>
        <h2 id="signin-title">Check your email</h2>
        <p>We sent a 6-digit code to <b>${SF.esc(email)}</b>. It works for ${r.minutes || 10} minutes.</p>
        <label class="field-label" for="si-code">Code</label>
        <input class="input signin-code" id="si-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" required>
        ${r.devCode ? `<p class="signin-small">Local test only, code: <b>${SF.esc(r.devCode)}</b></p>` : ""}
        <div class="signin-err" id="si-err" role="alert"></div>
        <button type="submit" class="btn btn-primary signin-go" id="si-go">Sign in</button>
        <p class="signin-small">No email? Check your junk mail, <button type="button" class="link-btn" id="si-again">send a new code</button> or <button type="button" class="link-btn" id="si-other">use a different email</button>.</p>
      </form>`;
      wire();
      const input = d.querySelector("#si-code");
      setTimeout(() => input.focus(), 30);
      d.querySelector("#si-other").addEventListener("click", () => stepEmail());
      d.querySelector("#si-again").addEventListener("click", async (e) => {
        const err = d.querySelector("#si-err");
        try { await SF.auth.post("/api/auth/start", { email }); err.textContent = ""; SF.toast("A new code is on its way"); }
        catch (x) { err.textContent = x.message; }
      });
      d.querySelector("#si-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = d.querySelector("#si-err"), go = d.querySelector("#si-go");
        const code = input.value.replace(/\D/g, "");
        if (code.length !== 6) { err.textContent = "The code has 6 digits."; input.focus(); return; }
        err.textContent = ""; busy(go, true, "Checking");
        try {
          const s = await SF.auth.post("/api/auth/verify", { email, code });
          SF.auth.save({ token: s.token, expires: s.expires, email: s.email, name: s.name || "", role: s.role, agency: s.agency || null });
          d.close();
          SF.auth.drawButton();
          SF.toast("Signed in");
          document.dispatchEvent(new CustomEvent("sf-signed-in"));
        } catch (x) { busy(go, false); err.textContent = x.message; input.select(); }
      });
    };
    stepEmail();
    if (!d.open) d.showModal();
  },
};

SF.renderFooter = (lastUpdated) => {
  const el = document.getElementById("site-footer");
  if (!el) return;
  el.className = "site-footer";
  el.innerHTML = `
    <div class="footer-inner">
      <span class="grow">Solutions Footprint, Durable Solutions Hub | Sudan. Data reported by organisations to the Durable Solutions Working Group${lastUpdated ? `, last updated ${SF.fmtDateLong(SF.parseDate(lastUpdated))}` : ""}.</span>
      <span>Contact: <a href="mailto:${SF.config.contactEmail}">${SF.config.contactEmail}</a></span>
      <span class="social">
        <a href="${SF.config.githubUrl}" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub">${SF.icons.github}</a>
        <a href="${SF.config.linkedinUrl}" target="_blank" rel="noopener" aria-label="LinkedIn" title="LinkedIn">${SF.icons.linkedin}</a>
      </span>
      <span class="footer-credits">Icons: <a href="https://brand.unocha.org/d/xEPytAUjC3sH/icons" target="_blank" rel="noopener">OCHA Humanitarian Icons</a>, United Nations Office for the Coordination of Humanitarian Affairs. Boundaries: OCHA administrative boundaries for Sudan via geoBoundaries (CC BY 3.0 IGO), and Natural Earth. Agency logos belong to their organisations.</span>
    </div>`;
};
