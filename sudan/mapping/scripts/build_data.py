"""Build data/projects.json from exports of the SharePoint list "Sudan DS Interventions"
and from filled-in copies of the Excel template (assets/templates/...).

Usage:
    python3 scripts/build_data.py data/source/export1.xlsx [data/source/returned-template.xlsx ...]

Later files win when the same project (same agency and name) appears twice,
but empty cells never overwrite filled ones.

Each project gets a permanent internal number (agency acronym and a running number,
for example IOM-001), kept in data/project-refs.json so numbers never change or get reused.
Photos are picked up from assets/photos/<number>-1.jpg (or .png), up to 3 per project.

Only public fields are written. Focal point names and email addresses are
never copied to the public data. Keep the raw exports in data/source/, which
is excluded from the repository by .gitignore.

The clean-up rules follow Annex B of the business requirements and are listed
in data/cleaning-log.md, which this script rewrites each time it runs.
"""

import datetime as dt
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "projects.json"
LOG = ROOT / "data" / "cleaning-log.md"

REFS = ROOT / "data" / "project-refs.json"
PHOTOS = ROOT / "assets" / "photos"

LAST_UPDATED = "2026-10-19"  # date shown as "Last updated" on the site

ORGS = json.loads((ROOT / "data" / "organisations.json").read_text(encoding="utf-8"))["organisations"]
ORG_INDEX = {}
for _o in ORGS:
    for _k in [_o["acronym"], _o["name"], *_o.get("aliases", [])]:
        ORG_INDEX.setdefault(_k.lower(), _o)


def org_lookup(name):
    return ORG_INDEX.get((name or "").strip().lower())

STATES = [
    "Aj Jazirah", "Blue Nile", "Central Darfur", "East Darfur", "Gedaref", "Kassala",
    "Khartoum", "North Darfur", "North Kordofan", "Northern", "Red Sea", "River Nile",
    "Sennar", "South Darfur", "South Kordofan", "West Darfur", "West Kordofan", "White Nile",
]
STATE_FIX = {
    "al jazirah": "Aj Jazirah", "al jazeera": "Aj Jazirah", "gezira": "Aj Jazirah",
    "northern state": "Northern", "kassala sate": "Kassala",
}
# Towns entered as states: recorded as a locality, and the state they sit in is added
TOWN_TO_STATE = {"dongola": ("Northern", "Dongola")}
NATIONWIDE = {"all", "nationwide", "national"}

