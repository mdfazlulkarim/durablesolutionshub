"""Builds data/presence.enc.json for the Operational Presence page from the OCHA Sudan 3W export.

The page and this repository are public, so the data is stored encrypted with the access code:
AES-256-GCM, with the key derived from the code by PBKDF2-SHA256. The code itself is never written
to the repository. Without it, the file cannot be read.

Usage (run from sudan/presence/):
    pip install openpyxl cryptography
    python3 scripts/build_presence.py data/source/<3W export>.xlsx
The script asks for the access code (or reads it from the PRESENCE_CODE environment variable).
Keep the source file in data/source/, which is excluded from the repository.

The code is checked without regard to capital letters or extra spaces, the same way the page does.
"""
import base64
import getpass
import json
import os
import re
import sys
from collections import Counter

import openpyxl
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "presence.enc.json")
GEO = os.path.join(ROOT, "data", "localities-geo.json")
LOG = os.path.join(ROOT, "data", "source", "cleaning-log.md")  # kept out of the repository, like the source

ITERATIONS = 600_000

SOURCE = {
    "title": "Sudan: 2026 consolidated 3W (HRP response monitoring)",
    "org": "OCHA Sudan, with humanitarian partners",
    "url": "https://data.humdata.org/organization/ocha-sudan",
    "dashboard": "https://app.powerbi.com/view?r=eyJrIjoiMmMyNmU1ODctM2NmNC00NWJmLTliNTUtNzdjNWYxZmE1MzA3IiwidCI6IjBmOWUzNWRiLTU0NGYtNGY2MC1iZGNjLTVlYTQxNmU2ZGM3MCIsImMiOjh9",
}

# The same organisation entered under two spellings
ORG_FIX = {
    "Welthungerhilfe": "Welthungerhilfe (German Agro Action)",
    "PORD Sudan": "Peace Organization for Rural Development",
}
# Rows reported without a partner name; listed, but not counted as an organisation
UNNAMED = {"Other"}
TYPE_ORDER = ["UN Agency", "INGO", "NNGO", "Red Cross", "Other"]
COLUMNS = ["Reporting Month", "State", "Locality", "Cluster Name", "Org name", "Org acronym", "Org type"]


def norm_code(code):
    return re.sub(r"\s+", " ", code).strip().lower()


def clean(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def read_rows(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    head = [clean(h) for h in next(it)]
    missing = [c for c in COLUMNS if c not in head]
    if missing:
        sys.exit(f"Columns not found in {path}: {', '.join(missing)}")
    idx = [head.index(c) for c in COLUMNS]
    rows = []
    for r in it:
        vals = [clean(r[i]) for i in idx]
        if not any(vals):
            continue
        rows.append(vals)
    return ws.title, rows


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    code = os.environ.get("PRESENCE_CODE") or getpass.getpass("Access code: ")
    if not code.strip():
        sys.exit("No access code given.")

    sheet, raw = read_rows(src)
    geo = json.load(open(GEO, encoding="utf-8"))
    on_map = {l["key"] for l in geo["localities"]}

    log = [f"# Cleaning log, Operational Presence\n", f"Source file: `{os.path.basename(src)}`, sheet \"{sheet}\", {len(raw)} rows.\n"]
    fixes = Counter()
    seen = set()
    recs = []
    for month, state, loc, cluster, name, acr, otype in raw:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            sys.exit(f"Unexpected month value: {month!r}")
        if name in ORG_FIX:
            fixes[f"Organisation \"{name}\" read as \"{ORG_FIX[name]}\""] += 1
            name = ORG_FIX[name]
        key = (month, state, loc, cluster, name)
        if key in seen:
            fixes["Duplicate row (same month, locality, cluster and organisation) counted once"] += 1
            continue
        seen.add(key)
        recs.append((month, state, loc, cluster, name, acr, otype))

    months = sorted({r[0] for r in recs})
    clusters = [c for c, _ in Counter(r[3] for r in recs).most_common()]
    states = sorted({r[1] for r in recs})
    types = [t for t in TYPE_ORDER if any(r[6] == t for r in recs)] + sorted({r[6] for r in recs} - set(TYPE_ORDER))

    org_meta = {}
    for r in recs:
        org_meta.setdefault(r[4], (r[5], r[6]))
    org_names = sorted(org_meta, key=lambda n: (n in UNNAMED, (org_meta[n][0] or n).lower()))
    orgs = []
    for n in org_names:
        acr, t = org_meta[n]
        o = [n, acr if acr and acr != n else "", types.index(t)]
        if n in UNNAMED:
            o[0] = "Other partners (not named)"
            o[1] = ""
            o.append(1)
        orgs.append(o)

    locs = sorted({(r[1], r[2]) for r in recs})
    loc_index = {l: i for i, l in enumerate(locs)}
    not_on_map = [f"{l} ({s})" for s, l in locs if l not in on_map]
    for r in recs:
        if r[2] not in on_map:
            fixes[f"Locality {r[2]} ({r[1]}) has no boundary on the map, so it is counted in its state only"] += 1

    m_i = {m: i for i, m in enumerate(months)}
    c_i = {c: i for i, c in enumerate(clusters)}
    o_i = {n: i for i, n in enumerate(org_names)}
    flat = []
    for month, state, loc, cluster, name, acr, otype in sorted(recs):
        flat += [m_i[month], loc_index[(state, loc)], c_i[cluster], o_i[name]]

    notes = [f"{k} ({v} row{'s' if v != 1 else ''})." for k, v in sorted(fixes.items())]
    notes.append("Rows with the organisation name \"Other\" are shown as \"Other partners (not named)\" and are not counted as an organisation.")
    data = {
        "v": 1,
        "notes": notes,
        "source": SOURCE,
        "file": os.path.basename(src),
        "months": months,
        "clusters": clusters,
        "types": types,
        "states": states,
        "orgs": orgs,
        "locs": [[l, states.index(s), 1 if l in on_map else 0] for s, l in locs],
        "rows": flat,
    }
    plain = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(norm_code(code).encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, plain, b"presence-v1")
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS, "aad": "presence-v1",
                   "salt": b64(salt), "iv": b64(iv), "data": b64(ct)}, f)

    log.append(f"Months: {months[0]} to {months[-1]}. Rows used: {len(recs)}. Organisations: {len([o for o in orgs if len(o) < 4])} named"
               f" (plus rows with no partner name). Clusters: {len(clusters)}. Localities: {len(locs)}.\n")
    log.append("## Changes\n")
    log += [f"- {k}: {v} row{'s' if v != 1 else ''}" for k, v in sorted(fixes.items())] or ["- None"]
    log.append("- Rows with the organisation name \"Other\" are shown as \"Other partners (not named)\" and are not counted as an organisation.")
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "w", encoding="utf-8") as f:
        f.write("\n".join(log) + "\n")

    print(f"{OUT}: {os.path.getsize(OUT) / 1024:.1f} KB encrypted ({len(plain) / 1024:.1f} KB of data), "
          f"{len(recs)} rows, {len(orgs)} organisation entries, {len(locs)} localities, months {months[0]} to {months[-1]}")
    if not_on_map:
        print("Not on the map (counted in their state):", ", ".join(not_on_map))


if __name__ == "__main__":
    main()
