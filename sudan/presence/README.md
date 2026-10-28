# Operational Presence | Durable Solutions Hub | Sudan

A standalone page that maps who is doing what, where in Sudan (OCHA Sudan 3W), by state and locality, for coordination partners. It is not linked from the Solutions Footprint menu.

Address: `https://durablesolutionshub.org/sudan/presence/`

## Access code

The page opens only with an access code. The data file is stored encrypted (AES-256-GCM, key derived from the code with PBKDF2-SHA256, 600,000 rounds), so without the code it cannot be read, from the page or from this repository. The code is never written to the repository; DSU holds it. The page accepts it with any capital letters and extra spaces, and remembers it until the browser tab is closed (the **Lock** button forgets it at once).

## What the page shows

- Summary cards: organisations, clusters, states, localities, and organisations in the five ADSWG states.
- Map by state or by locality, shaded by the number of organisations. Clicking a state zooms in to its localities; the five ADSWG states are outlined.
- The number of ongoing projects on the Solutions Footprint (`../mapping/data/projects.json`; started and not yet ended), as green circles by state, and by locality when a project names its localities. Shown by default; a switch hides them.
- Side panel for the selected area: organisations per cluster, organisation types and the widest coverage.
- Organisations reporting per month (select a month to filter the page).
- "Who is where": every organisation with its clusters, states, localities and months, sortable and searchable.
- Filters: month, organisation, cluster and organisation type.
- OCHA Humanitarian Icons for the clusters and summary cards.

Organisations are counted once per area, whatever the number of clusters or months. Rows reported without a partner name ("Other") are listed as "Other partners (not named)" and are not counted as an organisation.

## Files

```
index.html                  The page (access code first, then the dashboard)
assets/presence.js          Page logic, including decryption in the browser (Web Crypto)
assets/presence.css         Styles on top of ../mapping/assets/css/style.css
assets/icons.js             OCHA Humanitarian Icons used on the page (built by scripts/build_icons.py)
data/presence.enc.json      The 3W data, encrypted
data/localities-geo.json    Locality boundaries, drawn in the same projection as ../mapping/data/geo.json
scripts/build_presence.py   Builds data/presence.enc.json from the OCHA 3W Excel export
scripts/build_geo.js        Builds data/localities-geo.json from the boundary files in ../mapping/data/boundaries/
scripts/build_icons.py      Builds assets/icons.js from the OCHA icon SVG files
```

## Update the data

1. Save the new OCHA 3W export (columns: Reporting Month, State, Locality, Cluster Name, Org name, Org acronym, Org type) in `data/source/`. This folder is excluded from the repository.
2. From this folder, run:
   ```
   pip install openpyxl cryptography
   python3 scripts/build_presence.py data/source/<export>.xlsx
   ```
   The script asks for the access code. Use the same code to keep it, or a new one to change it.
3. Check the summary it prints and `data/source/cleaning-log.md` (localities without a boundary, organisation names read as one).
4. Commit `data/presence.enc.json`. The page updates within a minute or two.

To change only the code, run step 2 again with the same export and the new code.
