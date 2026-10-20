/* "Add your project" form. Sends the project straight to the Durable Solutions Unit when the back end
   is switched on (SF.config.apiUrl), otherwise builds an email to the DSWG mailbox. */
"use strict";

(() => {
  const { esc, CRITERIA, STATES } = SF;
  const form = document.getElementById("project-form");
  const $ = (id) => document.getElementById(id);
  let correcting = null;
  let ORGS = [], LOCALITIES = {}, GEO = null, PUBLISHED = [], REFS = {};
  let assignedRef = "";
  let partners = [];
  const API = String(SF.config.apiUrl || "").replace(/\/$/, "");
  let photos = [], logo = null, tsWidget = null;

  /* ---------- static lists ---------- */
  $("itypes").innerHTML = SF.INTERVENTION_TYPES.map((t, i) =>
    `<label><input type="checkbox" name="itypes" value="${esc(t)}" id="it-${i}"> ${esc(t)}</label>`).join("");
  $("states").innerHTML = STATES.map((s, i) =>
    `<label><input type="checkbox" name="states" value="${esc(s)}" id="st-${i}"> ${esc(s)}</label>`).join("");
  $("criteria").innerHTML = CRITERIA.map((c) =>
    `<label class="crit-opt"><input type="checkbox" name="criteria" value="${c.n}"><span class="ci" style="background:${c.color}">${SF.critIcon(c.n)}</span>
      <span><b>${c.n}. ${esc(c.name)} <span class="tip crit-tip"><button type="button" class="tip-btn" aria-label="What ${esc(c.name)} means" aria-describedby="cb-${c.n}">i</button><span class="tip-pop" role="tooltip" id="cb-${c.n}"><b>What this means</b>${esc(c.brief)}</span></span></b><small>${esc(c.hint)}</small></span></label>`).join("");
  // the "i" opens a short explanation in a pop-up; it must not tick the box
  $("criteria").addEventListener("click", (e) => {
    const b = e.target.closest(".crit-tip");
    if (!b) return;
    e.preventDefault();
    b.querySelector(".tip-btn").focus();
  });
  $("iasc-source").innerHTML = `Source: <a href="${SF.IASC_SOURCE.url}" target="_blank" rel="noopener">${esc(SF.IASC_SOURCE.label)}</a>`;
  $("coordination").innerHTML += SF.COORDINATION_OPTIONS.map((o) => `<option>${esc(o)}</option>`).join("");
  $("orgType").innerHTML += SF.ORG_TYPES.map((o) => `<option>${esc(o.key)}</option>`).join("");
  $("leadership").innerHTML = SF.LEADERSHIP.map((l) => `<label><input type="checkbox" name="leadership" value="${l.key}"> ${esc(l.label)}</label>`).join("") +
    `<label><input type="checkbox" name="leadership" value="none"> None of these</label>`;
  const PEOPLE = [{ key: "total", label: "Total" }, ...SF.TARGET_GROUPS];
  // the groups first, then the total, which adds them up and cannot be typed in
  $("people").innerHTML = [...SF.TARGET_GROUPS, PEOPLE[0]].map((g) => g.key === "total"
    ? `<div class="fld"><label for="pp-total">Total</label><input class="input readonly" id="pp-total" name="pp-total" readonly tabindex="-1" placeholder="Adds up"></div>`
    : `<div class="fld"><label for="pp-${g.key}">${g.label}</label><input class="input" id="pp-${g.key}" name="pp-${g.key}" inputmode="numeric" autocomplete="off"></div>`).join("");
  const SEX = [{ key: "women", label: "Women" }, { key: "girls", label: "Girls" }, { key: "men", label: "Men" }, { key: "boys", label: "Boys" }];
  $("sex-tbl").innerHTML = `<thead><tr><th scope="col">Group</th>${SEX.map((x) => `<th scope="col">${x.label}</th>`).join("")}<th scope="col">Group total</th></tr></thead><tbody>${SF.TARGET_GROUPS.map((g) =>
    `<tr><th scope="row">${g.label}</th>${SEX.map((x) => `<td><input class="input" id="sx-${g.key}-${x.key}" inputmode="numeric" autocomplete="off" aria-label="${g.label}: ${x.label.toLowerCase()}"></td>`).join("")}<td class="sx-sum" id="sx-${g.key}-sum"></td></tr>`).join("")}</tbody>`;
  document.querySelectorAll(".contact-email").forEach((e) => (e.textContent = SF.config.contactEmail));
  document.querySelectorAll(".contact-link").forEach((a) => { a.href = `mailto:${SF.config.contactEmail}`; a.textContent = SF.config.contactEmail; });
  $("hdx-link").href = SF.config.hdxAdminUrl;
  $("multi-ico").innerHTML = SF.icons.sheet;
  $("photo-ico").innerHTML = SF.icon("photo");
  if (API) {
    $("photo-note").hidden = true;
    $("photo-box").hidden = false;
    $("photo-ico2").innerHTML = SF.icon("photo");
    $("flow-1").textContent = "Your answers and photos go straight to the Unit. No email to write.";
    $("next-1").textContent = "After a preview, press Send. Your answers and photos go straight to the Unit; no email needed.";
    $("next-3").textContent = "Once approved, the project appears on the map. Its status changes to Published under My submissions.";
  }

  /* ---------- helpers ---------- */
  const digits = (v) => String(v || "").replace(/[^\d.]/g, "");
  const num = (v) => {
    const s = digits(v);
    if (s === "") return null;
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  };
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const scope = () => (form.querySelector('input[name="scope"]:checked') || {}).value || "";
  const monthOk = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  const fmtMonthValue = (v) => {
    if (!monthOk(v)) return v;
    const [y, m] = v.split("-").map(Number);
    return SF.fmtMonth(new Date(y, m - 1, 1));
  };
  const orgLabel = (o) => (o.acronym === o.name ? o.name : `${o.acronym}, ${o.name}`);
  const findOrg = (txt) => {
    const t = (txt || "").trim().toLowerCase();
    return ORGS.find((o) => o.acronym.toLowerCase() === t || o.name.toLowerCase() === t || orgLabel(o).toLowerCase() === t || (o.aliases || []).some((a) => a.toLowerCase() === t));
  };

  /* ---------- organisation type, then name ---------- */
  function fillLead(type, value) {
    const sel = $("lead");
    if (!type) { sel.disabled = true; sel.innerHTML = `<option value="">Choose the organisation type first</option>`; syncLead(); return; }
    const list = ORGS.filter((o) => o.type === type);
    sel.disabled = false;
    sel.innerHTML = `<option value="">Choose one</option>` + list.map((o) => `<option value="${esc(o.acronym)}">${esc(orgLabel(o))}</option>`).join("") +
      `<option value="__other">Other (not listed)</option>`;
    if (value) sel.value = value;
    syncLead();
  }
  function syncLead() {
    const other = $("lead").value === "__other";
    $("lead-other-fld").hidden = !other;
    const t = $("orgType").value;
    $("leadership-fld").hidden = !(t === "National NGO" || t === "Other");
    if ($("leadership-fld").hidden) form.querySelectorAll('input[name="leadership"]').forEach((i) => (i.checked = false));
    syncLogo();
  }
  $("orgType").addEventListener("change", () => fillLead($("orgType").value));
  $("lead").addEventListener("change", syncLead);
  $("leadership").addEventListener("change", (e) => {
    if (e.target.value === "none" && e.target.checked) form.querySelectorAll('input[name="leadership"]:not([value="none"])').forEach((i) => (i.checked = false));
    else if (e.target.checked) form.querySelector('input[name="leadership"][value="none"]').checked = false;
  });
  const leadName = () => ($("lead").value === "__other" ? $("leadOther").value.trim() : $("lead").value);

  /* ---------- photos and logo (only when the back end is on) ---------- */
  function drawPhotos() {
    $("photo-list").innerHTML = photos.map((p, i) => `<div class="photo-item"><img src="${p.url}" alt="Photo ${i + 1}"><div><span>${esc(p.name)}</span>
      <span class="shrunk">${p.origSize > p.size ? `${SF.fmtSize(p.origSize)} made smaller to ${SF.fmtSize(p.size)}` : SF.fmtSize(p.size)}</span>
      <button type="button" data-rm="${i}">Remove</button></div></div>`).join("");
    $("photo-list").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { photos.splice(Number(b.dataset.rm), 1); drawPhotos(); }));
    document.querySelector('label[for="photo-in"]').hidden = photos.length >= 3;
  }
  $("photo-in").addEventListener("change", async (e) => {
    const err = $("photo-err"); err.hidden = true;
    const files = [...e.target.files];
    if (files.length > 3 - photos.length) { err.hidden = false; err.textContent = `Up to 3 photos. The first ${3 - photos.length} were added.`; }
    for (const f of files.slice(0, 3 - photos.length)) {
      try { photos.push(await SF.shrinkImage(f)); }
      catch (x) { err.hidden = false; err.textContent = x.message; }
    }
    e.target.value = "";
    drawPhotos();
  });
  function syncLogo() {
    const show = !!API && !!leadKey() && isNewOrg();
    $("logo-box").hidden = !show;
    $("logo-prev").innerHTML = logo ? `<img src="${logo.url}" alt="Logo">` : esc(leadKey().slice(0, 5));
    $("logo-rm").hidden = !logo;
  }
  $("logo-in").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { logo = await SF.shrinkImage(f, { keepPng: true, maxSide: 800 }); } catch (x) { alert(x.message); }
    e.target.value = "";
    syncLogo();
  });
  $("logo-rm").addEventListener("click", () => { logo = null; syncLogo(); });
  $("leadOther").addEventListener("input", syncLogo);

  /* ---------- implementing partners (pick from the list or type) ---------- */
  function renderPartners() {
    const box = $("partner-box"), input = $("partner-input");
    box.querySelectorAll(".ch").forEach((c) => c.remove());
    partners.forEach((p, i) => {
      const ch = document.createElement("span");
      ch.className = "ch";
      ch.innerHTML = `${esc(p)}<button type="button" aria-label="Remove ${esc(p)}">&times;</button>`;
      ch.querySelector("button").addEventListener("click", () => { partners.splice(i, 1); renderPartners(); });
      box.insertBefore(ch, input);
    });
  }
  function addPartner(txt) {
    const t = (txt || "").replace(/,$/, "").trim();
    if (!t) return;
    const o = findOrg(t);
    const name = o ? o.acronym : t;
    if (!partners.includes(name)) partners.push(name);
    $("partner-input").value = "";
    renderPartners();
  }
  $("partner-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addPartner(e.target.value); }
    else if (e.key === "Backspace" && !e.target.value && partners.length) { partners.pop(); renderPartners(); }
  });
  $("partner-input").addEventListener("input", (e) => { if (findOrg(e.target.value) && e.inputType === "insertReplacementText") addPartner(e.target.value); });
  $("partner-input").addEventListener("change", (e) => { if (findOrg(e.target.value)) addPartner(e.target.value); });
  $("partner-box").addEventListener("click", () => $("partner-input").focus());

  /* ---------- states and localities ---------- */
  function renderLocalities(keep) {
    const host = $("loc-groups");
    const prev = keep || checked("localities");
    const nw = scope() === "nationwide";
    const sts = nw ? [] : checked("states");
    host.innerHTML = sts.map((st) => {
      const list = LOCALITIES[st] || [];
      return `<fieldset class="loc-group"><legend>${esc(st)}</legend>
        <p class="loc-tools"><button type="button" class="link-btn" data-all="${esc(st)}">Select all</button> &nbsp; <button type="button" class="link-btn" data-none="${esc(st)}">Clear</button></p>
        <div class="loc-grid">${list.map((l) => `<label><input type="checkbox" name="localities" value="${esc(l)}" data-state="${esc(st)}"${prev.includes(l) ? " checked" : ""}> ${esc(l)}</label>`).join("")}</div>
      </fieldset>`;
    }).join("");
    $("loc-help").textContent = nw ? "Localities cannot be chosen for nationwide projects." : sts.length ? "Tick the localities where the project works, if you know them." : "Choose the states first; their localities appear here.";
    $("loc-fld").classList.toggle("is-disabled", nw);
    host.querySelectorAll("[data-all],[data-none]").forEach((b) => b.addEventListener("click", () => {
      const st = b.dataset.all || b.dataset.none;
      host.querySelectorAll(`input[data-state="${CSS.escape(st)}"]`).forEach((i) => (i.checked = !!b.dataset.all));
    }));
  }
  function syncScope() {
    const nw = scope() === "nationwide";
    $("states-fld").classList.toggle("is-disabled", nw);
    $("states-req").hidden = nw;
    form.querySelectorAll('input[name="states"]').forEach((i) => { i.disabled = nw; if (nw) i.checked = false; });
    renderLocalities();
  }
  form.querySelectorAll('input[name="scope"]').forEach((r) => r.addEventListener("change", syncScope));
  $("states").addEventListener("change", () => {
    if (!scope()) form.querySelector('input[name="scope"][value="states"]').checked = true;
    renderLocalities();
  });

  /* ---------- donors, each with an amount ---------- */
  function donorRow(name = "", amount = "") {
    const row = document.createElement("div");
    row.className = "donor-row";
    const n = $("donor-rows").children.length + 1;
    row.innerHTML = `<input class="input" name="donorName" placeholder="Donor ${n}" aria-label="Donor ${n}" autocomplete="off" value="${esc(name)}">
      <div class="affix"><span class="pre">$</span><input class="input" name="donorAmount" inputmode="numeric" placeholder="Amount (USD)" aria-label="Amount from donor ${n} in US dollars" autocomplete="off" value="${esc(amount)}"></div>
      <button type="button" class="rm" aria-label="Remove donor ${n}">&times;</button>`;
    row.querySelector('[name="donorAmount"]').addEventListener("input", (e) => {
      const raw = e.target.value.replace(/[^\d]/g, "");
      e.target.value = raw ? Number(raw).toLocaleString("en-US") : "";
      syncDonors();
    });
    row.querySelector('[name="donorName"]').addEventListener("input", syncDonors);
    row.querySelector(".rm").addEventListener("click", () => { row.remove(); if (!$("donor-rows").children.length) donorRow(); syncDonors(); updateLive(); });
    $("donor-rows").appendChild(row);
    syncDonors();
    return row;
  }
  const donorEntries = () => [...$("donor-rows").querySelectorAll(".donor-row")].map((r) => ({
    name: r.querySelector('[name="donorName"]').value.trim(),
    amount: num(r.querySelector('[name="donorAmount"]').value),
  }));
  const donorsGiven = () => donorEntries().filter((d) => d.name || d.amount != null);
  function syncDonors() {
    const rows = [...$("donor-rows").children];
    rows.forEach((r) => (r.querySelector(".rm").hidden = rows.length === 1 && !r.querySelector("input").value));
    $("add-donor").hidden = rows.length >= SF.MAX_DONORS; // up to 5 donors per project
    const ds = donorsGiven(), b = num($("budget").value), sum = ds.reduce((a, d) => a + (d.amount || 0), 0);
    const box = $("donor-sum");
    box.classList.toggle("over", !!(b && sum > b));
    box.textContent = ds.length > 1 && sum > 0 ? `Donors add up to ${SF.fmtUSD(sum)}${b ? ` of the ${SF.fmtUSD(b)} total budget` : ""}${b && sum > b ? ", which is more than the budget" : ""}.` : "";
    $("donors-help").textContent = ds.length > 1 ? "With more than one donor, give the amount from each." : "If more than one donor funds the project, add each one with the amount it gives.";
  }
  $("add-donor").addEventListener("click", () => { const r = donorRow(); r.querySelector("input").focus(); });
  donorRow();

  /* ---------- budget and share ---------- */
  function fmtBudgetInput() {
    const el = $("budget");
    const raw = el.value.replace(/[^\d]/g, "");
    el.value = raw ? Number(raw).toLocaleString("en-US") : "";
    updateDS();
    syncDonors();
  }
  function updateDS() {
    const b = num($("budget").value), s = num($("share").value);
    $("dsAmount").value = b > 0 && s >= 0 && s <= 100 ? SF.fmtUSD((b * s) / 100) : "Calculated automatically";
  }
  $("budget").addEventListener("input", fmtBudgetInput);
  $("share").addEventListener("input", () => {
    const el = $("share");
    let v = el.value.replace(/[^\d.]/g, "");
    if (Number(v) > 100) v = "100";
    el.value = v;
    updateDS();
  });


  /* ---------- people: the total adds up the groups; optional breakdown by women, girls, men and boys ---------- */
  const fmtN = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"));
  const sexCell = (g, x) => num($(`sx-${g}-${x}`).value);
  function syncPeople() {
    let fem = 0, all = 0, anySex = false;
    SF.TARGET_GROUPS.forEach((g) => {
      const cells = SEX.map((x) => sexCell(g.key, x.key));
      const has = cells.some((v) => v != null);
      const sum = cells.reduce((a, v) => a + (v > 0 ? v : 0), 0);
      const inp = $(`pp-${g.key}`);
      // a group with a breakdown takes its number from the breakdown
      inp.readOnly = has; inp.classList.toggle("readonly", has); inp.tabIndex = has ? -1 : 0;
      if (has) inp.value = fmtN(sum);
      $(`sx-${g.key}-sum`).textContent = has ? fmtN(sum) : "";
      if (has) { anySex = true; fem += (cells[0] > 0 ? cells[0] : 0) + (cells[1] > 0 ? cells[1] : 0); all += sum; }
    });
    const groups = SF.TARGET_GROUPS.map((g) => num($(`pp-${g.key}`).value)).filter((v) => v != null && !isNaN(v));
    $("pp-total").value = groups.length ? fmtN(groups.reduce((a, v) => a + v, 0)) : "";
    if ($("pp-pwd")) syncPwd();
    // share of women and girls: from the breakdown when there is one, otherwise typed in
    const f = $("pp-female");
    f.readOnly = anySex; f.classList.toggle("readonly", anySex); f.tabIndex = anySex ? -1 : 0;
    if (anySex) f.value = all ? String(Math.round((fem / all) * 1000) / 10) : "";
    const v = f.value;
    $("pp-male").value = v === "" ? "Calculated automatically" : `${Math.round((100 - Number(v)) * 10) / 10}%`;
    const tot = num($("pp-total").value) || 0;
    $("female-note").textContent = anySex ? (all < tot ? `Calculated from the breakdown: ${fmtN(all)} of the ${fmtN(tot)} people` : "Calculated from the breakdown") : "";
  }
  // the extra people figures, as shares from 0 to 1, plus the breakdown when there is one
  function peopleExtra() {
    const sh = (id) => { const v = num($(id).value); return v == null || isNaN(v) ? null : Math.min(100, Math.max(0, v)) / 100; };
    const sex = {};
    SF.TARGET_GROUPS.forEach((g) => {
      const row = Object.fromEntries(SEX.map((x) => [x.key, okNum($(`sx-${g.key}-${x.key}`).value)]));
      if (Object.values(row).some((v) => v != null)) sex[g.key] = row;
    });
    return { femaleShare: sh("pp-female"), pwdShare: sh("pp-pwd"), pwdFemaleShare: $("pp-pwd").value ? sh("pp-pwd-f") : null, peopleSex: Object.keys(sex).length ? sex : null };
  }
  function peopleEmailLines() {
    const x = peopleExtra(), pc = (v) => (v == null ? "" : `${Math.round(v * 1000) / 10}%`);
    const lines = [`Women and girls: ${pc(x.femaleShare)}`, `Persons with disabilities: ${pc(x.pwdShare)}${x.pwdFemaleShare != null ? ` (of whom women and girls: ${pc(x.pwdFemaleShare)})` : ""}`];
    if (x.peopleSex) Object.entries(x.peopleSex).forEach(([g, r]) => lines.push(`${(SF.TARGET_GROUPS.find((t) => t.key === g) || {}).label}: women ${r.women ?? ""}, girls ${r.girls ?? ""}, men ${r.men ?? ""}, boys ${r.boys ?? ""}`));
    return lines;
  }
  let submitted = false;
  function checkPeople() {
    const vals = [...SF.TARGET_GROUPS.map((g) => num($(`pp-${g.key}`).value)), ...SF.TARGET_GROUPS.flatMap((g) => SEX.map((x) => sexCell(g.key, x.key)))];
    const total = num($("pp-total").value);
    const bad = [...SF.TARGET_GROUPS.map((g) => $(`pp-${g.key}`)), ...$("sex-tbl").querySelectorAll("input")].some((i) => i.value.trim() && !/^[\d,\s]+$/.test(i.value.trim()));
    const msg = bad || vals.some((x) => x != null && (isNaN(x) || x < 0 || !Number.isInteger(x))) ? "People reached must be whole numbers, for example 1,250."
      : submitted && !(total > 0) ? "Enter the number of people reached in at least one group. If you only know the total, enter it under \"Other or not specified\"." : "";
    $("people-err").hidden = !msg;
    $("people-err").textContent = msg;
    $("people").closest(".fld").classList.toggle("has-err", !!msg);
    return msg;
  }
  // whole numbers get thousands separators; anything else (such as 12.5) is left as typed, so the check can flag it
  const fmtCell = (e) => { if (e.target.matches("#people input, #sex-tbl input")) { const raw = e.target.value.replace(/[,\s]/g, ""); if (/^\d+$/.test(raw)) e.target.value = Number(raw).toLocaleString("en-US"); } };
  ["people", "sex-tbl"].forEach((id) => {
    $(id).addEventListener("input", (e) => { fmtCell(e); syncPeople(); if (!$("people-err").hidden) checkPeople(); });
    $(id).addEventListener("change", checkPeople);
  });
  $("sex-toggle").addEventListener("click", () => {
    const box = $("sex-box"), open = box.hidden;
    if (!open && SF.TARGET_GROUPS.some((g) => SEX.some((x) => sexCell(g.key, x.key) != null)) && !confirm("Remove the breakdown by women, girls, men and boys?")) return;
    box.hidden = !open;
    if (!open) { $("sex-tbl").querySelectorAll("input").forEach((i) => (i.value = "")); syncPeople(); }
    $("sex-toggle").setAttribute("aria-expanded", String(open));
    $("sex-toggle").textContent = open ? "Remove the breakdown" : "+ Add a breakdown by women, girls, men and boys (optional)";
  });
  // persons with disabilities: share of the total, then the share of women and girls among them
  const pct = (e) => { let v = e.target.value.replace(/[^\d.]/g, ""); if (Number(v) > 100) v = "100"; e.target.value = v; return v; };
  function syncPwd() {
    const v = $("pp-pwd").value, f = $("pp-pwd-f").value, tot = num($("pp-total").value);
    $("pp-pwd-f").disabled = v === "";
    if (v === "") $("pp-pwd-f").value = "";
    $("pp-pwd-m").value = v === "" || f === "" ? "Calculated automatically" : `${Math.round((100 - Number(f)) * 10) / 10}%`;
    $("pwd-note").textContent = v !== "" && tot ? `About ${fmtN(Math.round((tot * Number(v)) / 100))} of the ${fmtN(tot)} people` : "";
  }
  $("pp-pwd").addEventListener("input", (e) => { pct(e); syncPwd(); });
  $("pp-pwd-f").addEventListener("input", (e) => { pct(e); syncPwd(); });
  $("pp-female").addEventListener("input", (e) => {
    let v = e.target.value.replace(/[^\d.]/g, "");
    if (Number(v) > 100) v = "100";
    e.target.value = v;
    syncPeople();
  });

  /* ---------- validation ---------- */
  function validate() {
    submitted = true;
    const errors = [];
    const add = (f, msg) => errors.push({ f, msg });
    const v = (id) => $(id).value.trim();
    if (!v("name")) add("name", "Enter the project or programme name.");
    if (!checked("itypes").length) add("itypes", "Choose at least one intervention type.");
    if (!v("orgType")) add("orgType", "Choose the organisation type.");
    if (!v("lead")) add("lead", "Choose the lead organisation.");
    if ($("lead").value === "__other" && !v("leadOther")) add("leadOther", "Enter the name of the organisation.");
    if (!v("fpName")) add("fpName", "Enter the focal point's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("fpEmail"))) add("fpEmail", "Enter a valid focal point email address.");
    if (!scope()) add("scope", "Choose the geographic scope.");
    if (scope() === "states" && !checked("states").length) add("states", "Choose at least one state.");
    if (!checked("criteria").length) add("criteria", "Choose at least one IASC criterion.");
    if (!monthOk(v("start"))) add("start", "Choose the start month and year.");
    if (!monthOk(v("end"))) add("end", "Choose the end month and year.");
    if (monthOk(v("start")) && monthOk(v("end")) && v("end") < v("start")) add("end", "The end date must be after the start date.");
    if (!v("status")) add("status", "Choose the status.");
    const b = num(v("budget"));
    if (b == null || isNaN(b) || b <= 0) add("budget", "Enter the total budget in US dollars, as a number above 0.");
    const s = num(v("share"));
    if (s == null || isNaN(s) || s < 0 || s > 100) add("share", "Enter the share as a number from 0 to 100.");
    const ds = donorsGiven();
    if (ds.some((d) => !d.name)) add("donors", "Enter the name of each donor, or remove the empty row.");
    else if (ds.some((d) => d.amount != null && (isNaN(d.amount) || d.amount <= 0))) add("donors", "Donor amounts must be numbers above 0.");
    else if (ds.length > 1 && ds.some((d) => d.amount == null)) add("donors", "With more than one donor, enter the amount from each donor.");
    else if (b > 0 && ds.reduce((a, d) => a + (d.amount || 0), 0) > b) add("donors", "The donor amounts add up to more than the total budget.");
    const peopleErr = checkPeople();
    if (peopleErr) add("people", peopleErr);
    const fem = num($("pp-female").value);
    if (fem == null) add("female", "Enter the share of women and girls (0 to 100), or add the breakdown by women, girls, men and boys.");
    else if (isNaN(fem) || fem < 0 || fem > 100) add("female", "Enter the share of women and girls as a number from 0 to 100.");
    const pwd = num($("pp-pwd").value), pwdF = num($("pp-pwd-f").value);
    if (pwd != null && (isNaN(pwd) || pwd < 0 || pwd > 100)) add("pwd", "Enter the share of persons with disabilities as a number from 0 to 100.");
    if (pwdF != null && (isNaN(pwdF) || pwdF < 0 || pwdF > 100)) add("pwdFemale", "Enter the share of women and girls among persons with disabilities as a number from 0 to 100.");
    if (!$("consent").checked) add("consent", "Confirm the information can be published.");

    form.querySelectorAll(".fld").forEach((f) => { f.classList.remove("has-err"); f.querySelector(".err[data-gen]")?.remove(); });
    errors.forEach((e) => {
      const fld = form.querySelector(`[data-f="${e.f}"]`);
      if (!fld) return;
      fld.classList.add("has-err");
      if (fld.querySelector("#people-err")) return; // this field shows its own message
      const m = document.createElement("div");
      m.className = "err"; m.dataset.gen = "1"; m.textContent = e.msg;
      fld.appendChild(m);
    });
    const sum = $("error-summary");
    if (errors.length) {
      sum.innerHTML = `<strong>Please check ${errors.length} field${errors.length === 1 ? "" : "s"}:</strong><ul style="margin:6px 0 0;padding-left:20px">${errors.map((e) => `<li>${esc(e.msg)}</li>`).join("")}</ul>`;
      sum.hidden = false;
      sum.querySelectorAll("li").forEach((li, i) => {
        const f = errors[i].f;
        li.innerHTML = `<a href="#" data-goto="${f}">${li.textContent}</a>`;
      });
      sum.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); goTo(a.dataset.goto); }));
      goTo(errors[0].f);
    } else sum.hidden = true;
    return errors.length === 0;
  }

  // take the person straight to a field with an error
  function goTo(f) {
    const fld = form.querySelector(`[data-f="${f}"]`);
    if (!fld) return;
    fld.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = fld.querySelector("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea");
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 350);
  }
  // month and year drop-downs fill the hidden YYYY-MM value
  const syncYM = (k) => { const m = $(`${k}-m`).value, y = $(`${k}-y`).value; $(k).value = m && y ? `${y}-${m}` : ""; };
  const setYM = (k, v) => {
    const [y, m] = (v || "").split("-"), sel = $(`${k}-y`);
    // A project being corrected may start before the first year in the list: add that year
    if (y && ![...sel.options].some((o) => o.value === y)) sel.insertBefore(new Option(y, y), sel.options[1]);
    sel.value = y || ""; $(`${k}-m`).value = m || ""; syncYM(k); };
  ["start", "end"].forEach((k) => ["m", "y"].forEach((x) => $(`${k}-${x}`).addEventListener("change", () => syncYM(k))));

  // clear a field's error as soon as it is changed
  const clearErr = (e) => {
    const fld = e.target.closest(".fld.has-err");
    if (!fld || fld.dataset.f === "people") return; // the people check updates itself
    fld.classList.remove("has-err");
    fld.querySelector(".err[data-gen]")?.remove();
  };
  form.addEventListener("input", clearErr);
  form.addEventListener("change", clearErr);

  /* ---------- answers as a project (for the previews) ---------- */
  const okNum = (v) => { const n = num(v); return n == null || isNaN(n) ? null : n; };
  const leadKey = () => ($("lead").value === "__other" ? $("leadOther").value.trim() : $("lead").value);
  const isNewOrg = () => { const k = leadKey(); return !!k && !SF.LOGOS[k]; };
  function answers() {
    const o = findOrg($("lead").value);
    return {
      name: $("name").value.trim(), description: $("description").value.trim(), itypes: checked("itypes"),
      orgType: $("orgType").value, lead: leadKey(), leadName: o ? orgLabel(o) : leadKey(), leadership: checked("leadership"),
      partners: partners.slice(), scope: scope(), states: checked("states"), localities: checked("localities"),
      criteria: checked("criteria"), coordination: $("coordination").value, start: monthOk($("start").value) ? $("start").value : "",
      end: monthOk($("end").value) ? $("end").value : "", status: $("status").value, budget: okNum($("budget").value),
      share: okNum($("share").value), donors: donorsGiven().filter((d) => d.name), donor: donorsGiven().map((d) => d.name).filter(Boolean).join("; "),
      people: Object.fromEntries(PEOPLE.map((g) => [g.key, okNum($(`pp-${g.key}`).value)])), peopleExtra: peopleExtra(), remarks: $("remarks").value.trim(),
    };
  }
  const logoNote = () => `${SF.icon("photo").replace("<svg ", '<svg style="width:20px;height:20px;flex:none" ')}<span><b>First project from ${esc(leadKey())}?</b> ${API
    ? "Add your organisation's logo in section 7 (Photos and anything else), so it appears on the map."
    : "Please attach your organisation's logo (PNG or SVG) to the email, so it appears on the map."}</span>`;

  /* live preview card in the right-hand column */
  let liveTimer;
  function updateLive() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      const p = SF.render.fromAnswers(answers());
      $("live-body").innerHTML = SF.render.card(p, !R_DATES(p) ? `<div class="mc-line">Add dates and budget to see the timeline and funding.</div>` : "");
    }, 120);
  }
  const R_DATES = (p) => p._start || p._end || p.dsFunding != null;
  form.addEventListener("input", updateLive);
  form.addEventListener("change", updateLive);
  $("partner-box").addEventListener("click", updateLive);

  /* project number: the next number for this agency, read from the published register */
  function refPrefix(lead) {
    const o = findOrg(lead);
    if (o) return o.acronym.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const words = String(lead || "").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|for|the|in)$/i.test(w));
    return (words.length > 1 ? words.map((w) => w[0]).join("") : String(lead || "ORG")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "ORG";
  }
  function nextRef(lead) {
    const pre = refPrefix(lead);
    let max = 0;
    Object.values(REFS).forEach((r) => { const [p2, n] = String(r).split(/-(?=\d+$)/); if (p2 === pre) max = Math.max(max, Number(n) || 0); });
    return `${pre}-${String(max + 1).padStart(3, "0")}`;
  }

  /* full preview before sending */
  function showPreview() {
    const p = SF.render.fromAnswers(answers());
    p.photos = photos.map((x) => x.url);
    assignedRef = correcting ? (correcting.ref || "") : nextRef(leadKey());
    $("pv-ref").textContent = assignedRef ? `${correcting ? "Correcting project" : "Your project number"}: ${assignedRef}${API && !correcting ? " (confirmed when you send)" : ""}` : "";
    $("pv-hero").innerHTML = SF.render.hero(p, { photoNote: API ? "Add photos in section 7 to show them here" : "Your photos will appear here once the project is published" });
    $("pv-body").innerHTML = SF.render.body(p, GEO, { logoNote: isNewOrg() && !logo ? logoNote() : "" });
    $("send-err").hidden = true;
    renderTurnstile();
    $("pv-map").innerHTML = GEO ? SF.render.placeOnMap(p, GEO, PUBLISHED) : "";
    $("pv-lock").innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    form.hidden = true;
    $("multi-box").hidden = true;
    $("live-card").hidden = true;
    $("preview").hidden = false;
    $("main").classList.add("previewing");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("pv-edit").addEventListener("click", () => {
    $("preview").hidden = true; $("main").classList.remove("previewing"); form.hidden = false; $("multi-box").hidden = !!correcting; $("live-card").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("pv-send").addEventListener("click", () => (API ? sendDirect() : sendNow()));

  /* ---------- sending straight to the back end ---------- */
  function renderTurnstile() {
    const key = SF.config.turnstileSiteKey;
    if (!API || !key || tsWidget !== null) { if (tsWidget !== null && window.turnstile) window.turnstile.reset(tsWidget); return; }
    const go = () => { tsWidget = window.turnstile.render("#ts-box", { sitekey: key }); };
    if (window.turnstile) return go();
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    sc.async = true; sc.onload = go;
    document.head.appendChild(sc);
  }
  async function sendDirect() {
    const btn = $("pv-send"), err = $("send-err");
    err.hidden = true;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Sending...";
    const a = answers();
    try {
      const body = {
        answers: { ...a, refPrefix: refPrefix(leadKey()) },
        private: { fpName: $("fpName").value.trim(), fpEmail: $("fpEmail").value.trim() },
        photos: photos.map(({ name, type, data }) => ({ name, type, data })),
        logo: logo && isNewOrg() ? { name: logo.name, type: logo.type, data: logo.data } : null,
        correction: correcting ? { id: correcting.id } : null,
        website: $("website").value,
        turnstile: tsWidget !== null && window.turnstile ? window.turnstile.getResponse(tsWidget) : "",
      };
      const r = await fetch(`${API}/api/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `the server answered ${r.status}`);
      assignedRef = j.ref;
      const saved = SF.render.saveSubmission({
        savedAt: new Date().toISOString(), sent: "direct", id: j.id, token: j.token, ref: j.ref,
        correcting: correcting ? (correcting.ref || correcting.id) : null, photos: photos.length, answers: { ...a },
      });
      $("sent-ref").textContent = j.ref || "";
      $("sent-photos").textContent = photos.length ? `${photos.length} sent` : "None";
      $("sent-lede").textContent = correcting
        ? "The Durable Solutions Unit will review your correction and update the map. There is nothing else you need to do."
        : "The Durable Solutions Unit will review your project and publish it on the map. There is nothing else you need to do.";
      $("sent-saved").innerHTML = saved
        ? `The status updates under <a href="my-submissions.html">My submissions</a> on this device. Keep the project number if you need to contact us about it.`
        : "Keep the project number if you need to contact us about it.";
      $("preview").hidden = true;
      $("main").classList.remove("previewing");
      $("sent").hidden = false;
      $("sent").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      err.hidden = false;
      err.innerHTML = `Your project could not be sent directly (${esc(e.message)}). <button type="button" class="link-btn" id="send-email">Send it by email instead</button>`;
      $("send-email").addEventListener("click", sendNow);
      if (tsWidget !== null && window.turnstile) window.turnstile.reset(tsWidget);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  /* ---------- email ---------- */
  function buildEmail() {
    const v = (id) => $(id).value.trim();
    const b = num(v("budget")), s = num(v("share"));
    const leadOrg = findOrg($("lead").value);
    const lead = $("lead").value === "__other" ? `${v("leadOther")} (not in the list)` : leadOrg ? orgLabel(leadOrg) : v("lead");
    const people = PEOPLE.map((g) => `${g.label}: ${v(`pp-${g.key}`)}`).join("; ");
    const leadership = checked("leadership").map((k) => (SF.LEADERSHIP.find((l) => l.key === k) || { label: "None of these" }).label).join("; ");
    const locs = checked("localities");
    const lines = [
      ">>> PLEASE ATTACH UP TO 3 PROJECT PHOTOS (JPG OR PNG, UNDER 1 MB EACH) BEFORE SENDING <<<",
      "By attaching photos, you confirm you have consent from the people shown to publish them.",
      isNewOrg() ? ">>> PLEASE ALSO ATTACH YOUR ORGANISATION'S LOGO (PNG OR SVG) <<<" : null,
      "",
      correcting ? "SOLUTIONS FOOTPRINT: CORRECTION TO A PUBLISHED PROJECT" : "SOLUTIONS FOOTPRINT: NEW PROJECT SUBMISSION",
      correcting ? `Project number: ${correcting.ref || correcting.id}` : `Project number (proposed): ${assignedRef}`,
      correcting ? `Published name: ${correcting.name}` : null,
      "",
      "1. ABOUT THE PROJECT",
      `Project or programme name: ${v("name")}`,
      `Short description: ${v("description")}`,
      `Intervention type: ${checked("itypes").join("; ")}`,
      "",
      "2. WHO IS DOING IT",
      `Organisation type: ${v("orgType")}`,
      `Lead organisation: ${lead}`,
      leadership ? `Organisation leadership: ${leadership}` : null,
      `Implementing partners: ${partners.join("; ")}`,
      `Focal point name (not published): ${v("fpName")}`,
      `Focal point email (not published): ${v("fpEmail")}`,
      "",
      "3. WHERE",
      `Geographic scope: ${scope() === "nationwide" ? "Nationwide" : "One or more states"}`,
      `States: ${checked("states").join("; ")}`,
      `Localities: ${locs.join("; ")}`,
      "",
      "4. IASC CRITERIA",
      `Criteria: ${checked("criteria").map((n) => `${n}. ${CRITERIA[n - 1].name}`).join("; ")}`,
      `Coordination mechanism or cluster: ${v("coordination")}`,
      "",
      "5. WHEN AND HOW MUCH",
      `Start date: ${fmtMonthValue(v("start"))}`,
      `End date: ${fmtMonthValue(v("end"))}`,
      `Status: ${v("status")}`,
      `Total budget: ${SF.fmtUSD(b)}`,
      `Durable solutions share (self-assessed): ${s}%`,
      `Durable solutions funding (calculated): ${SF.fmtUSD((b * s) / 100)}`,
      `Donors: ${donorsGiven().map((d) => (d.amount != null ? `${d.name}: ${SF.fmtUSD(d.amount)}` : d.name)).join("; ")}`,
      "",
      "6. PEOPLE REACHED, PLANNED",
      people,
      ...peopleEmailLines(),
      "",
      "7. ANYTHING ELSE",
      `Remarks: ${v("remarks")}`,
      "Consent to publish on the United Nations in Sudan website: Yes",
      "",
      `Sent from the Solutions Footprint form on ${SF.fmtDateLong(new Date())}.`,
    ].filter((l) => l !== null);
    const subject = (correcting
      ? `Correction to ${correcting.ref || "project"} for Solutions Footprint: ${v("name")}`
      : `New project ${assignedRef} for Solutions Footprint: ${v("name")}`).slice(0, 160);
    const body = lines.join("\r\n");
    const href = `mailto:${SF.config.contactEmail}?cc=${encodeURIComponent(v("fpEmail"))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { subject, body, href };
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validate()) return;
    showPreview();
  });
  function sendNow() {
    const mail = buildEmail();
    $("done-subject").textContent = mail.subject;
    $("done-text").value = mail.body;
    $("reopen").href = mail.href;
    const note = $("attach-note");
    note.hidden = false;
    note.innerHTML = `${SF.icon("photo")}<span><b>Attach up to 3 photos to the email before you press Send</b> (JPG or PNG, under 1 MB each).${isNewOrg() ? " <b>Please also attach your organisation's logo</b> (PNG or SVG)." : ""} The website cannot attach them for you.</span>`;
    const a = answers();
    const saved = SF.render.saveSubmission({
      savedAt: new Date().toISOString(), correcting: correcting ? (correcting.ref || correcting.id) : null, ref: assignedRef,
      subject: mail.subject, body: mail.body, href: mail.href,
      answers: { ...a },
    });
    $("done-ref").textContent = assignedRef ? `Your project number: ${assignedRef}. Keep it for any follow-up with the Durable Solutions Unit.` : "";
    $("saved-note").innerHTML = saved
      ? `A copy is saved in this browser. See it any time under <a href="my-submissions.html">My submissions</a>.`
      : "This browser does not allow saving, so the copy will not appear under My submissions. Your submission is not affected.";
    $("preview").hidden = true;
    $("main").classList.remove("previewing");
    $("done").hidden = false;
    $("done").scrollIntoView({ behavior: "smooth", block: "start" });
    window.location.href = mail.href;
  }
  $("copy-btn").addEventListener("click", async () => {
    const t = $("done-text");
    try { await navigator.clipboard.writeText(t.value); }
    catch { t.select(); document.execCommand("copy"); }
    $("copy-btn").textContent = "Copied";
    setTimeout(() => ($("copy-btn").textContent = "Copy the text"), 2000);
  });
  $("edit-btn").addEventListener("click", () => { $("done").hidden = true; form.hidden = false; $("multi-box").hidden = !!correcting; $("live-card").hidden = false; });
  $("another-btn2").addEventListener("click", () => $("another-btn").click());
  $("another-btn").addEventListener("click", () => {
    // keep who is doing it and the focal point; clear the project itself
    const keep = { orgType: $("orgType").value, lead: $("lead").value, leadOther: $("leadOther").value, fpName: $("fpName").value, fpEmail: $("fpEmail").value, leadership: checked("leadership") };
    form.reset();
    partners = []; renderPartners();
    $("donor-rows").innerHTML = ""; donorRow();
    correcting = null;
    $("correcting").hidden = true;
    $("form-title").textContent = "Add your project";
    $("orgType").value = keep.orgType; fillLead(keep.orgType, keep.lead);
    $("leadOther").value = keep.leadOther; $("fpName").value = keep.fpName; $("fpEmail").value = keep.fpEmail;
    form.querySelectorAll('input[name="leadership"]').forEach((i) => (i.checked = keep.leadership.includes(i.value)));
    syncScope(); updateDS();
    history.replaceState(null, "", "add.html");
    photos = []; drawPhotos();
    $("done").hidden = true; $("sent").hidden = true; $("preview").hidden = true; form.hidden = false; $("multi-box").hidden = false; $("live-card").hidden = false;
    updateLive();
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("name").focus();
  });

  /* ---------- "Suggest a correction": prefill from the published data ---------- */
  function prefill(p) {
    correcting = p;
    document.title = "Suggest a correction | Solutions Footprint";
    $("form-title").textContent = "Suggest a correction";
    $("form-lede").innerHTML = `Change what is wrong or missing for <strong>${esc(p.name)}</strong>, then submit. DSU reviews every correction before it is published. Fields marked <span class="req">*</span> are required.`;
    $("correcting").hidden = false;
    $("correcting").textContent = `Correcting project ${p.ref || p.id}`;
    $("multi-box").hidden = true;
    const set = (id, v) => { if (v != null) $(id).value = v; };
    set("name", p.name); set("description", p.description);
    const lo = findOrg(p.lead);
    const type = p.orgType || (lo && lo.type) || "";
    $("orgType").value = type;
    if (lo && lo.type === type) fillLead(type, lo.acronym);
    else { fillLead(type, "__other"); set("leadOther", p.lead); }
    form.querySelectorAll('input[name="leadership"]').forEach((i) => (i.checked = (p.leadership || []).includes(i.value)));
    partners = (p.partners || []).slice(); renderPartners();
    if (p.coordination && ![...$("coordination").options].some((o) => o.value === p.coordination)) {
      $("coordination").insertAdjacentHTML("beforeend", `<option>${esc(p.coordination)}</option>`);
    }
    set("coordination", p.coordination || "");
    setYM("start", p.start ? p.start.slice(0, 7) : ""); setYM("end", p.end ? p.end.slice(0, 7) : "");
    set("status", ["Ongoing", "Pipeline", "Ended"].includes(p.reportedStatus) ? p.reportedStatus : "");
    set("budget", p.budget != null ? Math.round(p.budget).toLocaleString("en-US") : "");
    set("share", p.share != null ? Math.round(p.share * 1000) / 10 : "");
    $("donor-rows").innerHTML = "";
    const pd = p.donors && p.donors.length ? p.donors : p.donor ? [{ name: p.donor, amount: null }] : [];
    if (pd.length) pd.slice(0, SF.MAX_DONORS).forEach((d) => donorRow(d.name, d.amount != null ? Math.round(d.amount).toLocaleString("en-US") : ""));
    else donorRow();
    set("remarks", p.remarks);
    PEOPLE.forEach((g) => set(`pp-${g.key}`, p.people && p.people[g.key] != null ? Number(p.people[g.key]).toLocaleString("en-US") : ""));
    // older entries may give a total without groups: the rest goes under "Other or not specified"
    if (p.people && p.people.total != null) {
      const known = SF.TARGET_GROUPS.reduce((acc, g) => acc + (p.people[g.key] || 0), 0);
      if (p.people.total > known) set("pp-other", Number((p.people.other || 0) + p.people.total - known).toLocaleString("en-US"));
    }
    if (p.peopleSex) {
      $("sex-box").hidden = false; $("sex-toggle").setAttribute("aria-expanded", "true"); $("sex-toggle").textContent = "Remove the breakdown";
      Object.entries(p.peopleSex).forEach(([g, row]) => SEX.forEach((x) => { if (row && row[x.key] != null) set(`sx-${g}-${x.key}`, Number(row[x.key]).toLocaleString("en-US")); }));
    }
    const pc = (v) => (v != null ? String(Math.round(v * 1000) / 10) : "");
    set("pp-female", pc(p.femaleShare)); set("pp-pwd", pc(p.pwdShare)); set("pp-pwd-f", pc(p.pwdFemaleShare));
    syncPeople(); syncPwd();
    const tick = (name, vals) => form.querySelectorAll(`input[name="${name}"]`).forEach((i) => (i.checked = vals.includes(i.value)));
    tick("itypes", p.interventionTypes || []);
    tick("states", p.states || []);
    tick("criteria", (p.criteria || []).map(String));
    const sc = form.querySelector(`input[name="scope"][value="${p.nationwide ? "nationwide" : "states"}"]`);
    if (sc) sc.checked = true;
    syncScope();
    renderLocalities(p.localities || []);
    updateDS();
  }

  /* ---------- start ---------- */
  SF.renderHeader("add");
  Promise.all([SF.loadJSON(SF.config.orgsUrl), SF.loadJSON(SF.config.localitiesUrl), SF.loadJSON(SF.config.dataUrl).catch(() => null), SF.loadJSON(SF.config.geoUrl).catch(() => null), SF.loadJSON(SF.config.refsUrl).catch(() => ({})), SF.loadLogos()])
    .then(([orgs, locs, data, geo, refs]) => {
      REFS = refs || {};
      ORGS = orgs.organisations;
      LOCALITIES = locs.states;
      GEO = geo;
      PUBLISHED = data ? data.projects.map(SF.enrich) : [];
      $("partner-list").innerHTML = ORGS.map((o) => `<option value="${esc(orgLabel(o))}">`).join("");
      SF.renderFooter(data && data.lastUpdated);
      const id = new URLSearchParams(location.search).get("correct");
      const p = id && data && data.projects.find((x) => x.id === id);
      if (p) prefill(p);
      updateLive();
    })
    .catch(() => SF.renderFooter());
})();