# Corrections to project names (spelling, and a donor entered as a project name)
NAME_FIX = {
    "Lietchenstein Contribution to Sudan CRP 2026": "Liechtenstein Contribution to Sudan CRP 2026",
    "Legal Assitance": "Legal Assistance",
    "Rehabilitation of two health center": "Rehabilitation of two health centres",
    "Sudan EU IGAD Platform programme-Kassala Sate": "Sudan EU IGAD Platform programme, Kassala State",
    "Mastercard Foundation": "UNHCR project funded by Mastercard Foundation",
}
# Long entries in the name field: a short name, with the full text kept as the description
NAME_SPLIT = {
    "Solar systems for health facilities to ensure reliable electricity for essential services, including emergency obstetric care, safe deliveries, cold-chain needs where applicable, and services in areas with limited infrastructure.": "Solar systems for health facilities",
    "Rehabilitation of health facilities to restore damaged or non-functional health infrastructure and enable displaced and returning populations, as well as host communities, to access essential health services sustainably.": "Rehabilitation of health facilities",
    "Medical equipment to enable health facilities to resume or improve service delivery, particularly emergency obstetric and newborn care (EmONC), and maintain essential reproductive health services.": "Medical equipment for health facilities",
    "BenIMS/DHIS2 to Strengthen health information management, service monitoring, planning, and evidence-based resource allocation, supporting more sustainable health-system management.": "BenIMS/DHIS2 health information management",
    "Women Architects of Recovery - assessment aiming to identify opportunities to use women's potential in recovery of Sudan": "Women Architects of Recovery",
}
# Donor names are kept as entered, except agreed fixes: spelling and formatting,
# and one name for the same donor entered in different ways.
DONOR_FIX = {
    "The Government of Netherlands": "Government of the Netherlands",
    "CANADA": "Government of Canada",
    "Canada IRCC": "Government of Canada",
    "UN_Central Emergency Response Fund (CERF)": "Central Emergency Response Fund (CERF)",
    "Japan": "Government of Japan",
    "Norway and Sida": "Norway, Sida",
    "HF, ECHO": "Sudan Humanitarian Fund, ECHO",
    "Swiss Development Cooperation": "Swiss Agency for Development and Cooperation (SDC)",
    "Swiss Agency for Development & Cooperation (SDC)": "Swiss Agency for Development and Cooperation (SDC)",
    "Swiss Agency for Development & Cooperation (SDC) + UNHCR": "Swiss Agency for Development and Cooperation (SDC), UNHCR",
    "EducationAboveAll_Qatar Fund for Development": "Education Above All, Qatar Fund for Development",
}
DONOR_FROM_NAME = {"Mastercard Foundation": "Mastercard Foundation"}
PARTNER_FIX = {"UN HABITAT": "UN-Habitat"}
COORD_FIX = {"legal aid working group": "Legal Aid Working Group", "health": "Health Cluster"}

# The eight IASC criteria. Keywords are matched against what organisations entered.
CRITERIA = [
    (1, "Safety and security", ["safety", "security", "social cohesion", "protection", "disaster", "mine action"]),
    (2, "Adequate standard of living", ["standard of living", "education", "critical infrastructure",
                                        "reconstruction", "basic service", "health", "water"]),
    (3, "Access to livelihoods and employment", ["livelihood", "employment", "vocational"]),
    (4, "Housing, land and property", ["housing", "land and property", "hlp", "shelter"]),
    (5, "Access to documentation", ["documentation", "legal services", "legal counselling"]),
    (6, "Family reunification", ["family reunification", "family reunion"]),
    (7, "Participation in public affairs", ["participation", "grassroots", "public affairs"]),
    (8, "Access to effective remedies and justice", ["remedies", "justice"]),
]
STANDARD_LABELS = {c[1].lower() for c in CRITERIA} | {
    "access to livelihoods", "adequate standard of living", "safety and security",
    "access to documentation", "family reunification", "restoration of housing, land and property",
}

log = {"criteria": {}, "notes": []}


def clean_text(v):
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    if s.upper() in {"", "N/A", "NA", "NONE", "-"}:
        return None
    return s


