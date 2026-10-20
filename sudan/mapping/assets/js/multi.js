/* "Add multiple projects": read the filled Excel template in the browser, check every row,
   then send the ready rows to the Durable Solutions Unit (or explain how to email the file). */
"use strict";

(() => {
  const { esc, STATES } = SF;
  const $ = (id) => document.getElementById(id);
  const API = String(SF.config.apiUrl || "").replace(/\/$/, "");
  let ORGS = [], LOCALITIES = {}, ROWS = [], tsWidget = null;

  // Template columns (see scripts/build_template.py). Headers are matched without the " *".
  const COLS = {
    name: "Project or programme name", description: "Short description", itypes: "Intervention type", orgType: "Organisation type",
    lead: "Lead organisation", leadership: "Organisation leadership", partners: "Implementing partners", fpName: "Focal point name",
    fpEmail: "Focal point email", scope: "Geographic scope", states: "States", localities: "Localities",
    coordination: "Coordination mechanism or cluster", start: "Start date", end: "End date", status: "Status",
    budget: "Total budget", share: "Share towards durable solutions", donor: "Donor or funding source",
    pTotalOld: "People reached, planned: total", pIdps: "IDPs", pReturnees: "Returnees", pRefugees: "Refugees", pHost: "Host community",
    pOther: "Other or not specified", pOtherOld: "Other", femalePct: "Women and girls (%)", pwdPct: "Persons with disabilities (%)",
    pwdFemalePct: "Of whom women and girls (%)", remarks: "Remarks", consent: "Consent to publish",
  };
  for (let i = 1; i <= 8; i++) COLS[`c${i}`] = `IASC ${i}.`;
  for (let i = 1; i <= 5; i++) { COLS[`donor${i}`] = `Donor ${i}`; COLS[`d${i}Amount`] = `Donor ${i} amount`; }
  const GROUPS = [["idps", "IDPs"], ["returnees", "Returnees"], ["refugees", "Refugees"], ["host", "Host community"], ["other", "Other or not specified"]];
  const SEXES = ["women", "girls", "men", "boys"];
  GROUPS.forEach(([g, gl]) => SEXES.forEach((x) => (COLS[`sx_${g}_${x}`] = `${gl}: ${x}`)));
  const STATE_FIX = { "al jazirah": "Aj Jazirah", "al jazeera": "Aj Jazirah", "gezira": "Aj Jazirah", "al gezira": "Aj Jazirah", "northern state": "Northern" };
  const LEAD_KEYS = { wlo: "WLO", women: "WLO", rlo: "RLO", refugee: "RLO", ylo: "YLO", youth: "YLO", opd: "OPD", disabilit: "OPD" };

  /* ---------- page set-up ---------- */
  SF.renderHeader("add");
  $("xl-ico").innerHTML = SF.icons.sheet;
  document.querySelectorAll(".contact-link").forEach((a) => { a.href = `mailto:${SF.config.contactEmail}`; a.textContent = SF.config.contactEmail; });
  if (!API) {
    $("lede").textContent = "Fill in the Excel template, then email it to the Durable Solutions Unit. You can upload it here first to check every row.";
    $("step3-title").textContent = "Check, then email the file";
  }

  /* ---------- reading the file ---------- */
  const txt = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
  const splitList = (v) => txt(v).split(/;|\n/).map((x) => x.trim()).filter(Boolean);
  const num = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return v; const s = String(v).replace(/[^\d.\-]/g, ""); return s === "" ? NaN : Number(s); };
  const orgLabel = (o) => (o.acronym === o.name ? o.name : `${o.acronym}, ${o.name}`);
  const findOrg = (t) => { const k = txt(t).toLowerCase(); return k ? ORGS.find((o) => o.acronym.toLowerCase() === k || o.name.toLowerCase() === k || orgLabel(o).toLowerCase() === k || (o.aliases || []).some((a) => a.toLowerCase() === k)) : null; };
  function ym(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600e3); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
    if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
    const s = txt(v);
    let m = s.match(/^(\d{4})[-/.](\d{1,2})/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, "0")}`;
    return "bad";
  }
  const yes = (v) => ["yes", "y", "x", "1", "true", "✓"].includes(txt(v).toLowerCase());
  const refPrefix = (lead) => {
    const o = findOrg(lead);
    if (o) return o.acronym.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const words = txt(lead).split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|for|the|in)$/i.test(w));
    return (words.length > 1 ? words.map((w) => w[0]).join("") : txt(lead)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "ORG";
  };

  function rowToProject(r, rowNo) {
    const errors = [], notes = [];
    const name = txt(r.name);
    if (!name) errors.push("Project name is missing");
    const itypes = splitList(r.itypes).map((x) => SF.INTERVENTION_TYPES.find((t) => t.toLowerCase() === x.toLowerCase())).filter(Boolean);
    if (!itypes.length) errors.push("Intervention type is missing or not from the list");
    const leadRaw = txt(r.lead), o = findOrg(leadRaw);
    if (!leadRaw) errors.push("Lead organisation is missing");
    const lead = o ? o.acronym : leadRaw;
    if (leadRaw && !o) notes.push("Organisation not in the list (it will be added)");
    const orgType = txt(r.orgType) || (o && o.type) || "";
    if (!orgType) errors.push("Organisation type is missing");
    const leadership = [...new Set(splitList(r.leadership).flatMap((x) => Object.entries(LEAD_KEYS).filter(([k]) => x.toLowerCase().includes(k)).map(([, v]) => v)))];
    const partners = splitList(r.partners).map((x) => { const p = findOrg(x); return p ? p.acronym : x; });
    const fpName = txt(r.fpName), fpEmail = txt(r.fpEmail);
    if (!fpName) errors.push("Focal point name is missing");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fpEmail)) errors.push("Focal point email is missing or not valid");
    const nationwide = /^nation/i.test(txt(r.scope));
    const states = [], badStates = [];
    if (!nationwide) splitList(String(r.states || "").replace(/,/g, ";")).forEach((x) => {
      const k = x.toLowerCase(), st = STATES.find((s) => s.toLowerCase() === k) || STATE_FIX[k];
      if (st) { if (!states.includes(st)) states.push(st); } else badStates.push(x);
    });
    if (badStates.length) errors.push(`State not recognised: ${badStates.join(", ")}`);
    if (!nationwide && !states.length && !badStates.length) errors.push("States are missing (or choose Nationwide)");
    const localities = nationwide ? [] : splitList(r.localities);
    const known = new Set(states.flatMap((s) => LOCALITIES[s] || []));
    const odd = localities.filter((l) => !known.has(l));
    if (odd.length) notes.push(`Locality names DSU will match to the OCHA list: ${odd.join(", ")}`);
    const criteria = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => yes(r[`c${i}`])).map(String);
    if (!criteria.length) errors.push("No IASC criterion marked Yes");
    const start = ym(r.start), end = ym(r.end);
    if (!start) errors.push("Start date is missing"); else if (start === "bad") errors.push("Start date is not in the form YYYY-MM");
    if (!end) errors.push("End date is missing"); else if (end === "bad") errors.push("End date is not in the form YYYY-MM");
    if (start && end && start !== "bad" && end !== "bad" && end < start) errors.push("End date is before the start date");
    const status = ["Ongoing", "Pipeline", "Ended"].find((s) => s.toLowerCase() === txt(r.status).toLowerCase()) || "";
    if (!status) errors.push("Status is missing (Ongoing, Pipeline or Ended)");
    const budget = num(r.budget);
    if (budget == null || isNaN(budget) || budget <= 0) errors.push("Total budget is missing or not a number");
    let share = num(r.share);
    if (share != null && !isNaN(share) && share > 0 && share <= 1 && String(r.share).indexOf("%") < 0 && !Number.isInteger(share)) share = share * 100;
    if (share == null || isNaN(share) || share < 0 || share > 100) errors.push("Durable solutions share is missing or not between 0 and 100");
    // donors, each with an amount (older copies of the template have one donor column)
    const donors = [1, 2, 3, 4, 5].map((i) => ({ name: txt(r[`donor${i}`]), amount: num(r[`d${i}Amount`]) })).filter((d) => d.name || d.amount != null);
    if (!donors.length && txt(r.donor)) donors.push({ name: txt(r.donor), amount: null });
    if (donors.some((d) => !d.name)) errors.push("A donor amount is given without the donor's name");
    if (donors.some((d) => d.amount != null && (isNaN(d.amount) || d.amount <= 0))) errors.push("A donor amount is not a number above 0");
    if (donors.length > 1 && donors.some((d) => d.amount == null)) errors.push("With more than one donor, give the amount from each");
    if (budget > 0 && donors.reduce((a, d) => a + (d.amount || 0), 0) > budget) errors.push("Donor amounts add up to more than the total budget");
    // people: five groups (the total adds them up), with an optional breakdown by women, girls, men and boys
    const people = {}, peopleSex = {};
    let bad = false, fem = 0, sexAll = 0;
    GROUPS.forEach(([g, gl]) => {
      let v = num(r[{ idps: "pIdps", returnees: "pReturnees", refugees: "pRefugees", host: "pHost", other: "pOther" }[g]]);
      if (g === "other" && v == null) v = num(r.pOtherOld);
      if (v != null && (isNaN(v) || v < 0 || !Number.isInteger(v))) bad = true;
      const row = Object.fromEntries(SEXES.map((x) => [x, num(r[`sx_${g}_${x}`])]));
      const given = SEXES.filter((x) => row[x] != null);
      if (given.some((x) => isNaN(row[x]) || row[x] < 0 || !Number.isInteger(row[x]))) bad = true;
      if (given.length && !bad) {
        const sum = given.reduce((a, x) => a + row[x], 0);
        if (v == null) v = sum;
        else if (v !== sum) errors.push(`${gl}: the breakdown adds up to ${sum.toLocaleString("en-US")}, but the ${gl} column says ${v.toLocaleString("en-US")}`);
        peopleSex[g] = Object.fromEntries(SEXES.map((x) => [x, row[x] == null ? null : row[x]]));
        fem += (row.women || 0) + (row.girls || 0); sexAll += sum;
      }
      people[g] = v == null || isNaN(v) ? null : Math.round(v);
    });
    // copies of the old template have a typed total: anything not in a group goes under "Other or not specified"
    const oldTotal = num(r.pTotalOld);
    if (oldTotal > 0) { const known = GROUPS.reduce((a, [g]) => a + (people[g] || 0), 0); if (oldTotal > known) people.other = (people.other || 0) + oldTotal - known; }
    const groupVals = GROUPS.map(([g]) => people[g]).filter((v) => v != null);
    people.total = groupVals.length ? groupVals.reduce((a, v) => a + v, 0) : null;
    if (bad) errors.push("People reached must be whole numbers");
    else if (!(people.total > 0)) errors.push("People reached is missing: fill in at least one group");
    const pctOk = (v) => v == null || (!isNaN(v) && v >= 0 && v <= 100);
    let femPct = num(r.femalePct);
    if (femPct != null && femPct > 0 && femPct <= 1 && !Number.isInteger(femPct)) femPct *= 100; // typed as a percentage cell
    if (sexAll > 0) femPct = Math.round((fem / sexAll) * 1000) / 10;
    if (femPct == null) errors.push("Women and girls (%) is missing");
    else if (!pctOk(femPct)) errors.push("Women and girls (%) is not between 0 and 100");
    const pwd = num(r.pwdPct), pwdF = num(r.pwdFemalePct);
    if (!pctOk(pwd)) errors.push("Persons with disabilities (%) is not between 0 and 100");
    if (!pctOk(pwdF)) errors.push("Of whom women and girls (%) is not between 0 and 100");
    const peopleExtra = {
      femaleShare: femPct == null || isNaN(femPct) ? null : femPct / 100,
      pwdShare: pwd == null || isNaN(pwd) ? null : pwd / 100,
      pwdFemaleShare: pwd == null || pwdF == null || isNaN(pwdF) ? null : pwdF / 100,
      peopleSex: Object.keys(peopleSex).length ? peopleSex : null,
    };
    if (!yes(r.consent)) errors.push("Consent to publish is not Yes");
    const answers = {
      name, description: txt(r.description), itypes, orgType, lead, leadName: o ? orgLabel(o) : lead, refPrefix: refPrefix(leadRaw), leadership, partners,
      scope: nationwide ? "nationwide" : "states", states, localities, criteria, coordination: txt(r.coordination),
      start: start === "bad" ? "" : start, end: end === "bad" ? "" : end, status, budget: isNaN(budget) ? null : budget, share: isNaN(share) ? null : share,
      donors: donors.filter((d) => d.name).map((d) => ({ name: d.name, amount: d.amount == null || isNaN(d.amount) ? null : d.amount })),
      donor: donors.map((d) => d.name).filter(Boolean).join("; "), people, peopleExtra, remarks: txt(r.remarks),
    };
    return { row: rowNo, answers, private: { fpName, fpEmail }, errors, notes };
  }

  async function readFile(file) {
    const err = $("xl-err");
    err.hidden = true;
    $("sent").hidden = true;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets.Projects || wb.Sheets[wb.SheetNames.find((n) => /project/i.test(n)) || ""];
      if (!ws) throw new Error("This file has no Projects sheet. Please use the Solutions Footprint template.");
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
      const hi = grid.findIndex((r) => r.some((c) => /^project or programme name/i.test(txt(c))));
      if (hi < 0) throw new Error("The header row was not found. Please use the Solutions Footprint template and keep its first row.");
      const head = grid[hi].map((h) => txt(h).replace(/\s*\*$/, "").toLowerCase());
      const idx = {};
      Object.entries(COLS).forEach(([k, label]) => {
        const l = label.toLowerCase();
        let i = head.findIndex((h) => h === l);
        if (i < 0 && !/old$/i.test(k)) i = head.findIndex((h) => h.startsWith(l) && !/: (women|girls|men|boys)$/.test(h) && !/ amount/.test(h.slice(l.length)));
        if (i >= 0) idx[k] = i;
      });
      ROWS = [];
      grid.slice(hi + 1).forEach((cells, j) => {
        const r = {};
        Object.entries(idx).forEach(([k, i]) => (r[k] = cells[i]));
        // skip empty rows and notes (a row with nothing but text in the first column)
        if (!txt(r.lead) && !txt(r.budget) && !txt(r.fpEmail) && !txt(r.states) && !txt(r.orgType)) return;
        if (/^example/i.test(txt(r.name))) return;
        ROWS.push(rowToProject(r, hi + j + 2)); // Excel row number
      });
      $("xl-label").innerHTML = `<b>${esc(file.name)}</b><br><small>${ROWS.length} project row${ROWS.length === 1 ? "" : "s"} read · Choose another file</small>`;
      if (!ROWS.length) throw new Error("No projects were found in the file. Fill in one row per project, from row 2.");
      drawRows();
    } catch (e) {
      err.hidden = false; err.textContent = e.message || "The file could not be read.";
      $("rows-card").hidden = true; $("send-row").hidden = true; $("photo-note-m").hidden = true;
    }
  }

  function drawRows() {
    const ready = ROWS.filter((r) => !r.errors.length), bad = ROWS.length - ready.length;
    $("rows-card").hidden = false;
    $("rows-sum").innerHTML = `<span class="pill-ok">${ready.length} ready</span>${bad ? ` <span class="pill-bad">${bad} need fixing</span>` : ""}`;
    $("rows-body").innerHTML = ROWS.map((r) => {
      const a = r.answers;
      const check = r.errors.length ? `<span class="row-bad">${r.errors.map(esc).join("<br>")}</span>`
        : `<span class="pill-ok">Ready</span>${r.notes.length ? `<br><small class="row-note">${r.notes.map(esc).join("<br>")}</small>` : ""}`;
      return `<tr class="${r.errors.length ? "bad" : ""}"><td>${r.row}</td><td>${esc(a.name || "(no name)")}</td><td>${esc(a.lead)}</td>
        <td>${esc(a.scope === "nationwide" ? "Nationwide" : a.states.join(", "))}</td>
        <td style="white-space:nowrap">${a.start && a.end ? `${SF.fmtMonth(SF.parseDate(a.start))} to ${SF.fmtMonth(SF.parseDate(a.end))}` : ""}</td>
        <td>${a.budget ? SF.fmtUSD(a.budget) : ""}</td><td>${check}</td></tr>`;
    }).join("");
    if (API) {
      $("step3").innerHTML = `<p>${ready.length} of ${ROWS.length} rows are ready.${bad ? " Rows that need fixing are not sent: fix them in the file and upload it again." : ""}</p>`;
      $("send-row").hidden = !ready.length;
      $("photo-note-m").hidden = !ready.length;
      $("send-btn").textContent = `Send ${ready.length} project${ready.length === 1 ? "" : "s"} to the Durable Solutions Unit`;
      $("send-hint").textContent = "Each project gets its own number.";
      renderTurnstile();
    } else {
      $("step3").innerHTML = `<p>${bad ? `Please fix the ${bad} row${bad === 1 ? "" : "s"} marked in red, then ` : "All rows look good. "}email the file to the Durable Solutions Unit.</p>
        <a class="btn btn-primary" href="mailto:${SF.config.contactEmail}?subject=${encodeURIComponent("Projects for the Solutions Footprint (Excel template)")}&body=${encodeURIComponent("Please find attached our projects for the Solutions Footprint, in the Excel template.\r\n\r\n(Attach the file before sending.)")}">Write the email</a>`;
    }
  }

  function renderTurnstile() {
    const key = SF.config.turnstileSiteKey;
    if (!key || tsWidget !== null) return;
    const go = () => { tsWidget = window.turnstile.render("#ts-box", { sitekey: key }); };
    if (window.turnstile) return go();
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    sc.async = true; sc.onload = go;
    document.head.appendChild(sc);
  }

  async function send() {
    const ready = ROWS.filter((r) => !r.errors.length);
    if (!ready.length) return;
    const btn = $("send-btn"), err = $("xl-err"), label = btn.textContent;
    btn.disabled = true; btn.textContent = "Sending...";
    err.hidden = true;
    try {
      const r = await fetch(`${API}/api/submit-batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: ready.map(({ row, answers, private: p }) => ({ row, answers, private: p })), website: $("website").value,
          turnstile: tsWidget !== null && window.turnstile ? window.turnstile.getResponse(tsWidget) : "" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `the server answered ${r.status}`);
      const now = Date.now();
      const good = j.items.filter((i) => i.ok), failed = j.items.filter((i) => !i.ok);
      good.forEach((it, k) => {
        const row = ready.find((x) => x.row === it.row);
        SF.render.saveSubmission({ savedAt: new Date(now + k).toISOString(), sent: "direct", source: "excel", id: it.id, token: it.token, ref: it.ref, photos: 0, answers: row.answers });
      });
      $("sent-title").textContent = `Received: ${good.length} project${good.length === 1 ? "" : "s"}. Thank you.`;
      $("sent-list").innerHTML = good.map((it) => `<li><b>${esc(it.ref)}</b> ${esc(ready.find((x) => x.row === it.row).answers.name)}</li>`).join("") +
        failed.map((it) => `<li class="row-bad">Row ${it.row} was not sent: ${esc(it.error)}</li>`).join("");
      $("sent").hidden = false;
      $("send-row").hidden = true; $("rows-card").hidden = true; $("photo-note-m").hidden = true;
      $("sent").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      err.hidden = false;
      err.innerHTML = `The projects could not be sent (${esc(e.message)}). Please try again, or email the file to <a href="mailto:${SF.config.contactEmail}">${SF.config.contactEmail}</a>.`;
      if (tsWidget !== null && window.turnstile) window.turnstile.reset(tsWidget);
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  $("xl-in").addEventListener("change", (e) => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ""; });
  $("send-btn").addEventListener("click", send);

  Promise.all([SF.loadJSON(SF.config.orgsUrl).catch(() => ({ organisations: [] })), SF.loadJSON(SF.config.localitiesUrl).catch(() => ({ states: {} })), SF.loadJSON(SF.config.dataUrl).catch(() => null)])
    .then(([orgs, locs, data]) => { ORGS = orgs.organisations || []; LOCALITIES = locs.states || {}; SF.renderFooter(data && data.lastUpdated); });
})();
