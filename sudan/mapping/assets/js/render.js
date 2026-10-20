/* Shared drawing of a project: used by the map pop-up, the form preview and "My submissions",
   so a preview always looks exactly like the published project. */
"use strict";

(() => {
  const esc = SF.esc;
  const R = (SF.render = {});

  R.statusChip = (p) => {
    if (p._endingSoon) return `<span class="chip soon">Ends ${SF.fmtMonth(p._end)}</span>`;
    if (!p.status) return "";
    return `<span class="chip ${p.status.toLowerCase()}">${p.status}</span>`;
  };
  R.progressPct = (p) => {
    if (!p._start || !p._end) return null;
    return Math.max(0, Math.min(1, (SF.today - p._start) / (p._end - p._start)));
  };
  R.progress = (p) => {
    const pct = R.progressPct(p);
    return pct == null ? "" : `<div class="progress" aria-hidden="true"><i style="width:${(pct * 100).toFixed(0)}%"></i></div>`;
  };
  R.critIcons = (p) =>
    `<span class="crit-icons" aria-label="IASC criteria ${p.criteria.join(", ")}">${p.criteria.map((n) => { const c = SF.CRITERIA[n - 1]; return `<span class="ci" style="background:${c.color}" title="${c.n}. ${esc(c.name)}">${SF.critIcon(n)}</span>`; }).join("")}</span>`;
  R.dateRange = (p) => (p._start || p._end ? `${SF.fmtMonth(p._start)}${p._start && p._end ? " to " : ""}${SF.fmtMonth(p._end)}` : "");

  R.miniMap = (p, GEO) => {
    if (!GEO) return "";
    const on = new Set(p.states);
    return `<svg class="mini-map" viewBox="40 14 780 680" role="img" aria-label="${esc(p.nationwide ? "Nationwide" : p.states.join(", "))}">
      <rect class="bg" x="0" y="0" width="${GEO.width}" height="${GEO.height}"/>
      ${GEO.states.map((s) => `<path d="${s.path}" class="${p.nationwide || on.has(s.name) ? "on" : ""}"/>`).join("")}
    </svg>`;
  };

  R.hero = (p, opts = {}) => {
    const photos = p.photos || [];
    if (photos.length) {
      return `<img class="photo" src="${esc(photos[0])}" alt="Photo of ${esc(p.name)}">${photos.length > 1 ? `<button type="button" class="nav prev" aria-label="Previous photo">&#8249;</button><button type="button" class="nav next" aria-label="Next photo">&#8250;</button><div class="dots">${photos.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}`;
    }
    return `<div class="logo-hero"><div class="logo-card">${SF.logoImg(p.lead, "full")}</div></div>${opts.photoNote ? `<span class="photo-ph">${esc(opts.photoNote)}</span>` : ""}`;
  };

  R.body = (p, GEO, opts = {}) => {
    const logo = SF.LOGOS[p.lead];
    const figs = [];
    if (p.dsFunding != null) figs.push({ ico: SF.icon("fund"), l: "Towards durable solutions", v: SF.fmtMoney(p.dsFunding), s: p.budget != null ? `of ${SF.fmtMoney(p.budget)} total budget` : "" });
    if (p.share != null) figs.push({ ico: SF.icon("fund"), l: "Share of budget", v: SF.fmtPct(p.share), s: "self-assessed" });
    if (p.people.total != null) figs.push({ ico: SF.icon("people"), l: "People reached, planned", v: SF.fmtInt(p.people.total), s: "" });
    if (p._start || p._end) {
      const pct = R.progressPct(p);
      figs.push({ ico: SF.icon("calendar"), l: "Dates", v: R.dateRange(p), s: pct != null ? `<div class="progress"><i style="width:${(pct * 100).toFixed(0)}%"></i></div>` : "" });
    }
    const groupMax = Math.max(1, ...SF.TARGET_GROUPS.map((g) => p.people[g.key] || 0));
    const groups = SF.TARGET_GROUPS.filter((g) => p.people[g.key] > 0);
    const details = [
      [(p.donors || []).length > 1 ? "Donors" : "Donor or funding source", esc(SF.donorText(p))],
      ["Coordination mechanism", esc(p.coordination)],
      ["Intervention type", esc((p.interventionTypes || []).join(", "))],
      ["Organisation leadership", esc((p.leadership || []).map((k) => (SF.LEADERSHIP.find((x) => x.key === k) || { label: k }).label).join(", "))],
      ["Remarks", esc(p.remarks)],
      ["Contact", `<a href="mailto:${SF.config.contactEmail}?subject=${encodeURIComponent(`Solutions Footprint: ${p.name}`)}">${SF.config.contactEmail}</a>`],
    ].filter(([, v]) => v);
    return `<div class="pop-body">
      <div class="pop-chips">${R.statusChip(p)}${p.nationwide ? '<span class="chip">Nationwide</span>' : ""}</div>
      <h2 class="pop-title"${opts.titleId ? ` id="${opts.titleId}"` : ""}>${esc(p.name)}</h2>
      <div class="pop-org"><span class="lg">${SF.logoImg(p.lead)}</span><span><b>${esc(logo ? `${p.lead}, ${logo.name}` : p.leadName || p.lead)}</b>${p.partners.length ? `<br>with ${esc(p.partners.join(", "))}` : ""}</span></div>
      ${opts.logoNote ? `<div class="logo-note">${opts.logoNote}</div>` : ""}
      ${p.description ? `<p style="margin:0 0 14px">${esc(p.description)}</p>` : ""}
      ${figs.length ? `<div class="figs">${figs.map((f) => `<div class="fig"><div class="l">${f.ico}${f.l}</div><div class="v">${f.v}</div>${f.s ? `<div class="s">${f.s}</div>` : ""}</div>`).join("")}</div>` : ""}
      <div class="pop-section">IASC criteria</div>
      <div class="crit-list">${p.criteria.map((n) => { const c = SF.CRITERIA[n - 1]; return `<span class="crit-pill"><span class="ci" style="background:${c.color}">${SF.critIcon(n)}</span>${c.n}. ${esc(c.name)}</span>`; }).join("")}</div>
      <div class="pop-section">Where</div>
      <div class="where">${R.miniMap(p, GEO)}
        <dl><dt>States</dt><dd>${p.nationwide ? "Nationwide" : esc(p.states.join(", "))}</dd>
        ${p.localities.length ? `<dt>Localities</dt><dd>${esc(p.localities.join(", "))}</dd>` : ""}</dl>
      </div>
      ${groups.length ? `<div class="pop-section">People reached, planned, by group</div>
        <div class="people-bars">${groups.map((g) => `<div class="pb"><span>${g.label}</span><span class="bar"><i style="width:${(p.people[g.key] / groupMax) * 100}%;background:var(--brand)"></i></span><span class="n">${SF.fmtInt(p.people[g.key])}</span></div>`).join("")}</div>` : ""}
      ${details.length ? `<div class="pop-section">Details</div><dl class="pop-dl">${details.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` : ""}
    </div>`;
  };

  /* A small card used in the form's live preview and in "My submissions" */
  R.card = (p, extra = "") => `
    <div class="mini-card">
      <div class="mc-head"><span class="lg">${SF.logoImg(p.lead)}</span><span><b>${esc(p.lead || "Lead organisation")}</b><br>${esc(p.nationwide ? "Nationwide" : p.states.join(", ") || "States not chosen yet")}</span></div>
      <div class="mc-title">${esc(p.name || "Your project name")}</div>
      ${p.criteria.length ? `<div style="margin-top:8px">${R.critIcons(p)}</div>` : ""}
      ${R.dateRange(p) ? `<div class="mc-line">${R.dateRange(p)} ${R.statusChip(p)}</div>${R.progress(p)}` : ""}
      ${p.dsFunding != null ? `<div class="mc-line"><b>${SF.fmtMoney(p.dsFunding)}</b> towards durable solutions</div>` : ""}
      ${extra}
    </div>`;

  /* "Your place on the map": the project's states outlined, with counts before and after */
  R.placeOnMap = (p, GEO, published) => {
    const cnt = {}, crit = {};
    published.forEach((q) => q.states.forEach((s) => { cnt[s] = (cnt[s] || 0) + 1; (crit[s] = crit[s] || new Set()); q.criteria.forEach((c) => crit[s].add(c)); }));
    const mine = new Set(p.nationwide ? [] : p.states);
    const sel = GEO.states.filter((s) => mine.has(s.name));
    let vb = [40, 14, 780, 680];
    if (sel.length) {
      const x0 = Math.min(...sel.map((s) => s.bbox[0])), y0 = Math.min(...sel.map((s) => s.bbox[1]));
      const x1 = Math.max(...sel.map((s) => s.bbox[2])), y1 = Math.max(...sel.map((s) => s.bbox[3]));
      let w = Math.max((x1 - x0) * 1.6, 260), h = Math.max((y1 - y0) * 1.6, 230);
      const r = 470 / 420; if (w / h > r) h = w / r; else w = h * r;
      vb = [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h];
    }
    const k = vb[2] / 470;
    const svg = `<svg class="pmap" viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" role="img" aria-label="Map of the project's states">
      <rect x="-2000" y="-2000" width="5000" height="5000" style="fill:var(--map-water)"/>
      ${GEO.land.map((l) => `<path class="land" d="${l.path}" style="stroke-width:${k}"/>`).join("")}
      ${GEO.states.map((s) => `<path class="st ${mine.has(s.name) ? "mine" : cnt[s.name] ? "has" : ""}" d="${s.path}" style="stroke-width:${1.2 * k}"/>`).join("")}
      ${sel.map((s) => `<path class="sel" d="${s.path}" style="stroke-width:${2.4 * k}"/>`).join("")}
      ${sel.map((s) => `<text x="${s.x}" y="${s.y}" text-anchor="middle" style="font-size:${13 * k}px;stroke-width:${3 * k}px">${esc(s.name)}: ${cnt[s.name] || 0} → ${(cnt[s.name] || 0) + 1}</text>`).join("")}
    </svg>`;
    const rows = p.nationwide
      ? `<div class="chg"><div class="h"><span>Nationwide</span><span class="cnt">${published.filter((q) => q.nationwide).length} nationwide projects now, <b>${published.filter((q) => q.nationwide).length + 1}</b> with yours</span></div><div class="fill" style="color:var(--muted)">Nationwide projects are listed above the map, not on one state.</div></div>`
      : p.states.map((s) => {
        const newC = p.criteria.filter((c) => !(crit[s] && crit[s].has(c)));
        return `<div class="chg"><div class="h"><span>${esc(s)}</span><span class="cnt">${cnt[s] || 0} project${cnt[s] === 1 ? "" : "s"} now, <b>${(cnt[s] || 0) + 1}</b> with yours</span></div>
          ${newC.length ? `<div class="fill">Fills a gap: ${newC.map((n) => `<span class="ci" style="background:${SF.CRITERIA[n - 1].color}">${SF.critIcon(n)}</span>${n}. ${SF.CRITERIA[n - 1].short}`).join(" ")}</div>`
          : p.criteria.length ? `<div class="fill" style="color:var(--muted)">Adds to IASC criteria already covered here</div>` : ""}</div>`;
      }).join("");
    return `${p.nationwide ? "" : svg}<div class="changes">${rows || '<div class="chg">Choose the states to see your place on the map.</div>'}</div>`;
  };

  /* Turn form answers into the same shape as a published project */
  R.fromAnswers = (a) => {
    const p = {
      id: "preview", name: a.name || "", description: a.description || null, interventionTypes: a.itypes || [],
      lead: a.lead || "", leadName: a.leadName || "", orgType: a.orgType || null, leadership: (a.leadership || []).filter((x) => x !== "none"),
      partners: a.partners || [], partnerTypes: [], nationwide: a.scope === "nationwide", states: a.scope === "nationwide" ? [] : a.states || [],
      localities: a.scope === "nationwide" ? [] : a.localities || [], criteria: (a.criteria || []).map(Number),
      coordination: a.coordination || null,
      start: a.start ? `${a.start}-01` : null,
      end: a.end ? (() => { const [y, m] = a.end.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })() : null,
      reportedStatus: a.status || null, budget: a.budget ?? null, share: a.share != null ? a.share / 100 : null,
      dsFunding: a.budget != null && a.share != null ? (a.budget * a.share) / 100 : null, donor: (a.donors || []).length ? a.donors.map((d) => d.name).join("; ") : a.donor || null, donors: a.donors || [],
      people: a.people || { total: null, idps: null, returnees: null, refugees: null, host: null, other: null },
      femaleShare: (a.peopleExtra || {}).femaleShare ?? null, pwdShare: (a.peopleExtra || {}).pwdShare ?? null,
      pwdFemaleShare: (a.peopleExtra || {}).pwdFemaleShare ?? null, peopleSex: (a.peopleExtra || {}).peopleSex || null,
      remarks: a.remarks || null, photos: [],
    };
    return SF.enrich(p);
  };

  /* Submissions kept in this browser only ("My submissions") */
  const KEY = "sf-submissions";
  R.loadSubmissions = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return null; } };
  R.saveSubmission = (entry) => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      list.unshift(entry);
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 100)));
      return true;
    } catch (e) { return false; }
  };
  R.updateSubmission = (savedAt, patch) => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]").map((x) => (x.savedAt === savedAt ? { ...x, ...patch } : x));
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  };
  R.removeSubmission = (savedAt) => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]").filter((x) => x.savedAt !== savedAt);
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  };
})();