def to_number(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = clean_text(v)
    if s is None:
        return None
    s = s.replace("$", "").replace(",", "").replace("USD", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def to_date(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = clean_text(v)
    if not s:
        return None
    m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$", s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        day, month = (a, b) if b <= 12 else (b, a)  # 6.25.2026 is month first
        return dt.date(y, month, day)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def split_multi(v, commas=True):
    s = clean_text(v)
    if not s:
        return []
    pattern = r";#|;|," if commas else r";#|;"  # criteria names contain commas
    return [p.strip() for p in re.split(pattern, s) if p.strip()]


def map_criteria(raw, project):
    found = set()
    for token in split_multi(raw, commas=False):
        main, _, sub = token.partition(":")
        hits = match_criteria(main) or match_criteria(sub)
        if token.lower() not in STANDARD_LABELS:
            log["criteria"].setdefault(token, set()).update(hits)
        if not hits:
            log["notes"].append(f"{project}: criterion '{token}' did not match any of the eight and was dropped.")
        found |= hits
    return sorted(found)


def match_criteria(text):
    t = text.lower().strip()
    if not t:
        return set()
    for num, label, keys in CRITERIA:  # exact label first
        if t == label.lower():
            return {num}
    return {num for num, _, keys in CRITERIA if any(k in t for k in keys)}


def parse_states(raw, project):
    states, localities, nationwide = [], [], False
    for token in split_multi(raw):
        key = token.lower()
        if key in NATIONWIDE:
            nationwide = True
            continue
        if key in TOWN_TO_STATE:
            st, town = TOWN_TO_STATE[key]
            states.append(st)
            localities.append(town)
            log["notes"].append(f"{project}: '{token}' was entered as a state; recorded as a locality in {st}.")
            continue
        st = STATE_FIX.get(key) or next((s for s in STATES if s.lower() == key), None)
        if st:
            if st != token:
                log["notes"].append(f"{project}: state '{token}' standardised to '{st}'.")
            states.append(st)
        else:
            log["notes"].append(f"{project}: unknown state '{token}' was dropped.")
    return sorted(set(states)), localities, nationwide


def parse_partners(raw, lead):
    s = clean_text(raw)
    if not s:
        return []
    parts = re.split(r",|;|&|\band\b", s)
    out = []
    for p in parts:
        p = p.strip(" .")
        if not p:
            continue
        p = PARTNER_FIX.get(p.upper(), p)
        o = org_lookup(p)
        if o:
            p = o["acronym"]
        if lead and p.lower() == lead.lower():
            continue
        if p not in out:
            out.append(p)
    return out


def status_text(v):
    s = clean_text(v)
    if not s:
        return None
    k = s.lower().replace(" ", "")
    return {"ongoing": "Ongoing", "ended": "Ended", "pipeline": "Pipeline"}.get(k, s)


def read_rows(path):
    wb = openpyxl.load_workbook(path, data_only=True)  # cached formula values
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = [clean_text(h) for h in rows[0]]
    for r in rows[1:]:
        rec = dict(zip(header, r))
        if clean_text(rec.get("Project / Programme Name")):
            yield rec


def merge(records):
    merged = {}
    for rec in records:
        key = (clean_text(rec.get("UN Agency")) or "", clean_text(rec.get("Project / Programme Name")).lower())
        if key not in merged:
            merged[key] = dict(rec)
        else:
            for k, v in rec.items():
                if clean_text(v) is not None:
                    merged[key][k] = v
    return list(merged.values())


def build(rec):
    raw_name = clean_text(rec["Project / Programme Name"])
    name = NAME_FIX.get(raw_name, raw_name)
    description = None
    if raw_name in NAME_SPLIT:
        name, description = NAME_SPLIT[raw_name], raw_name
        log["notes"].append(f"Long project name shortened to '{name}'; the full text is kept as the description.")
    elif name != raw_name:
        log["notes"].append(f"Project name '{raw_name}' changed to '{name}'.")
    lead = clean_text(rec.get("UN Agency"))
    states, localities, nationwide = parse_states(rec.get("State(s) Covered"), name)

    budget = to_number(rec.get("Total Budget (USD)"))
    share = to_number(rec.get("% of Budget Towards Durable Solutions"))
    ds = to_number(rec.get("Durable Solutions Amount (USD)"))
    if share is not None and share > 100 and budget is None:
        log["notes"].append(f"{name}: {share:,.0f} was entered as the share towards durable solutions; moved to total budget.")
        budget, share = share, None
    if share is not None and share > 1:
        share = share / 100
    if ds is None and budget is not None and share is not None:
        ds = budget * share
        log["notes"].append(f"{name}: funding towards durable solutions calculated as budget x share.")
    if share is None and ds is not None and budget:
        share = ds / budget

    people_cols = [("total", "Total Beneficiaries (Planned/Reached)"), ("idps", "# IDPs"),
                   ("returnees", "# Returnees"), ("refugees", "# Refugees"),
                   ("host", "# Host Community"), ("other", "# Other")]
    people = {k: to_number(rec.get(c)) for k, c in people_cols}
    if not any(v for v in people.values()):  # blank or all zero means not reported
        people = {k: None for k in people}

    donor = clean_text(rec.get("Funding Source / Donor")) or DONOR_FROM_NAME.get(raw_name)
    donor = DONOR_FIX.get(donor, donor)
    coord = clean_text(rec.get("Coordination Mechanism / Cluster"))
    coord = COORD_FIX.get((coord or "").lower(), coord)
    start, end = to_date(rec.get("Start Date")), to_date(rec.get("End Date"))

    pid = re.sub(r"[^a-z0-9]+", "-", f"{lead}-{name}".lower()).strip("-")[:70]
    return {
        "id": pid,
        "name": name,
        "description": description,
        "interventionTypes": [],
        "lead": lead,
        # The SharePoint column for the lead organisation is "UN Agency"
        "orgType": (org_lookup(lead) or {}).get("type") or ("UN agency" if lead else None),
        "leadership": [],
        "partners": (partners := parse_partners(rec.get("Implementing Partner(s)"), lead)),
        "partnerTypes": [(org_lookup(x) or {}).get("type") for x in partners],
        "nationwide": nationwide and not states,
        "states": states,
        "localities": localities,
        "criteria": map_criteria(rec.get(
            "IASC 8 criteria does your project/programme contribute to? (select all that apply)"), name),
        "coordination": coord,
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "reportedStatus": status_text(rec.get("Status")),
        "budget": round(budget, 2) if budget is not None else None,
        "share": round(share, 4) if share is not None else None,
        "dsFunding": round(ds, 2) if ds is not None else None,
        "donor": donor,
        "people": {k: (int(v) if v is not None else None) for k, v in people.items()},
        "remarks": clean_text(rec.get("Remarks / Notes")),
        "photos": [],
    }


def write_log(projects):
    lines = ["# Data clean-up log", "",
             f"Generated by `scripts/build_data.py`. {len(projects)} projects published. "
             f"Last updated date shown on the site: {LAST_UPDATED}.", "",
             "## Criteria entered outside the eight IASC criteria", "",
             "| Entered | Mapped to |", "|---|---|"]
    names = {c[0]: f"{c[0]}. {c[1]}" for c in CRITERIA}
    for token, hits in sorted(log["criteria"].items()):
        mapped = ", ".join(names[h] for h in sorted(hits)) or "Dropped"
        lines.append(f"| {token} | {mapped} |")
    lines += ["", "## Other changes", ""] + [f"- {n}" for n in dict.fromkeys(log["notes"])]
    LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")


LEADERSHIP_KEYS = {"wlo": "WLO", "women": "WLO", "rlo": "RLO", "refugee": "RLO", "ylo": "YLO", "youth": "YLO",
                   "opd": "OPD", "disabilit": "OPD"}
ITYPES = ["Basic services rehabilitation", "Livelihoods and cash-for-work", "Shelter and housing",
          "Legal aid and documentation", "Social cohesion and peacebuilding",
          "Local governance and urban planning", "Data, evidence and preparedness", "Family reunification support"]


def is_template(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    ok = "Projects" in wb.sheetnames and str(wb["Projects"]["A1"].value or "").startswith("Project or programme name")
    wb.close()
    return ok


def month_date(v, end=False):
    if isinstance(v, (dt.datetime, dt.date)):
        d = v.date() if isinstance(v, dt.datetime) else v
    else:
        s = clean_text(v)
        m = re.match(r"^(\d{4})-(\d{1,2})", s or "")
        if not m:
            return to_date(v)
        d = dt.date(int(m.group(1)), int(m.group(2)), 1)
    if end:  # last day of the month
        nxt = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        d = nxt - dt.timedelta(days=1)
    return d


def read_template(path):
    sys.path.insert(0, str(ROOT / "scripts"))
    from build_template import COLUMNS
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Projects"]
    hdr = [(clean_text(c.value) or "").rstrip(" *") for c in ws[1]]
    keymap = {k: hdr.index(h) for k, h, *_ in COLUMNS if h in hdr}
    if "Donor or funding source" in hdr:  # copies of the template from before October 2026
        keymap["donor"] = hdr.index("Donor or funding source")
    if "People reached, planned: total" in hdr:
        keymap["pTotalOld"] = hdr.index("People reached, planned: total")
    if "Other" in hdr and "pOther" not in keymap:
        keymap["pOther"] = hdr.index("Other")
    for row in ws.iter_rows(min_row=2, values_only=True):
        r = {k: row[i] for k, i in keymap.items()}
        name = clean_text(r.get("name"))
        if not name or name.lower().startswith(("example", "need more rows")):  # template hint rows
            continue
        yield build_from_template(r)


def build_from_template(r):
    name = clean_text(r.get("name"))
    lead_raw = clean_text(r.get("lead"))
    o = org_lookup(lead_raw)
    lead = o["acronym"] if o else lead_raw
    nationwide = (clean_text(r.get("scope")) or "").lower().startswith("nation")
    states, localities, said_nationwide = parse_states(None if nationwide else r.get("states"), name)
    if said_nationwide and not states:  # "Nationwide" typed in the States column
        nationwide = True
        log["notes"].append(f"{name}: 'Nationwide' entered as a state; recorded as a nationwide project.")
    localities += [x.strip() for x in re.split(r";|,", clean_text(r.get("localities")) or "") if x.strip()]
    budget, share = to_number(r.get("budget")), to_number(r.get("share"))
    if share is not None and share > 1:
        share = share / 100
    ds = budget * share if budget is not None and share is not None else to_number(r.get("dsFunding"))
    lead_types = set()
    for x in re.split(r";|,", clean_text(r.get("leadership")) or ""):
        for key, val in LEADERSHIP_KEYS.items():
            if key in x.lower():
                lead_types.add(val)
    itypes = [t for t in ITYPES if any(t.lower() == x.strip().lower() for x in re.split(r";", clean_text(r.get("itypes")) or ""))]
    start, end = month_date(r.get("start")), month_date(r.get("end"), end=True)
    groups = [("idps", "pIdps"), ("returnees", "pReturnees"), ("refugees", "pRefugees"), ("host", "pHost"), ("other", "pOther")]
    people = {k: to_number(r.get(c)) for k, c in groups}
    sexes = ("women", "girls", "men", "boys")
    people_sex, fem, sex_all = {}, 0, 0
    for g, _ in groups:
        row = {x: to_number(r.get(f"sx_{g}_{x}")) for x in sexes}
        if any(v is not None for v in row.values()):
            people_sex[g] = {x: (int(v) if v is not None else None) for x, v in row.items()}
            total_g = sum(v or 0 for v in row.values())
            if people[g] is None:
                people[g] = total_g
            fem += (row["women"] or 0) + (row["girls"] or 0)
            sex_all += total_g
    old_total = to_number(r.get("pTotalOld"))  # copies of the template from before October 2026
    known = sum(v or 0 for v in people.values())
    if old_total and old_total > known:
        people["other"] = (people["other"] or 0) + old_total - known
    vals = [v for v in people.values() if v is not None]
    people["total"] = sum(vals) if vals else None
    pct = lambda v: (None if v is None else round(min(100, max(0, v * 100 if 0 < v <= 1 and v != int(v) else v)) / 100, 3))
    female_share = round(fem / sex_all, 3) if sex_all else pct(to_number(r.get("femalePct")))
    pwd_share = pct(to_number(r.get("pwdPct")))
    partners = parse_partners(";".join(re.split(r";", clean_text(r.get("partners")) or "")), lead)
    coord = clean_text(r.get("coordination"))
    donors = []
    for i in (1, 2, 3, 4, 5):
        dn = clean_text(r.get(f"donor{i}"))
        if dn:
            amt = to_number(r.get(f"d{i}Amount"))
            donors.append({"name": DONOR_FIX.get(dn, dn), "amount": round(amt, 2) if amt else None})
    pid = re.sub(r"[^a-z0-9]+", "-", f"{lead}-{name}".lower()).strip("-")[:70]
    return {
        "id": pid, "name": name, "description": clean_text(r.get("description")), "interventionTypes": itypes,
        "lead": lead, "orgType": clean_text(r.get("orgType")) or (o or {}).get("type"),
        "leadership": sorted(lead_types), "partners": partners,
        "partnerTypes": [(org_lookup(x) or {}).get("type") for x in partners],
        "nationwide": nationwide, "states": states if not nationwide else [], "localities": localities if not nationwide else [],
        "criteria": [i for i in range(1, 9) if (clean_text(r.get(f"c{i}")) or "").lower() in ("yes", "y", "x", "1", "true")],
        "coordination": COORD_FIX.get((coord or "").lower(), coord),
        "start": start.isoformat() if start else None, "end": end.isoformat() if end else None,
        "reportedStatus": status_text(r.get("status")),
        "budget": round(budget, 2) if budget is not None else None,
        "share": round(share, 4) if share is not None else None,
        "dsFunding": round(ds, 2) if ds is not None else None,
        "donor": "; ".join(d["name"] for d in donors) if donors else DONOR_FIX.get(clean_text(r.get("donor")), clean_text(r.get("donor"))),
        "donors": donors,
        "people": {k: (int(v) if v is not None else None) for k, v in [("total", people["total"])] + [(g, people[g]) for g, _ in groups]},
        "femaleShare": female_share,
        "pwdShare": pwd_share,
        "pwdFemaleShare": pct(to_number(r.get("pwdFemalePct"))) if pwd_share is not None else None,
        "peopleSex": people_sex or None,
        "remarks": clean_text(r.get("remarks")), "photos": [],
    }


def assign_refs(projects):
    """Permanent internal numbers: agency acronym plus a running number per agency."""
    reg = json.loads(REFS.read_text(encoding="utf-8")) if REFS.exists() else {}
    used = {}
    for ref in reg.values():
        pre, num = ref.rsplit("-", 1)
        used[pre] = max(used.get(pre, 0), int(num))
    for p in sorted(projects, key=lambda x: (x["lead"] or "", x["start"] or "9999", x["name"])):
        if p["id"] not in reg:
            pre = re.sub(r"[^A-Z0-9]", "", (p["lead"] or "ORG").upper()) or "ORG"
            used[pre] = used.get(pre, 0) + 1
            reg[p["id"]] = f"{pre}-{used[pre]:03d}"
        p["ref"] = reg[p["id"]]
        photos = sorted(f for f in PHOTOS.glob(f"{p['ref']}-*") if f.suffix.lower() in (".jpg", ".jpeg", ".png")) if PHOTOS.exists() else []
        p["photos"] = [f"assets/photos/{f.name}" for f in photos[:3]]
    REFS.write_text(json.dumps(reg, indent=1, sort_keys=True), encoding="utf-8")


def main(paths):
    sp = [p for p in paths if not is_template(p)]
    tp = [p for p in paths if is_template(p)]
    records = [rec for p in sp for rec in read_rows(p)]
    projects = {p["id"]: p for p in (build(r) for r in merge(records))}
    for path in tp:
        for p in read_template(path):
            projects[p["id"]] = p
    projects = list(projects.values())
    assign_refs(projects)
    projects.sort(key=lambda p: (p["lead"] or "", p["name"]))
    OUT.write_text(json.dumps({"lastUpdated": LAST_UPDATED, "projects": projects},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    write_log(projects)
    print(f"Wrote {OUT} with {len(projects)} projects; log in {LOG}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
