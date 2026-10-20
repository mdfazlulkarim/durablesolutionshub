/* Manage pages for signed-in DSU admins: review queue, all projects, organisations, approved editors, history.
   They talk to the back end with the session key from the Sign in window (see SF.auth in common.js). */
  "use strict";
  (() => {
    const SITE = ""; // this page is part of the website, so map data and photos are found next to it
    const API = (SF.config.authUrl || "") + "/admin/api";
    const app = document.getElementById("app");
    const esc = SF.esc;
    const PEOPLE = [{ key: "total", label: "Total" }, ...SF.TARGET_GROUPS];
    let GEO = null, ORGS = [], LOCALITIES = {}, ME = null, AGENCY = null;

    /* ---------- helpers ---------- */
    async function api(path, opts = {}) {
      const s = SF.auth.get();
      if (!s) { showLogin(); throw new Error("Please sign in."); }
      let r;
      try {
        r = await fetch(API + path, {
          method: opts.method || "GET",
          headers: { "Content-Type": "application/json", "X-SF-Admin": "1", Authorization: `Bearer ${s.token}` },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
      } catch (e) { throw new Error("The back end could not be reached. Please check your connection and try again."); }
      const j = await r.json().catch(() => ({ ok: false, error: "The server did not answer properly." }));
      if (r.status === 401) { SF.auth.clear(); SF.auth.drawButton(); showLogin("Your session has ended. Please sign in again."); throw new Error("Please sign in."); }
      if (!j.ok) throw new Error(j.error || "Something went wrong.");
      return j;
    }
    const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "";
    const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const daysSince = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 864e5) : null;
    const monthOf = (d) => (d ? String(d).slice(0, 7) : "");
    const fmtDates = (s, e) => s || e ? `${SF.fmtMonth(SF.parseDate(s))} to ${SF.fmtMonth(SF.parseDate(e))}` : "";
    const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = `<span class="spin"></span> ${label || "Working"}`; btn.disabled = true; } else { btn.innerHTML = btn.dataset.l || btn.innerHTML; btn.disabled = false; } };
    const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#1a7a4c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
    const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 7v6"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';
    function setNav(k) { document.querySelectorAll("#nav a[data-k]").forEach((a) => { if (a.dataset.k === k) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }); }
    const fail = (e) => { app.innerHTML = `<div class="note-box warn">${esc(e.message || e)}</div>`; };

    function checkChip(checks) {
      const e = checks.find((c) => c.level === "error"), w = checks.find((c) => c.level === "warn");
      if (e) return `<span class="pill2 err">${esc(e.text)}</span>`;
      if (w) return `<span class="pill2 warn">${esc(w.kind === "duplicate" ? `Looks like ${w.ref || "a published project"}` : w.text)}</span>`;
      return `<span class="pill2 ok">All good</span>`;
    }

    /* ---------- sign in ---------- */
    function showLogin(msg) {
      document.getElementById("nav").hidden = true;
      if (!SF.config.authUrl) {
        app.innerHTML = `<div class="card gate"><h1>Manage projects</h1><p>Sign-in is not switched on for this site yet.</p><a class="btn" href="./">Back to the map</a></div>`;
        return;
      }
      app.innerHTML = `<div class="card gate"><h1>Manage projects</h1>
        <p>${esc(msg || "For the Durable Solutions Unit. Sign in with your work email to see and edit all projects.")}</p>
        <button type="button" class="btn btn-primary" id="gate-signin">${SF.icons.user} Sign in</button></div>`;
      document.getElementById("gate-signin").addEventListener("click", () => SF.auth.open());
    }
    document.addEventListener("sf-signed-in", () => boot().catch((e) => { if (e.message !== "Please sign in.") fail(e); }));

    /* ---------- start ---------- */
    async function boot() {
      const s = SF.auth.get();
      if (!s) return showLogin();
      ME = await api("/me");
      // keep the name, role and agency in this browser up to date
      const m = ME.me || {};
      if (m.email && (m.role !== s.role || (m.name || "") !== (s.name || "") || (m.agency || null) !== (s.agency || null))) {
        SF.auth.save({ ...s, name: m.name || "", role: m.role, agency: m.agency || null }); SF.auth.drawButton();
      }
      AGENCY = m.role === "agency" ? m.agency : null;
      document.querySelectorAll("#nav [data-role]").forEach((a) => (a.hidden = a.dataset.role !== (AGENCY ? "agency" : "admin")));
      document.getElementById("nav-projects").textContent = AGENCY ? `${AGENCY} projects` : "All projects";
      document.getElementById("nav").hidden = false;
      route();
    }
    async function loadLists() {
      const [orgs, locs, geo, logos] = await Promise.all([
        SF.loadJSON(SITE + "data/organisations.json").catch(() => ({ organisations: [] })),
        SF.loadJSON(SITE + "data/localities.json").catch(() => ({ states: {} })),
        SF.loadJSON(SITE + "data/geo.json").catch(() => null),
        SF.loadJSON(SITE + "data/logos.json").catch(() => ({})),
      ]);
      ORGS = orgs.organisations || []; LOCALITIES = locs.states || {}; GEO = geo;
      Object.assign(SF.LOGOS, logos || {});
      Object.values(SF.LOGOS).forEach((l) => { ["full", "mark"].forEach((k) => { if (l[k] && !/^https?:|^\//.test(l[k])) l[k] = SITE + l[k]; }); });
    }
    window.addEventListener("hashchange", route);
    async function route() {
      const h = location.hash.replace(/^#\/?/, "").split("/");
      window.scrollTo(0, 0);
      try {
        if (AGENCY) {
          if (h[0] === "project" && h[1]) { setNav("projects"); return await viewProject(decodeURIComponent(h[1])); }
          if (h[0] === "changes") { setNav("changes"); return await viewChanges(); }
          setNav("projects"); return await viewProjects();
        }
        if (h[0] === "review" && h[1]) { setNav("queue"); return await viewReview(h[1]); }
        if (h[0] === "project" && h[1]) { setNav("projects"); return await viewProject(decodeURIComponent(h[1])); }
        if (h[0] === "projects") { setNav("projects"); return await viewProjects(); }
        if (h[0] === "orgs") { setNav("orgs"); return await viewOrgs(); }
        if (h[0] === "history") { setNav("history"); return await viewHistory(); }
        if (h[0] === "editors") { setNav("editors"); return await viewEditors(); }
        setNav("queue"); return await viewQueue(["published", "rejected"].includes(h[1]) ? h[1] : "pending");
      } catch (e) { if (e.message !== "Please sign in.") fail(e); }
    }

    /* ---------- review queue ---------- */
    async function viewQueue(status) {
      ME = await api("/me");
      const { items } = await api(`/queue?status=${status}`);
      const warn = status === "pending" ? items.filter((i) => i.checks.some((c) => c.level !== "info")).length : 0;
      const oldest = daysSince(ME.oldestPending);
      const setup = [];
      if (!ME.setup.github) setup.push("The GitHub key (GITHUB_TOKEN) is not added yet, so publishing will not work.");
      app.innerHTML = `
        ${setup.map((s) => `<div class="note-box warn">${esc(s)}</div>`).join("")}
        ${!ME.imported ? `<div class="note-box"><b>First step:</b> copy the projects already on the map into the admin database, so you can edit them here.
          <div style="margin-top:10px"><button class="btn btn-primary" id="seed">Import the current map data</button></div></div>` : ""}
        <div class="row between">
          <div><h1>Review queue</h1><p class="lede2">New projects from the form and Excel uploads. Nothing appears on the map until you publish it.</p></div>
          <a class="btn" href="#/project/new">Add a project yourself</a>
        </div>
        <div class="stats">
          <div class="card stat"><div class="l">To review</div><div class="v">${ME.counts.pending || 0}</div></div>
          <div class="card stat"><div class="l">With warnings</div><div class="v warn">${warn}</div></div>
          <div class="card stat"><div class="l">Published on the map</div><div class="v">${ME.published}</div></div>
          <div class="card stat"><div class="l">Oldest waiting</div><div class="v">${oldest == null ? "None" : oldest === 0 ? "Today" : `${oldest} day${oldest === 1 ? "" : "s"}`}</div></div>
        </div>
        <div class="card tbl-card">
          <div class="tbl-tools">
            <a class="tab" href="#/queue" aria-current="${status === "pending"}">To review (${ME.counts.pending || 0})</a>
            <a class="tab" href="#/queue/published" aria-current="${status === "published"}">Published</a>
            <a class="tab" href="#/queue/rejected" aria-current="${status === "rejected"}">Not published</a>
            <span class="grow"></span>
            <label class="row" style="gap:8px;font-size:14px;color:var(--muted)">Search <input class="input" type="search" id="q" placeholder="Name, number or agency" style="width:220px"></label>
          </div>
          <div class="tbl-wrap">${items.length ? `<table class="adm"><thead><tr>
            <th>${status === "pending" ? "Received" : "Reviewed"}</th><th>Number</th><th>Project</th><th>Lead</th><th>Came from</th><th>${status === "pending" ? "Checks" : ""}</th><th><span class="sr-only">Action</span></th>
          </tr></thead><tbody>${items.map((i) => `<tr class="click" data-id="${i.id}" data-q="${esc(`${i.ref} ${i.name} ${i.lead}`.toLowerCase())}">
            <td>${fmtDay(status === "pending" ? i.receivedAt : i.reviewedAt)}</td>
            <td class="ref">${esc(i.ref || "")}</td>
            <td>${i.kind === "correction" ? "<span class='pill2 info'>Correction</span> " : ""}${esc(i.name)}</td>
            <td>${esc(i.lead)}</td>
            <td>${i.source === "agency" ? `${esc(i.byName || i.by || "")} (${esc(i.lead)} admin)` : i.source === "excel" ? `Excel upload${i.row ? `, row ${i.row}` : ""}` : i.kind === "correction" ? "Suggest a correction" : "Form"}${i.photos ? `, ${i.photos} photo${i.photos === 1 ? "" : "s"}` : ""}</td>
            <td>${status === "pending" ? checkChip(i.checks) : ""}</td>
            <td><a class="btn btn-sm ${status === "pending" ? "btn-primary" : ""}" href="#/review/${i.id}">${status === "pending" ? "Review" : "Open"}</a></td>
          </tr>`).join("")}</tbody></table>` : `<div class="empty">${status === "pending" ? "Nothing waiting for review." : "Nothing here yet."}</div>`}</div>
        </div>
        <div class="note-box">${ME.setup.inbox ? "You get an email (through GitHub) when something new arrives. " : ""}Use <a href="#/projects">All projects</a> to edit anything already on the map.</div>`;
      app.querySelectorAll("tr.click").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = `#/review/${tr.dataset.id}`; }));
      const q = document.getElementById("q");
      q.addEventListener("input", () => app.querySelectorAll("tr[data-q]").forEach((tr) => (tr.hidden = !tr.dataset.q.includes(q.value.toLowerCase().trim()))));
      document.getElementById("seed")?.addEventListener("click", async (e) => {
        busy(e.target, true, "Importing");
        try { const r = await api("/setup", { method: "POST" }); SF.toast(`Imported ${r.imported} projects`); route(); }
        catch (err) { busy(e.target, false); alert(err.message); }
      });
    }

    /* ---------- the editor (used for submissions and published projects) ---------- */
    function pills(name, options, chosen, extra = "") {
      const set = new Set((chosen || []).map(String));
      const all = [...options, ...[...set].filter((v) => !options.some((o) => String(o.value ?? o) === v)).map((v) => ({ value: v, label: v }))];
      return `<div class="choice-pills sm" ${extra}>${all.map((o) => { const v = String(o.value ?? o), l = o.label ?? o; return `<label${o.cls ? ` class="${o.cls}"` : ""}><input type="checkbox" name="${name}" value="${esc(v)}"${set.has(v) ? " checked" : ""}> ${o.html || esc(l)}</label>`; }).join("")}</div>`;
    }
    function editorHTML(d, priv, opts = {}) {
      const people = d.people || {};
      const orgOpts = ORGS.map((o) => `<option value="${esc(o.acronym)}">${esc(o.acronym === o.name ? o.name : `${o.acronym}, ${o.name}`)}</option>`).join("");
      const typeOpts = [...new Set([...SF.ORG_TYPES.map((t) => t.key), d.orgType].filter(Boolean))];
      return `
      <section class="card ed"><h2>Project <small>Every field can be edited before publishing</small></h2>
        <label class="f" data-k="name">Project name<input class="input" id="e-name" value="${esc(d.name)}" maxlength="250"></label>
        <label class="f" data-k="description">Short description<textarea class="input" id="e-description" rows="2" maxlength="600">${esc(d.description || "")}</textarea></label>
        <div class="f" data-k="interventionTypes">Intervention type${pills("e-itypes", SF.INTERVENTION_TYPES, d.interventionTypes)}</div>
      </section>
      <section class="card ed"><h2>Who</h2>
        <div class="g2">
          <label class="f" data-k="orgType">Organisation type<select class="input" id="e-orgType"><option value="">Not set</option>${typeOpts.map((t) => `<option${t === d.orgType ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label class="f" data-k="lead">Lead organisation<input class="input" id="e-lead" list="dl-orgs" value="${esc(d.lead)}"><small>Use the acronym from the list when there is one</small></label>
        </div>
        <label class="f" data-k="leadName">Full name of the lead organisation<input class="input" id="e-leadName" value="${esc(d.leadName || "")}" placeholder="Only needed for organisations without a logo on the map"></label>
        <div class="f" data-k="leadership">Organisation leadership${pills("e-leadership", SF.LEADERSHIP.map((l) => ({ value: l.key, label: l.label })), d.leadership)}</div>
        <label class="f" data-k="partners">Implementing partners<input class="input" id="e-partners" value="${esc((d.partners || []).join("; "))}"><small>Separate with semicolons (;)</small></label>
        <datalist id="dl-orgs">${orgOpts}</datalist>
      </section>
      <section class="card ed"><h2>Where</h2>
        <label class="row" style="gap:8px;font-size:14px" data-k="nationwide"><input type="checkbox" id="e-nationwide"${d.nationwide ? " checked" : ""}> Nationwide</label>
        <div class="f" data-k="states" id="e-states-wrap">States${pills("e-states", SF.STATES, d.states)}</div>
        <div class="f" data-k="localities">Localities<small id="loc-check">Choose the states first; their localities appear here.</small><div id="e-loc-groups" data-start="${esc(JSON.stringify(d.localities || []))}"></div></div>
      </section>
      <section class="card ed"><h2>IASC criteria and coordination</h2>
        <div class="f" data-k="criteria">IASC criteria${pills("e-criteria", SF.CRITERIA.map((c) => ({ value: c.n, cls: "crit-opt2", html: `<span class="ci" style="background:${c.color}">${SF.critIcon(c.n)}</span> ${c.n}. ${esc(c.short)}` })), d.criteria)}</div>
        <label class="f" data-k="coordination">Coordination mechanism or cluster<input class="input" id="e-coordination" list="dl-coord" value="${esc(d.coordination || "")}"></label>
        <datalist id="dl-coord">${SF.COORDINATION_OPTIONS.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>
      </section>
      <section class="card ed"><h2>When and how much</h2>
        <div class="g3">
          <label class="f" data-k="start">Start<input class="input" type="month" id="e-start" value="${monthOf(d.start)}"></label>
          <label class="f" data-k="end">End<input class="input" type="month" id="e-end" value="${monthOf(d.end)}"></label>
          <label class="f" data-k="reportedStatus">Reported status<select class="input" id="e-status"><option value="">Not set</option>${["Ongoing", "Pipeline", "Ended"].map((s) => `<option${s === d.reportedStatus ? " selected" : ""}>${s}</option>`).join("")}</select><small>The map works out the status from the dates</small></label>
          <label class="f" data-k="budget">Total budget (USD)<input class="input" id="e-budget" inputmode="decimal" value="${d.budget ?? ""}"></label>
          <label class="f" data-k="share">Durable solutions share (%)<input class="input" id="e-share" inputmode="decimal" value="${d.share != null ? Math.round(d.share * 1000) / 10 : ""}"></label>
          <label class="f">Durable solutions funding<input class="input" id="e-ds" readonly value=""></label>
        </div>
        <label class="f" data-k="donors">Donors and amounts<input class="input" id="e-donors" value="${esc((d.donors && d.donors.length ? d.donors : d.donor ? [{ name: d.donor, amount: null }] : []).map((x) => (x.amount != null ? `${x.name}: ${x.amount}` : x.name)).join("; "))}"><small>For example: Japan: 60000; ECHO: 40000. With more than one donor, give each amount.</small></label>
      </section>
      <section class="card ed"><h2>People reached, planned</h2>
        <div class="g6" data-k="people">${PEOPLE.map((g) => `<label class="f">${g.label}<input class="input" id="e-pp-${g.key}" inputmode="numeric" value="${people[g.key] ?? ""}"${g.key === "total" ? ' readonly title="Adds up the groups"' : ""}></label>`).join("")}</div>
        <div class="g3">
          <label class="f" data-k="femaleShare">Women and girls (%)<input class="input" id="e-fem" inputmode="decimal" value="${d.femaleShare != null ? Math.round(d.femaleShare * 1000) / 10 : ""}"></label>
          <label class="f" data-k="pwdShare">Persons with disabilities (%)<input class="input" id="e-pwd" inputmode="decimal" value="${d.pwdShare != null ? Math.round(d.pwdShare * 1000) / 10 : ""}"></label>
          <label class="f" data-k="pwdFemaleShare">Of whom women and girls (%)<input class="input" id="e-pwdf" inputmode="decimal" value="${d.pwdFemaleShare != null ? Math.round(d.pwdFemaleShare * 1000) / 10 : ""}"></label>
        </div>
        ${d.peopleSex ? `<small class="muted">Breakdown by women, girls, men and boys: ${esc(Object.entries(d.peopleSex).map(([g, r]) => `${(SF.TARGET_GROUPS.find((t) => t.key === g) || { label: g }).label} ${r.women ?? 0}/${r.girls ?? 0}/${r.men ?? 0}/${r.boys ?? 0}`).join("; "))} (women/girls/men/boys). Kept as sent.</small>` : ""}
      </section>
      <section class="card ed"><h2>Photos and remarks <small>Up to 3 photos, each made smaller to under 1 MB</small></h2>
        <div class="ph-list" id="e-photos"></div>
        <label class="f" data-k="remarks">Remarks<textarea class="input" id="e-remarks" rows="2" maxlength="800">${esc(d.remarks || "")}</textarea></label>
      </section>
      <section class="card ed"><h2>Private to DSU <small>Never published on the map</small></h2>
        <div class="g2">
          <label class="f">Focal point<input class="input" id="e-fpName" value="${esc(priv.fpName || "")}"></label>
          <label class="f">Focal point email<input class="input" id="e-fpEmail" type="email" value="${esc(priv.fpEmail || "")}"></label>
        </div>
        ${opts.note !== undefined ? `<label class="f">Internal note<textarea class="input" id="e-note" rows="2" placeholder="Only visible here">${esc(opts.note || "")}</textarea></label>` : ""}
      </section>`;
    }
    function bindEditor(state, onChange) {
      const g = (id) => document.getElementById(id);
      const checked = (n) => [...document.querySelectorAll(`input[name="${n}"]:checked`)].map((i) => i.value);
      const num = (v) => { const s = String(v || "").replace(/[^\d.]/g, ""); return s === "" ? null : Number(s); };
      const splitList = (v) => String(v || "").split(/;|\n/).map((x) => x.trim()).filter(Boolean);
      function values() {
        const start = g("e-start").value, end = g("e-end").value;
        const share = num(g("e-share").value);
        return {
          name: g("e-name").value.trim(), description: g("e-description").value.trim() || null, interventionTypes: checked("e-itypes"),
          orgType: g("e-orgType").value || null, lead: g("e-lead").value.trim(), leadName: g("e-leadName").value.trim() || undefined,
          leadership: checked("e-leadership"), partners: splitList(g("e-partners").value), partnerTypes: [],
          nationwide: g("e-nationwide").checked, states: g("e-nationwide").checked ? [] : checked("e-states"),
          localities: g("e-nationwide").checked ? [] : checked("e-loc"), criteria: checked("e-criteria").map(Number),
          coordination: g("e-coordination").value.trim() || null,
          start: start ? `${start}-01` : null, end: end ? `${end}-01` : null, reportedStatus: g("e-status").value || null,
          budget: num(g("e-budget").value), share: share != null ? Math.min(100, share) / 100 : null,
          dsFunding: num(g("e-budget").value) != null && share != null ? (num(g("e-budget").value) * share) / 100 : null,
          donors: splitList(g("e-donors").value).map((x) => { const m = x.match(/^(.*?)\s*:\s*\$?\s*([\d.,]+)\s*$/); return m ? { name: m[1].trim(), amount: Number(m[2].replace(/,/g, "")) } : { name: x, amount: null }; }),
          donor: splitList(g("e-donors").value).map((x) => x.replace(/\s*:\s*\$?\s*[\d.,]+\s*$/, "")).join("; ") || null,
          people: Object.fromEntries(PEOPLE.map((p) => [p.key, num(g(`e-pp-${p.key}`).value)])),
          femaleShare: num(g("e-fem").value) != null ? Math.min(100, num(g("e-fem").value)) / 100 : null,
          pwdShare: num(g("e-pwd").value) != null ? Math.min(100, num(g("e-pwd").value)) / 100 : null,
          pwdFemaleShare: num(g("e-pwdf").value) != null ? Math.min(100, num(g("e-pwdf").value)) / 100 : null,
          peopleSex: state.peopleSex || null,
          remarks: g("e-remarks").value.trim() || null,
        };
      }
      const priv = () => ({ fpName: g("e-fpName").value.trim(), fpEmail: g("e-fpEmail").value.trim() });
      function refresh() {
        const v = values();
        g("e-ds").value = v.dsFunding != null ? SF.fmtUSD(v.dsFunding) : "";
        const grp = SF.TARGET_GROUPS.map((t) => v.people[t.key]).filter((x) => x != null);
        if (grp.length) g("e-pp-total").value = grp.reduce((x, y) => x + y, 0);
        g("e-states-wrap").style.opacity = v.nationwide ? 0.45 : 1;
        onChange && onChange(v);
      }
      // Localities: a tick list for each chosen state (OCHA admin 2 names), as on the form.
      // Names that are not in the OCHA list are kept in an extra group, so nothing is lost.
      let locKey = "";
      function drawLocalities(force) {
        const host = g("e-loc-groups");
        const nw = g("e-nationwide").checked;
        const sts = nw ? [] : checked("e-states");
        const key = `${nw}|${sts.join(",")}`;
        if (key === locKey && !force) return;
        locKey = key;
        const chosen = host.dataset.start ? JSON.parse(host.dataset.start) : checked("e-loc");
        delete host.dataset.start;
        const known = new Set(sts.flatMap((st) => LOCALITIES[st] || []));
        const other = chosen.filter((l) => !known.has(l));
        const box = (l, st) => `<label><input type="checkbox" name="e-loc" value="${esc(l)}" data-state="${esc(st)}"${chosen.includes(l) ? " checked" : ""}> ${esc(l)}</label>`;
        host.innerHTML = sts.map((st) => `<fieldset class="loc-group"><legend>${esc(st)}</legend>
            <p class="loc-tools"><button type="button" class="link-btn" data-all="${esc(st)}">Select all</button> &nbsp; <button type="button" class="link-btn" data-none="${esc(st)}">Clear</button></p>
            <div class="loc-grid">${(LOCALITIES[st] || []).map((l) => box(l, st)).join("")}</div></fieldset>`).join("") +
          (other.length && !nw ? `<fieldset class="loc-group"><legend>Not in the OCHA list for the chosen states</legend><div class="loc-grid">${other.map((l) => box(l, "_other")).join("")}</div></fieldset>` : "");
        g("loc-check").textContent = nw ? "Localities cannot be chosen for nationwide projects." : sts.length ? "Tick the localities where the project works." : "Choose the states first; their localities appear here.";
        host.querySelectorAll("[data-all],[data-none]").forEach((b) => b.addEventListener("click", () => {
          const st = b.dataset.all || b.dataset.none;
          host.querySelectorAll(`input[data-state="${CSS.escape(st)}"]`).forEach((i) => (i.checked = !!b.dataset.all));
          refresh();
        }));
      }
      // photos
      function drawPhotos() {
        const host = g("e-photos");
        host.innerHTML = state.photos.map((p, i) => `<div class="ph"><img src="${esc(p.url)}" alt=""><div><span>${esc(p.label || (p.path ? "On the map" : "New"))}</span><button type="button" data-rm="${i}">Remove</button></div></div>`).join("") +
          (state.photos.length < 3 ? `<label class="ph-add">Add a photo<br>(made smaller automatically)<input type="file" accept="image/*" id="e-ph-in" multiple></label>` : "");
        host.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
          const p = state.photos.splice(Number(b.dataset.rm), 1)[0];
          if (p.file && state.deleteFileNow) await api(`/file/${p.file}`, { method: "DELETE" }).catch(() => {});
          drawPhotos(); refresh();
        }));
        g("e-ph-in")?.addEventListener("change", async (e) => {
          for (const f of [...e.target.files].slice(0, 3 - state.photos.length)) {
            try {
              const img = await SF.shrinkImage(f);
              const r = await api("/file", { method: "POST", body: { owner: state.owner, kind: "photo", image: img } });
              state.photos.push({ file: r.file, url: r.url, label: SF.fmtSize(img.size) });
            } catch (err) { alert(err.message); }
          }
          drawPhotos(); refresh();
        });
      }
      drawPhotos();
      const host = document.querySelector(".split");
      host.addEventListener("input", refresh);
      host.addEventListener("change", (e) => { if (e.target.name === "e-states" || e.target.id === "e-nationwide") drawLocalities(); refresh(); });
      drawLocalities(true);
      refresh();
      return { values, priv, refresh };
    }
    function previewCard(v, photos) {
      const p = SF.enrich(JSON.parse(JSON.stringify({ ...v, id: "pv", photos: photos.map((x) => x.url) })));
      return SF.render.card(p);
    }
    function openPopup(v, photos, title) {
      const p = SF.enrich(JSON.parse(JSON.stringify({ ...v, id: "pv", photos: photos.map((x) => x.url) })));
      const d = document.getElementById("detail");
      d.innerHTML = `<button type="button" class="modal-close" aria-label="Close" data-close>&times;</button>
        <div class="modal-scroll"><div class="hero">${SF.render.hero(p)}</div>${SF.render.body(p, GEO)}</div>`;
      d.querySelector("[data-close]").addEventListener("click", () => d.close());
      d.showModal();
    }
    function openCompare(a, b) {
      const d = document.getElementById("detail");
      const pa = SF.enrich(JSON.parse(JSON.stringify({ ...a.data, id: "a", photos: [] })));
      const pb = SF.enrich(JSON.parse(JSON.stringify({ ...b.data, id: "b", photos: [] })));
      d.style.width = "min(1180px, calc(100vw - 24px))";
      d.innerHTML = `<button type="button" class="modal-close" aria-label="Close" data-close>&times;</button>
        <div class="modal-scroll"><div class="cmp"><div><p class="pv-ref" style="padding:16px 22px 0">${esc(a.label)}</p>${SF.render.body(pa, GEO)}</div><div><p class="pv-ref" style="padding:16px 22px 0">${esc(b.label)}</p>${SF.render.body(pb, GEO)}</div></div></div>`;
      d.querySelector("[data-close]").addEventListener("click", () => { d.close(); d.style.width = ""; });
      d.showModal();
    }
    // Which fields differ between two versions of a project
    const FIELD_LABELS = { name: "Project name", description: "Description", interventionTypes: "Intervention type", orgType: "Organisation type", lead: "Lead organisation", leadership: "Leadership", partners: "Partners", nationwide: "Nationwide", states: "States", localities: "Localities", criteria: "IASC criteria", coordination: "Coordination", start: "Start", end: "End", reportedStatus: "Reported status", budget: "Budget", share: "Share", donors: "Donors", people: "People", remarks: "Remarks" };
    function diff(a, b) {
      const norm = (k, v) => k === "start" || k === "end" ? monthOf(v) : k === "share" && v != null ? Math.round(v * 1000) : Array.isArray(v) ? [...v].map(String).sort().join("|") : v && typeof v === "object" ? JSON.stringify(v) : v ?? "";
      const dn = (o) => (o.donors && o.donors.length ? o.donors : o.donor ? [{ name: o.donor, amount: null }] : []).map((x) => `${x.name}|${x.amount ?? ""}`).join(";");
      return Object.keys(FIELD_LABELS).filter((k) => (k === "donors" ? dn(a) !== dn(b) : String(norm(k, a[k])) !== String(norm(k, b[k]))));
    }
    const show = (k, v) => k === "start" || k === "end" ? SF.fmtMonth(SF.parseDate(v)) : k === "share" ? SF.fmtPct(v) : k === "budget" ? SF.fmtUSD(v) : k === "people" ? (v && v.total != null ? SF.fmtInt(v.total) : "") : k === "donors" ? (v || []).map((x) => (x.amount != null ? `${x.name}: ${SF.fmtUSD(x.amount)}` : x.name)).join(", ") : Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : v ?? "";

    /* ---------- review one submission ---------- */
    async function viewReview(id) {
      const { item: s } = await api(`/submission/${id}`);
      const pending = s.status === "pending";
      const isCorr = s.kind === "correction" && s.current;
      const keep = isCorr ? (Array.isArray(s.private._photosKeep) ? s.private._photosKeep : s.current.data.photos || []) : [];
      const state = { peopleSex: s.data.peopleSex || null, owner: s.id, photos: [...keep.map((p) => ({ path: p, url: SITE + p, label: "On the map" })), ...s.photos.map((p) => ({ ...p, label: SF.fmtSize(p.size || 0) }))], deleteFileNow: false };
      let asUpdateOf = null;
      const dup = s.checks.find((c) => c.kind === "duplicate");
      app.innerHTML = `
        <a href="#/queue">Back to the queue</a>
        <div class="row between">
          <div><div class="muted" style="font-size:13px">${esc(s.ref || "")} · received ${fmtWhen(s.receivedAt)} from ${s.source === "agency" ? `${esc(s.byName || s.by || "")} (${esc(s.data.lead)} admin)` : s.source === "excel" ? `an Excel upload${s.row ? ` (row ${s.row})` : ""}` : isCorr ? "Suggest a correction" : "the form"}</div>
          <h1 id="rv-title">${esc(s.data.name || "")}</h1></div>
          <span class="pill2 ${pending ? "info" : s.status === "published" ? "ok" : "mute"}">${pending ? (isCorr ? "Correction awaiting review" : "Awaiting review") : s.status === "published" ? `Published ${fmtDay(s.reviewedAt)}` : `Not published ${fmtDay(s.reviewedAt)}`}</span>
        </div>
        <div class="split">
          <div class="main">${editorHTML(s.data, s.private, { note: s.note || "" })}</div>
          <aside class="side">
            <section class="card ed"><h2>Checks</h2><div class="checks" id="checks"></div></section>
            ${s.logo ? `<section class="card ed"><h2>Logo sent with the project</h2><img src="${esc(s.logo.url)}" alt="Logo" style="max-height:70px;max-width:220px;object-fit:contain"><small class="muted">It is added to the map for ${esc(s.data.lead)} when you publish.</small></section>` : ""}
            <section class="card" style="overflow:hidden">
              <div style="padding:14px 18px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line)">How it will look on the map</div>
              <div style="padding:14px" id="pv-card"></div>
              <div style="padding:0 18px 16px"><button type="button" class="linkish" id="pv-open">Open the full pop-up</button></div>
            </section>
          </aside>
        </div>
        ${pending ? `<div class="card bar-actions">
          <button type="button" class="btn btn-danger" id="b-reject">Do not publish</button>
          <a class="btn" id="b-reply" href="#">Reply to the submitter</a>
          <button type="button" class="btn" id="b-save">Save changes</button>
          <span class="grow"></span>
          <span class="muted" style="font-size:13px">The map updates about 2 minutes after publishing</span>
          <button type="button" class="btn btn-primary" id="b-publish">Publish to the map</button>
        </div>` : `<div class="card bar-actions"><span class="muted grow" style="font-size:14px">${s.note ? `Note: ${esc(s.note)}` : "This submission has been reviewed."}</span>${s.status === "rejected" ? `<button type="button" class="btn" id="b-reopen">Move back to the queue</button>` : ""}</div>`}`;

      function drawChecks(v) {
        const items = [];
        s.checks.forEach((c) => {
          if (c.kind === "duplicate") {
            items.push(`<div class="chk warn">${ICON_WARN}<div><b>Possible duplicate.</b> ${esc(c.text)}.
              <div class="row" style="gap:12px;margin-top:6px"><button type="button" class="linkish" id="c-compare" style="color:inherit">Compare side by side</button>
              ${pending ? `<label class="row" style="gap:6px"><input type="checkbox" id="c-update"${asUpdateOf ? " checked" : ""}> Treat as an update to ${esc(c.ref || "")}</label>` : ""}</div></div></div>`);
          } else if (c.level === "error") items.push(`<div class="chk error">${ICON_WARN}<span>${esc(c.text)}</span></div>`);
          else if (c.level === "warn") items.push(`<div class="chk warn">${ICON_WARN}<span>${esc(c.text)}</span></div>`);
          else items.push(`<div class="chk">${ICON_WARN.replace("currentColor", "var(--muted)")}<span>${esc(c.text)}</span></div>`);
        });
        if (isCorr) {
          const changed = diff(v, s.current.data);
          document.querySelectorAll(".f.changed").forEach((f) => f.classList.remove("changed"));
          document.querySelectorAll(".was").forEach((x) => x.remove());
          changed.forEach((k) => { const f = document.querySelector(`[data-k="${k}"]`); if (f) { f.classList.add("changed"); f.insertAdjacentHTML("beforeend", `<span class="was">On the map now: ${esc(show(k, s.current.data[k])) || "empty"}</span>`); } });
          items.unshift(`<div class="chk">${ICON_OK}<span>Correction to ${esc(s.current.ref || "")}: <b>${changed.length}</b> field${changed.length === 1 ? "" : "s"} changed${changed.length ? ` (${changed.map((k) => FIELD_LABELS[k].toLowerCase()).join(", ")})` : ""}. Changed fields are outlined.</span></div>`);
        }
        if (!s.checks.some((c) => c.level !== "info") && !isCorr) items.unshift(`<div class="chk">${ICON_OK}<span>No problems found</span></div>`);
        document.getElementById("checks").innerHTML = items.join("");
        document.getElementById("c-compare")?.addEventListener("click", async () => {
          const { item } = await api(`/project/${encodeURIComponent(dup.id)}`);
          openCompare({ label: `This submission (${s.ref})`, data: ed.values() }, { label: `On the map now (${item.ref})`, data: item.data });
        });
        document.getElementById("c-update")?.addEventListener("change", (e) => { asUpdateOf = e.target.checked ? dup.id : null; });
      }
      const ed = bindEditor(state, (v) => {
        document.getElementById("pv-card").innerHTML = previewCard(v, state.photos);
        document.getElementById("rv-title").textContent = v.name || "Untitled";
        if (document.getElementById("checks")) drawChecks(v);
      });
      drawChecks(ed.values());
      document.getElementById("pv-open").addEventListener("click", () => openPopup(ed.values(), state.photos));

      const body = () => ({ data: ed.values(), private: { ...ed.priv(), ...(s.private._photosKeep ? { _photosKeep: s.private._photosKeep } : {}) }, note: document.getElementById("e-note")?.value || "", photos: state.photos.filter((p) => p.file), photosFinal: state.photos.map((p) => (p.path ? { path: p.path } : { file: p.file })), asUpdateOf });
      document.getElementById("b-save")?.addEventListener("click", async (e) => {
        busy(e.target, true, "Saving");
        try { await api(`/submission/${s.id}`, { method: "PUT", body: body() }); SF.toast("Saved"); } catch (err) { alert(err.message); }
        busy(e.target, false);
      });
      document.getElementById("b-publish")?.addEventListener("click", async (e) => {
        const btns = document.querySelectorAll(".bar-actions .btn");
        busy(e.target, true, "Publishing");
        btns.forEach((b) => (b.disabled = true));
        try {
          await api(`/submission/${s.id}`, { method: "PUT", body: body() });
          const r = await api(`/submission/${s.id}/publish`, { method: "POST", body: body() });
          SF.toast(`${r.ref} published. The map updates in about 2 minutes.`);
          location.hash = "#/queue";
        } catch (err) { alert(err.message); busy(e.target, false); btns.forEach((b) => (b.disabled = false)); }
      });
      document.getElementById("b-reject")?.addEventListener("click", async (e) => {
        const note = prompt("Not publishing this project. Add a short internal note (optional):", "");
        if (note === null) return;
        busy(e.target, true, "Saving");
        try { await api(`/submission/${s.id}/reject`, { method: "POST", body: { note } }); SF.toast("Moved to Not published"); location.hash = "#/queue"; }
        catch (err) { alert(err.message); busy(e.target, false); }
      });
      document.getElementById("b-reopen")?.addEventListener("click", async () => { await api(`/submission/${s.id}/reopen`, { method: "POST", body: {} }); route(); });
      const reply = document.getElementById("b-reply");
      if (reply) {
        const upd = () => { const v = ed.values(), p = ed.priv(); reply.href = `mailto:${encodeURIComponent(s.by || p.fpEmail || "")}?cc=${SF.config.contactEmail}&subject=${encodeURIComponent(`Your project ${s.ref} for the Solutions Footprint: ${v.name}`)}&body=${encodeURIComponent(`Dear ${p.fpName || "colleague"},\r\n\r\nThank you for submitting "${v.name}" (${s.ref}) to the Solutions Footprint.\r\n\r\n\r\n\r\nKind regards,\r\nDurable Solutions Unit, RCO Sudan`)}`; };
        upd(); document.querySelector(".split").addEventListener("input", upd);
      }
    }

    /* ---------- all projects ---------- */
    async function viewProjects() {
      if (AGENCY) return viewAgencyProjects();
      const { items } = await api("/projects");
      app.innerHTML = `
        <div class="row between">
          <div><h1>All projects</h1><p class="lede2">Everything in the database. Edit a project and press <b>Save and publish</b> to update the map.</p></div>
          <div class="row"><button type="button" class="btn" id="b-export">Download a backup (JSON)</button><a class="btn btn-primary" href="#/project/new">Add a project yourself</a></div>
        </div>
        ${!items.length ? `<div class="note-box">No projects yet. Go to the <a href="#/queue">Review queue</a> and import the current map data first.</div>` : ""}
        <div class="card tbl-card">
          <div class="tbl-tools"><span class="muted" style="font-size:14px">${items.filter((i) => i.published).length} on the map, ${items.filter((i) => !i.published).length} hidden</span><span class="grow"></span>
            <label class="row" style="gap:8px;font-size:14px;color:var(--muted)">Search <input class="input" type="search" id="q" placeholder="Name, number, agency or state" style="width:260px"></label></div>
          <div class="tbl-wrap"><table class="adm"><thead><tr><th>Number</th><th>Project</th><th>Lead</th><th>States</th><th>Dates</th><th>Budget</th><th>People</th><th>Map</th></tr></thead>
          <tbody>${items.map((i) => `<tr class="click" data-id="${esc(i.id)}" data-q="${esc(`${i.ref} ${i.name} ${i.lead} ${i.states.join(" ")}`.toLowerCase())}">
            <td class="ref">${esc(i.ref || "")}</td><td>${esc(i.name)}</td><td>${esc(i.lead)}</td><td>${esc(i.states.join(", "))}</td>
            <td style="white-space:nowrap">${fmtDates(i.start, i.end)}</td><td>${SF.fmtMoney(i.budget)}</td><td>${i.people == null ? '<span class="pill2 warn">Empty</span>' : SF.fmtInt(i.people)}</td>
            <td>${i.published ? '<span class="pill2 ok">On the map</span>' : '<span class="pill2 mute">Hidden</span>'}</td></tr>`).join("")}</tbody></table></div>
        </div>`;
      app.querySelectorAll("tr.click").forEach((tr) => tr.addEventListener("click", () => (location.hash = `#/project/${encodeURIComponent(tr.dataset.id)}`)));
      document.getElementById("b-export").addEventListener("click", async (e) => {
        busy(e.target, true, "Preparing");
        try {
          const r = await fetch(API + "/export", { headers: { Authorization: `Bearer ${SF.auth.get()?.token || ""}` } });
          if (!r.ok) throw new Error("The backup could not be made. Please sign in again and retry.");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(await r.blob());
          a.download = `solutions-footprint-backup-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        } catch (err) { alert(err.message); }
        busy(e.target, false);
      });
      const q = document.getElementById("q");
      q.addEventListener("input", () => app.querySelectorAll("tr[data-q]").forEach((tr) => (tr.hidden = !tr.dataset.q.includes(q.value.toLowerCase().trim()))));
    }

    /* ---------- edit one published project (or add one) ---------- */
    async function viewProject(id) {
      if (AGENCY) return viewAgencyProject(id);
      const isNew = id === "new";
      const item = isNew ? { id: "new", ref: "", published: true, data: { people: {}, states: [], criteria: [], interventionTypes: [], leadership: [], partners: [], localities: [] }, private: {}, photos: [] } : (await api(`/project/${encodeURIComponent(id)}`)).item;
      const state = { peopleSex: item.data.peopleSex || null, owner: `project:${isNew ? "new" : item.id}`, photos: item.photos.map((p) => ({ ...p, label: p.path ? "On the map" : "New" })), deleteFileNow: true };
      app.innerHTML = `
        <a href="#/projects">Back to all projects</a>
        <div class="row between">
          <div><div class="muted" style="font-size:13px">${isNew ? "New project, added by DSU" : `${esc(item.ref || "")} · last changed ${fmtWhen(item.updatedAt)}`}</div><h1 id="rv-title">${esc(item.data.name || "New project")}</h1></div>
          ${isNew ? "" : `<span class="pill2 ${item.published ? "ok" : "mute"}">${item.published ? "On the map" : "Hidden from the map"}</span>`}
        </div>
        <div class="split">
          <div class="main">${editorHTML(item.data, item.private)}</div>
          <aside class="side">
            <section class="card" style="overflow:hidden">
              <div style="padding:14px 18px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line)">How it looks on the map</div>
              <div style="padding:14px" id="pv-card"></div>
              <div style="padding:0 18px 16px"><button type="button" class="linkish" id="pv-open">Open the full pop-up</button></div>
            </section>
            ${isNew ? "" : `<section class="card ed"><h2>Project code</h2><p style="margin:0;font-size:14px"><b>${esc(item.ref || "")}</b><br>Country, number, lead agency, start year and end year. The number never changes and is never reused; the agency and years update when the lead or dates change.</p></section>`}
          </aside>
        </div>
        <div class="card bar-actions">
          ${isNew ? "" : `<button type="button" class="btn btn-danger" id="b-delete">Delete</button>
          <button type="button" class="btn" id="b-hide">${item.published ? "Hide from the map" : "Keep hidden, save changes"}</button>`}
          <span class="grow"></span>
          <span class="muted" style="font-size:13px">The map updates about 2 minutes after saving</span>
          <button type="button" class="btn btn-primary" id="b-publish">${isNew ? "Publish to the map" : item.published ? "Save and publish" : "Save and put back on the map"}</button>
        </div>
        ${isNew ? "" : `<section class="card tbl-card"><div class="tbl-tools"><b style="font-weight:600">History of this project</b></div><div class="tbl-wrap" id="p-log"><div class="empty">Loading…</div></div></section>`}`;
      const ed = bindEditor(state, (v) => {
        document.getElementById("pv-card").innerHTML = previewCard(v, state.photos);
        document.getElementById("rv-title").textContent = v.name || "New project";
      });
      document.getElementById("pv-open").addEventListener("click", () => openPopup(ed.values(), state.photos));
      if (!isNew) drawProjectLog(item.id);
      const save = async (btn, published) => {
        const btns = document.querySelectorAll(".bar-actions .btn");
        busy(btn, true, "Publishing"); btns.forEach((b) => (b.disabled = true));
        try {
          const r = await api(`/project/${encodeURIComponent(isNew ? "new" : item.id)}`, { method: "PUT", body: { data: ed.values(), private: ed.priv(), photos: state.photos.map((p) => (p.path ? { path: p.path } : { file: p.file })), published } });
          SF.toast(`${r.ref} saved. The map updates in about 2 minutes.`);
          location.hash = `#/project/${encodeURIComponent(r.id)}`;
          if (!isNew) route();
        } catch (err) { alert(err.message); busy(btn, false); btns.forEach((b) => (b.disabled = false)); }
      };
      document.getElementById("b-publish").addEventListener("click", (e) => save(e.target, true));
      document.getElementById("b-hide")?.addEventListener("click", (e) => save(e.target, false));
      document.getElementById("b-delete")?.addEventListener("click", async (e) => {
        if (!confirm(`Delete ${item.ref} "${item.data.name}" from the database and the map? Its number will not be reused. To keep it but take it off the map, use "Hide from the map" instead.`)) return;
        busy(e.target, true, "Deleting");
        try { await api(`/project/${encodeURIComponent(item.id)}`, { method: "DELETE" }); SF.toast("Deleted"); location.hash = "#/projects"; }
        catch (err) { alert(err.message); busy(e.target, false); }
      });
    }

    /* ---------- organisations and logos ---------- */
    async function viewOrgs() {
      const { logos, leads } = await api("/orgs");
      const byKey = Object.fromEntries(logos.map((l) => [l.acronym, l]));
      const keys = [...new Set([...leads.map((l) => l.lead).filter(Boolean), ...logos.map((l) => l.acronym)])].sort();
      const orgName = (k) => (byKey[k] && byKey[k].name) || (ORGS.find((o) => o.acronym === k) || {}).name || "";
      app.innerHTML = `
        <div><h1>Organisations</h1><p class="lede2">Lead organisations on the map and their logos. A logo you add here is published straight away.</p></div>
        <div class="card tbl-card"><div class="tbl-wrap"><table class="adm"><thead><tr><th>Organisation</th><th>Projects</th><th>Logo</th><th><span class="sr-only">Action</span></th></tr></thead>
        <tbody>${keys.map((k) => { const l = leads.find((x) => x.lead === k) || { n: 0 }; return `<tr>
          <td><b style="font-weight:500">${esc(k)}</b><br><span class="muted" style="font-size:13px">${esc(orgName(k))}</span></td>
          <td>${l.n || 0}</td>
          <td class="logo-cell">${byKey[k] ? `<img src="${esc(byKey[k].fullUrl)}" alt="${esc(k)} logo">` : '<span class="pill2 warn">No logo</span>'}</td>
          <td><label class="btn btn-sm">${byKey[k] ? "Replace" : "Add logo"}<input type="file" accept="image/png,image/jpeg,image/webp" data-org="${esc(k)}" hidden></label></td></tr>`; }).join("")}</tbody></table></div></div>
        <section class="card ed"><h2>Add a logo for another organisation</h2>
          <div class="g3"><label class="f">Acronym<input class="input" id="o-acr" list="dl-orgs2"></label><label class="f">Full name<input class="input" id="o-name"></label>
          <label class="f">Logo file<input class="input" type="file" id="o-file" accept="image/png,image/jpeg,image/webp"></label></div>
          <datalist id="dl-orgs2">${ORGS.map((o) => `<option value="${esc(o.acronym)}">`).join("")}</datalist>
          <div><button type="button" class="btn btn-primary" id="o-go">Publish logo</button></div>
        </section>`;
      const upload = async (acr, name, file, btn) => {
        if (!acr || !file) return alert("Choose the organisation and a logo file.");
        busy(btn, true, "Publishing");
        try {
          const img = await SF.shrinkImage(file, { keepPng: true, maxSide: 800 });
          await api("/logo", { method: "POST", body: { acronym: acr, name: name || orgName(acr) || acr, image: img } });
          SF.toast(`Logo for ${acr} published`); route();
        } catch (err) { alert(err.message); busy(btn, false); }
      };
      app.querySelectorAll("input[data-org]").forEach((i) => i.addEventListener("change", () => upload(i.dataset.org, "", i.files[0], i.closest("label"))));
      document.getElementById("o-acr").addEventListener("change", (e) => { const n = orgName(e.target.value.trim()); if (n && !document.getElementById("o-name").value) document.getElementById("o-name").value = n; });
      document.getElementById("o-go").addEventListener("click", (e) => upload(document.getElementById("o-acr").value.trim(), document.getElementById("o-name").value.trim(), document.getElementById("o-file").files[0], e.target));
    }

    /* ---------- history: the change log ---------- */
    const ACTIONS = { published: "Published", updated: "Published changes", added: "Added", edited: "Edited", hidden: "Hidden from the map", deleted: "Deleted",
      "not published": "Not published", "sent for review": "Sent for review", logo: "Logo", import: "Import", "editor added": "Person added", "editor changed": "Person changed", "editor removed": "Person removed", "code changed": "Code changed", codes: "Project codes" };
    const actionText = (a) => ACTIONS[a] || (a ? a[0].toUpperCase() + a.slice(1) : "");
    function changesHTML(changes) {
      if (!changes || !changes.length) return "";
      return `<details class="chg"><summary>${changes.length} field${changes.length === 1 ? "" : "s"} changed</summary><table class="chg-t"><tbody>${changes.map((c) =>
        `<tr><th>${esc(c.field)}</th><td><span class="chg-from">${esc(c.from) || "<i>empty</i>"}</span> <span aria-hidden="true">→</span> <span class="chg-to">${esc(c.to) || "<i>empty</i>"}</span></td></tr>`).join("")}</tbody></table></details>`;
    }
    function logRows(items, repo) {
      return items.map((i) => `<tr data-q="${esc(`${i.at} ${i.action} ${i.detail} ${i.by_name} ${i.by_email} ${(i.changes || []).map((c) => c.field).join(" ")}`.toLowerCase())}">
        <td style="white-space:nowrap">${fmtWhen(i.at)}</td>
        <td>${i.by_name || i.by_email ? esc(i.by_name || i.by_email) : '<span class="muted">Automatic</span>'}${i.by_name && i.by_email ? `<br><span class="muted" style="font-size:12px">${esc(i.by_email)}</span>` : ""}</td>
        <td>${esc(actionText(i.action))}</td>
        <td>${esc(i.detail || "")}${changesHTML(i.changes)}</td>
        <td class="gh">${i.commit_sha ? `<a href="https://github.com/${esc(repo)}/commit/${esc(i.commit_sha)}" target="_blank" rel="noopener">${esc(i.commit_sha.slice(0, 7))}</a>` : ""}</td></tr>`).join("");
    }
    function logCsv(items) {
      const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const rows = [["When (UTC)", "Name", "Email", "What", "Details", "Field", "Before", "After", "GitHub commit"]];
      items.forEach((i) => {
        const base = [i.at, i.by_name || (i.by_email ? "" : "Automatic"), i.by_email, actionText(i.action), i.detail];
        if (i.changes && i.changes.length) i.changes.forEach((c) => rows.push([...base, c.field, c.from, c.to, i.commit_sha || ""]));
        else rows.push([...base, "", "", "", i.commit_sha || ""]);
      });
      const blob = new Blob(["\ufeff" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `solutions-footprint-change-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    // The GitHub column stays closed until someone opens it
    const ghToggle = () => `<button type="button" class="linkish gh-toggle" aria-expanded="false" style="font-size:13px;margin-left:12px">Show GitHub commits</button>`;
    function bindGhToggle(root) {
      root.querySelectorAll(".gh-toggle").forEach((b) => b.addEventListener("click", () => {
        const t = b.closest(".tbl-card, #p-log").querySelector("table.log-t");
        const open = t.classList.toggle("hide-gh") === false;
        b.textContent = open ? "Hide GitHub commits" : "Show GitHub commits"; b.setAttribute("aria-expanded", String(open));
      }));
    }
    async function viewHistory() {
      const { items, repo } = await api("/log?limit=5000");
      app.innerHTML = `
        <div class="row between">
          <div><h1>History</h1><p class="lede2">The change log: every change, who made it and when. For project edits, open "fields changed" to see each value before and after. Changes to the map are also commits on GitHub, so they can be undone there.</p></div>
          <button type="button" class="btn" id="b-csv">Download the log (Excel CSV)</button>
        </div>
        <div class="card tbl-card">
          <div class="tbl-tools"><span class="muted" style="font-size:14px">${items.length} entr${items.length === 1 ? "y" : "ies"}</span>${ghToggle()}<span class="grow"></span>
            <label class="row" style="gap:8px;font-size:14px;color:var(--muted)">Search <input class="input" type="search" id="q" placeholder="Name, project, number or field" style="width:260px"></label></div>
          <div class="tbl-wrap">${items.length ? `<table class="adm log-t hide-gh"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th class="gh">GitHub</th></tr></thead><tbody>${logRows(items, repo)}</tbody></table>` : `<div class="empty">Nothing yet.</div>`}</div>
        </div>`;
      document.getElementById("b-csv").addEventListener("click", () => logCsv(items));
      bindGhToggle(app);
      const q = document.getElementById("q");
      q.addEventListener("input", () => app.querySelectorAll("tr[data-q]").forEach((tr) => (tr.hidden = !tr.dataset.q.includes(q.value.toLowerCase().trim()))));
    }
    async function drawProjectLog(id) {
      const host = document.getElementById("p-log");
      if (!host) return;
      try {
        const { items, repo } = await api(`/log?project=${encodeURIComponent(id)}&limit=200`);
        host.innerHTML = items.length ? `<div class="tbl-tools" style="border-top:0">${ghToggle()}</div><table class="adm log-t hide-gh"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th class="gh">GitHub</th></tr></thead><tbody>${logRows(items, repo)}</tbody></table>`
          : `<div class="empty">No changes recorded yet. Changes made from now on are listed here.</div>`;
        bindGhToggle(host);
      } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    }

    /* ---------- agency admins: their own agency's projects ---------- */
    async function viewAgencyProjects() {
      const { items } = await api("/projects");
      app.innerHTML = `
        <div class="row between">
          <div><h1>${esc(AGENCY)} projects</h1><p class="lede2">Projects led by ${esc(AGENCY)}. Edit one and press <b>Send to DSU for review</b>. The map changes once the Durable Solutions Unit publishes it.</p></div>
          <a class="btn btn-primary" href="#/project/new">Add a new ${esc(AGENCY)} project</a>
        </div>
        <div class="card tbl-card">
          <div class="tbl-tools"><span class="muted" style="font-size:14px">${items.length} project${items.length === 1 ? "" : "s"}</span><span class="grow"></span>
            <label class="row" style="gap:8px;font-size:14px;color:var(--muted)">Search <input class="input" type="search" id="q" placeholder="Name, number or state" style="width:240px"></label></div>
          <div class="tbl-wrap">${items.length ? `<table class="adm"><thead><tr><th>Number</th><th>Project</th><th>States</th><th>Dates</th><th>Budget</th><th>People</th><th>Status</th></tr></thead>
          <tbody>${items.map((i) => `<tr class="click" data-id="${esc(i.id)}" data-q="${esc(`${i.ref} ${i.name} ${i.states.join(" ")}`.toLowerCase())}">
            <td class="ref">${esc(i.ref || "")}</td><td>${esc(i.name)}</td><td>${esc(i.states.join(", "))}</td>
            <td style="white-space:nowrap">${fmtDates(i.start, i.end)}</td><td>${SF.fmtMoney(i.budget)}</td><td>${i.people == null ? '<span class="pill2 warn">Empty</span>' : SF.fmtInt(i.people)}</td>
            <td>${i.pending ? '<span class="pill2 info">Sent for review</span>' : i.published ? '<span class="pill2 ok">On the map</span>' : '<span class="pill2 mute">Hidden</span>'}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No ${esc(AGENCY)} projects on the map yet. Use "Add a new ${esc(AGENCY)} project".</div>`}</div>
        </div>`;
      app.querySelectorAll("tr.click").forEach((tr) => tr.addEventListener("click", () => (location.hash = `#/project/${encodeURIComponent(tr.dataset.id)}`)));
      const q = document.getElementById("q");
      q.addEventListener("input", () => app.querySelectorAll("tr[data-q]").forEach((tr) => (tr.hidden = !tr.dataset.q.includes(q.value.toLowerCase().trim()))));
    }
    async function viewAgencyProject(id) {
      const isNew = id === "new";
      const blank = { lead: AGENCY, people: {}, states: [], criteria: [], interventionTypes: [], leadership: [], partners: [], localities: [] };
      const item = isNew ? { id: "new", ref: "", data: blank, private: {}, photos: [], pending: null } : (await api(`/project/${encodeURIComponent(id)}`)).item;
      // continue from the version already sent, if it is still waiting for review
      const start = item.pending ? item.pending : item;
      const keep = item.pending && Array.isArray(item.pending.private._photosKeep) ? item.pending.private._photosKeep : (item.data.photos || []);
      const state = { peopleSex: start.data.peopleSex || null, owner: "agency", deleteFileNow: true,
        photos: [...keep.map((p) => ({ path: p, url: SITE + p, label: "On the map" })), ...(item.pending ? item.pending.photos.map((p) => ({ ...p, label: "New" })) : [])] };
      app.innerHTML = `
        <a href="#/projects">Back to ${esc(AGENCY)} projects</a>
        <div class="row between">
          <div><div class="muted" style="font-size:13px">${isNew ? `New ${esc(AGENCY)} project` : `${esc(item.ref || "")} · on the map since ${fmtDay(item.updatedAt)}`}</div><h1 id="rv-title">${esc(start.data.name || "New project")}</h1></div>
          ${item.pending ? '<span class="pill2 info">Sent for review</span>' : isNew ? "" : '<span class="pill2 ok">On the map</span>'}
        </div>
        ${item.pending ? `<div class="note-box">You sent changes on ${fmtWhen(item.pending.at)}. They are waiting for review by the Durable Solutions Unit. You can still change them: sending again replaces your earlier version.</div>` : ""}
        <div class="split">
          <div class="main">${editorHTML(start.data, start.private || {})}</div>
          <aside class="side">
            <section class="card" style="overflow:hidden">
              <div style="padding:14px 18px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line)">How it will look on the map</div>
              <div style="padding:14px" id="pv-card"></div>
              <div style="padding:0 18px 16px"><button type="button" class="linkish" id="pv-open">Open the full pop-up</button></div>
            </section>
            <section class="card ed"><h2>What happens next</h2><p style="margin:0;font-size:14px;line-height:1.5">Your changes go to the Durable Solutions Unit. They check them and publish them to the map, usually within a few working days. See <a href="#/changes">Sent for review</a>.</p></section>
          </aside>
        </div>
        <div class="card bar-actions">
          <span class="grow"></span>
          <span class="muted" style="font-size:13px">Nothing changes on the map until DSU publishes</span>
          <button type="button" class="btn btn-primary" id="b-send">Send to DSU for review</button>
        </div>`;
      // the lead organisation stays the agency; the private section is the agency's own focal point
      const lead = document.getElementById("e-lead");
      lead.value = item.data.lead || AGENCY; lead.readOnly = true; lead.title = "Projects stay under your agency";
      const privH = [...app.querySelectorAll(".ed h2")].find((h) => /Private to DSU/.test(h.textContent));
      if (privH) privH.innerHTML = "Focal point <small>Never published on the map</small>";
      const ed = bindEditor(state, (v) => {
        document.getElementById("pv-card").innerHTML = previewCard(v, state.photos);
        document.getElementById("rv-title").textContent = v.name || "New project";
      });
      document.getElementById("pv-open").addEventListener("click", () => openPopup(ed.values(), state.photos));
      document.getElementById("b-send").addEventListener("click", async (e) => {
        busy(e.target, true, "Sending");
        try {
          const r = await api(`/project/${encodeURIComponent(isNew ? "new" : item.id)}`, { method: "PUT", body: { data: { ...ed.values(), lead: lead.value }, private: ed.priv(), photos: state.photos.map((p) => (p.path ? { path: p.path } : { file: p.file })) } });
          SF.toast(`${r.ref} sent to DSU for review`);
          location.hash = "#/changes";
        } catch (err) { alert(err.message); busy(e.target, false); }
      });
    }
    async function viewChanges() {
      const { items } = await api("/changes");
      const st = (i) => i.status === "pending" ? '<span class="pill2 info">Waiting for review</span>' : i.status === "published" ? '<span class="pill2 ok">Published</span>' : '<span class="pill2 mute">Not published</span>';
      app.innerHTML = `
        <div><h1>Sent for review</h1><p class="lede2">Changes and new projects you sent to the Durable Solutions Unit, and what happened to them.</p></div>
        <div class="card tbl-card"><div class="tbl-wrap">${items.length ? `<table class="adm"><thead><tr><th>Sent</th><th>Number</th><th>Project</th><th>Type</th><th>Status</th></tr></thead><tbody>
          ${items.map((i) => `<tr${i.status === "pending" && i.targetId ? ` class="click" data-id="${esc(i.targetId)}"` : ""}><td style="white-space:nowrap">${fmtWhen(i.receivedAt)}</td><td class="ref">${esc(i.ref || "")}</td><td>${esc(i.name)}</td>
            <td>${i.kind === "new" ? "New project" : "Changes"}</td><td>${st(i)}${i.reviewedAt ? `<br><span class="muted" style="font-size:13px">${fmtDay(i.reviewedAt)}</span>` : ""}</td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">Nothing sent yet. Open one of your <a href="#/projects">${esc(AGENCY)} projects</a> to suggest changes.</div>`}</div></div>`;
      app.querySelectorAll("tr.click").forEach((tr) => tr.addEventListener("click", () => (location.hash = `#/project/${encodeURIComponent(tr.dataset.id)}`)));
    }

    /* ---------- approved editors ---------- */
    async function viewEditors() {
      const { items, me, leads } = await api("/editors");
      const agencies = [...new Set([...(leads || []), ...ORGS.map((o) => o.acronym)])].filter(Boolean).sort();
      const roleText = (i) => (i.role === "agency" ? `${esc(i.agency)} admin` : "DSU admin");
      app.innerHTML = `
        <div><h1>Approved editors</h1><p class="lede2">Only these people can sign in. Anyone else is asked to contact the DSWG or their agency focal point. Removing someone signs them out at once.</p></div>
        <div class="card tbl-card"><div class="tbl-wrap"><table class="adm"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Can see</th><th>Last signed in</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>
          ${items.map((i) => `<tr>
            <td><b style="font-weight:500">${esc(i.name || "")}</b>${i.email === me ? ' <span class="pill2 info">You</span>' : ""}</td>
            <td>${esc(i.email)}</td>
            <td>${roleText(i)}${i.owner ? ' <span class="pill2 mute">Owner</span>' : ""}</td>
            <td>${i.role === "agency" ? `${esc(i.agency)} projects only; changes go to the review queue` : "All projects; can publish"}</td>
            <td>${i.last_signin ? fmtWhen(i.last_signin) : '<span class="muted">Not yet</span>'}</td>
            <td style="white-space:nowrap"><button type="button" class="btn btn-sm" data-edit="${esc(i.email)}">Edit</button>${i.owner ? "" : ` <button type="button" class="btn btn-sm btn-danger" data-rm="${esc(i.email)}">Remove</button>`}</td></tr>`).join("")}
        </tbody></table></div></div>
        <section class="card ed"><h2 id="ed-title">Add a person</h2>
          <form class="ed-add" id="ed-form">
            <label class="f">Name<input class="input" id="ed-name" required placeholder="First and last name"></label>
            <label class="f">Work email<input class="input" type="email" id="ed-email" required placeholder="name@un.org"></label>
            <label class="f sm">Role<select class="input" id="ed-role"><option value="agency">Agency admin</option><option value="admin">DSU admin</option></select></label>
            <label class="f sm" id="ed-agency-wrap">Agency<input class="input" id="ed-agency" list="dl-agencies" placeholder="For example IOM"></label>
            <button type="submit" class="btn btn-primary" id="ed-go">Add</button>
            <button type="button" class="btn" id="ed-cancel" hidden>Cancel</button>
          </form>
          <datalist id="dl-agencies">${agencies.map((a) => `<option value="${esc(a)}">`).join("")}</datalist>
          <div class="err-line" id="ed-err" role="alert"></div>
          <small class="muted"><b>Agency admin:</b> sees and edits only their agency's projects (the lead organisation), and can add new ones. Their changes wait in your review queue. <b>DSU admin:</b> sees everything and publishes.</small>
        </section>`;
      const g = (id) => document.getElementById(id);
      let editing = null;
      const syncRole = () => { g("ed-agency-wrap").hidden = g("ed-role").value !== "agency"; };
      g("ed-role").addEventListener("change", syncRole); syncRole();
      const reset = () => { editing = null; g("ed-form").reset(); g("ed-email").readOnly = false; g("ed-title").textContent = "Add a person"; g("ed-go").textContent = "Add"; g("ed-cancel").hidden = true; g("ed-role").disabled = false; syncRole(); };
      g("ed-cancel").addEventListener("click", reset);
      app.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
        const i = items.find((x) => x.email === b.dataset.edit);
        editing = i;
        g("ed-title").textContent = `Edit ${i.name || i.email}`; g("ed-go").textContent = "Save"; g("ed-cancel").hidden = false;
        g("ed-name").value = i.name || ""; g("ed-email").value = i.email; g("ed-email").readOnly = true;
        g("ed-role").value = i.role === "agency" ? "agency" : "admin"; g("ed-role").disabled = !!i.owner; g("ed-agency").value = i.agency || "";
        syncRole(); g("ed-name").focus(); g("ed-form").scrollIntoView({ block: "center" });
      }));
      g("ed-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = g("ed-err"), b = g("ed-go");
        const body = { name: g("ed-name").value.trim(), email: g("ed-email").value.trim(), role: g("ed-role").value, agency: g("ed-agency").value.trim() };
        if (!body.name) { err.textContent = "Please enter the person's name."; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { err.textContent = "Please enter a valid email address."; return; }
        if (body.role === "agency" && !body.agency) { err.textContent = "Choose the agency this person can edit."; return; }
        err.textContent = ""; busy(b, true, "Saving");
        try {
          if (editing) await api(`/editors/${encodeURIComponent(editing.email)}`, { method: "PUT", body });
          else await api("/editors", { method: "POST", body });
          SF.toast(`${body.name} ${editing ? "saved" : "added"}`);
          if (editing && editing.email === me) { const s = SF.auth.get(); if (s) { SF.auth.save({ ...s, name: body.name }); SF.auth.drawButton(); } }
          route();
        } catch (x) { err.textContent = x.message; busy(b, false); }
      });
      app.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
        const email = b.dataset.rm;
        if (!confirm(`Remove ${email}? They will be signed out and will not be able to sign in again.`)) return;
        busy(b, true, "Removing");
        try { await api(`/editors/${encodeURIComponent(email)}`, { method: "DELETE" }); SF.toast(`${email} removed`); if (email === me) { SF.auth.clear(); location.href = "./"; } else route(); }
        catch (x) { alert(x.message); busy(b, false); }
      }));
    }

    SF.renderHeader("manage");
    SF.renderFooter();
    loadLists().finally(() => boot().catch((e) => { if (e.message !== "Please sign in.") fail(e); }));
  })();
