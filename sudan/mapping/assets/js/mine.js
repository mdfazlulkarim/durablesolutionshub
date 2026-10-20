/* "My submissions": projects sent from this browser, kept in this browser only. */
"use strict";

(() => {
  const { esc } = SF;
  const $ = (id) => document.getElementById(id);
  let GEO = null, PUBLISHED = [], STATUS = {};
  const API = String(SF.config.apiUrl || "").replace(/\/$/, "");

  SF.renderHeader("mine");
  $("notice").innerHTML = `${SF.icons.info}<span><b>Saved only in this browser on this device.</b> If you clear your browser data, use a private window or switch to another device, this list will be empty. Your submissions are not lost: the Durable Solutions Unit has them and keeps the map up to date.</span>`;

  /* A submission counts as published when a published project from the same lead organisation
     matches at least 4 of 7 data points: project number, name, start month, end month,
     total budget (within 1%), states and IASC criteria. */
  const KEEP_DAYS = 3;
  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const nameMatch = (a, b) => {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y || x.includes(y) || y.includes(x)) return true;
    const A = new Set(x.split(" ")), B = new Set(y.split(" "));
    const inter = [...A].filter((w) => B.has(w)).length;
    return inter / new Set([...A, ...B]).size >= 0.7;
  };
  const sameSet = (a, b) => { const A = new Set((a || []).map(String)), B = new Set((b || []).map(String)); return A.size > 0 && A.size === B.size && [...A].every((v) => B.has(v)); };
  function matchScore(e, p) {
    const a = e.answers || {};
    let n = 0;
    if (e.ref && p.ref && e.ref.toUpperCase() === p.ref.toUpperCase()) n++;
    if (nameMatch(a.name, p.name)) n++;
    if (a.start && p.start && p.start.slice(0, 7) === a.start) n++;
    if (a.end && p.end && p.end.slice(0, 7) === a.end) n++;
    if (a.budget != null && p.budget != null && Math.abs(a.budget - p.budget) <= Math.max(1, p.budget * 0.01)) n++;
    if (a.scope === "nationwide" ? p.nationwide : sameSet(a.states, p.states)) n++;
    if (sameSet(a.criteria, p.criteria)) n++;
    return n;
  }
  function isPublished(e) {
    const st = e.id && STATUS[e.id];
    if (st && st.status === "published") return PUBLISHED.find((p) => p.ref && p.ref === (st.ref || e.ref)) || { id: null };
    if (st && st.status !== "unknown") return null;
    const lead = String((e.answers || {}).lead || "").toLowerCase();
    let best = null, bestN = 0;
    PUBLISHED.forEach((p) => {
      if (String(p.lead || "").toLowerCase() !== lead) return;
      const n = matchScore(e, p);
      if (n > bestN) { bestN = n; best = p; }
    });
    return bestN >= 4 ? best : null;
  }

  function render() {
    let list = SF.render.loadSubmissions();
    if (list) {
      const now = Date.now();
      list.forEach((e) => { if (!e.publishedAt && isPublished(e)) { e.publishedAt = new Date().toISOString(); SF.render.updateSubmission(e.savedAt, { publishedAt: e.publishedAt }); } });
      list.filter((e) => e.publishedAt && now - new Date(e.publishedAt).getTime() > KEEP_DAYS * 864e5).forEach((e) => SF.render.removeSubmission(e.savedAt));
      list = SF.render.loadSubmissions();
    }
    const host = $("mine-list");
    if (list === null) {
      host.innerHTML = `<div class="card" style="padding:20px">This browser does not allow saving, so submissions cannot be listed here. Your submissions still reach the Durable Solutions Unit by email.</div>`;
      return;
    }
    if (!list.length) {
      host.innerHTML = `<div class="card" style="padding:24px;text-align:center"><p style="margin:0 0 12px">You have not sent any projects from this browser yet.</p><a class="btn btn-primary" href="add.html">${SF.icons.plus}Add your project</a></div>`;
      return;
    }
    host.innerHTML = list.map((e, i) => {
      const p = SF.render.fromAnswers(e.answers || {});
      const pub = isPublished(e);
      const removeOn = e.publishedAt ? new Date(new Date(e.publishedAt).getTime() + KEEP_DAYS * 864e5) : null;
      const sent = new Date(e.savedAt);
      const st = (e.id && STATUS[e.id]) || {};
      const status = pub || e.publishedAt ? `<span class="st-badge live">Published on the map</span>`
        : st.status === "rejected" ? `<span class="st-badge sent">Not published. The Durable Solutions Unit may contact you.</span>`
        : `<span class="st-badge sent">${e.correcting ? "Correction sent, awaiting review" : "Sent, awaiting review"}</span>`;
      const direct = e.sent === "direct";
      const nPhotos = st.photos != null ? st.photos : e.photos || 0;
      const canAddPhotos = direct && API && st.status === "pending" && nPhotos < 3;
      return `<div class="card mine-item">
        ${SF.render.card(p)}
        <div class="meta">
          <div>${status}</div>
          ${e.ref ? `<div class="mine-ref">Project code: <b>${esc(e.ref)}</b></div>` : ""}
          <div>Sent on ${SF.fmtDateLong(sent)}</div>
          ${removeOn ? `<div class="pub-note">This project is now on the map. It will be removed from this list on ${SF.fmtDateLong(removeOn)}.</div>` : ""}
          ${direct ? `<div>${nPhotos ? `${nPhotos} photo${nPhotos === 1 ? "" : "s"} sent` : "No photos sent yet"}</div>` : ""}
          ${pub && pub.id ? `<a class="btn" href="index.html#project=${encodeURIComponent(pub.id)}">${SF.icons.pin}View on the map</a>` : ""}
          <button type="button" class="btn" data-preview="${i}">See the preview</button>
          ${canAddPhotos ? `<label class="btn">${SF.icon("photo").replace("<svg ", '<svg style="width:18px;height:18px" ')}Add photos<input type="file" accept="image/*" multiple class="sr-only" data-photos="${i}" data-room="${3 - nPhotos}"></label>` : ""}
          ${direct ? "" : `<button type="button" class="btn" data-copy="${i}">Copy the email text</button>
          <a class="btn" href="${esc(e.href)}">Open the email again</a>`}
          <button type="button" class="link-btn" data-remove="${esc(e.savedAt)}">Remove from this list</button>
        </div>
      </div>`;
    }).join("");
    host.querySelectorAll("[data-preview]").forEach((b) => b.addEventListener("click", () => openPreview(list[Number(b.dataset.preview)])));
    host.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      const e = list[Number(b.dataset.copy)];
      const text = `Subject: ${e.subject}\n\n${e.body}`;
      try { await navigator.clipboard.writeText(text); SF.toast("Email text copied"); } catch { prompt("Copy this text:", text); }
    }));
    host.querySelectorAll("[data-photos]").forEach((inp) => inp.addEventListener("change", async () => {
      const e = list[Number(inp.dataset.photos)];
      const lbl = inp.closest("label");
      try {
        lbl.classList.add("is-disabled");
        const imgs = [];
        for (const f of [...inp.files].slice(0, Number(inp.dataset.room))) imgs.push(await SF.shrinkImage(f));
        const r = await fetch(`${API}/api/photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, token: e.token, photos: imgs.map(({ name, type, data }) => ({ name, type, data })) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || `The server answered ${r.status}`);
        STATUS[e.id] = { ...(STATUS[e.id] || {}), photos: j.photos };
        SF.render.updateSubmission(e.savedAt, { photos: j.photos });
        SF.toast(`${imgs.length} photo${imgs.length === 1 ? "" : "s"} sent`);
        render();
      } catch (x) { alert(x.message); lbl.classList.remove("is-disabled"); }
    }));
    host.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      if (confirm("Remove this project from the list in this browser? Your submission to the Durable Solutions Unit is not affected.")) {
        SF.render.removeSubmission(b.dataset.remove);
        render();
      }
    }));
  }

  function openPreview(e) {
    const p = SF.render.fromAnswers(e.answers || {});
    const d = $("detail");
    d.innerHTML = `<button type="button" class="modal-close" aria-label="Close" data-close>&times;</button>
      <div class="modal-scroll">
        <div class="hero">${SF.render.hero(p, { photoNote: "Your photos will appear here once the project is published" })}</div>
        ${SF.render.body(p, GEO, { titleId: "detail-title" })}
      </div>`;
    d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
    d.onclick = (ev) => { if (ev.target === d) d.close(); };
    d.showModal();
  }

  Promise.all([SF.loadJSON(SF.config.dataUrl).catch(() => null), SF.loadJSON(SF.config.geoUrl).catch(() => null), SF.loadLogos()]).then(([data, geo]) => {
    PUBLISHED = data ? data.projects : [];
    GEO = geo;
    SF.renderFooter(data && data.lastUpdated);
    render();
    // statuses of projects sent straight to the back end
    const mine = (SF.render.loadSubmissions() || []).filter((e) => e.id && e.token);
    if (API && mine.length) {
      fetch(`${API}/api/status?items=${mine.map((e) => `${e.id}:${e.token}`).join(",")}`)
        .then((r) => r.json()).then((j) => { if (j.ok) { STATUS = j.items; render(); } }).catch(() => {});
    }
  });
})();
