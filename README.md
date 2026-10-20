# Solutions Footprint | Durable Solutions Hub | Sudan

A public dashboard of projects that contribute to durable solutions in Sudan, mapped against the eight IASC criteria. Built for the Durable Solutions Working Group (DSWG), with the Durable Solutions Unit (DSU), RCO Sudan, as product owner.

This repository is the Durable Solutions Hub website. It holds the Sudan **Solutions Footprint** (Phase 1: the map explorer and the "Add your project" form, in English) at `sudan/mapping/`.

Live site: `https://durablesolutionshub.org/sudan/mapping/`

```
/                    forwards to /sudan/mapping/ (as does any unknown address, through 404.html)
/sudan/              forwards to /sudan/mapping/
/sudan/mapping/      the Solutions Footprint for Sudan: pages, assets, data and data scripts
/worker/             back end on Cloudflare (review queue, admin pages, publishing)
/CNAME               the custom domain for GitHub Pages
```

Paths below that start with `data/`, `assets/` or `scripts/` are inside `sudan/mapping/`. Run the commands from that folder.

Contact: [dswg.sd@undp.org](mailto:dswg.sd@undp.org)

## What is in Phase 1

- Map of the 18 states with neighbouring countries for context, shaded by projects, organisations or funding towards durable solutions, with a solutions ring per state (eight IASC segments, grey for a gap). The UN map disclaimer sits inside the map.
- Clicking a state zooms in, with badges for the lead agencies working there; each badge opens that agency's projects in the state.
- Side panel that starts with all of Sudan (including a link to the nationwide projects) and switches to the selected state. The project list sits under the map: the first 5 projects, with "Show all" when there are more.
- Project pop-up with photos (or the agency logo when there are none), key figures, IASC criteria icons, a small locator map, "Show on map", "Copy link" and "Suggest a correction".
- Summary cards with small charts (status, organisation types, states covered, top donors, projects ending by month).
- The summary cards work as filters: click a status or donor to filter the dashboard, an organisation type to show projects where that type of organisation is the lead or a partner (hover to see the organisations), a state square or the state drop-down to select a state, "states with no projects" to outline them on the map, or "Show these projects" for projects ending within 6 months. A filtered card shows "Clear" in its corner. The "…" next to the other donors opens the full donor list, with funding towards durable solutions and the number of projects, where donors can be selected.
- "Clear all" links on the area selector and the time window.
- Filters: minimum share towards durable solutions (top, default 0%), search, IASC criteria, intervention type, organisation type and name, organisation leadership (WLO, RLO, YLO, OPD), status, target group, geographic scope, donor and coordination mechanism, with counts and removable tags.
- Time window, contributing agencies strip with logos, light and dark mode, and a statement that the list is not exhaustive.
- "Add your project" menu: **Add one project** (form) or **Add multiple projects** (Excel template).
- The form opens a pre-filled email to dswg.sd@undp.org with a copy to the submitter. It has organisation lists by type, leadership, partner picker, localities by state, budget and share formatting, and "Add another project". Photos are not uploaded on the form: the email asks the submitter to attach up to 3 photos.
- Before sending, a **preview** shows the project exactly as it will appear (same drawing code as the map, in `assets/js/render.js`) and its place on the map: how each state's count changes and which IASC gaps it fills. A live preview card fills in while people type.
- Organisations without a logo on the site are asked to attach one (preview, email and template).
- **My submissions** (`my-submissions.html`) lists the projects sent from that browser, saved only in the browser (localStorage), with a clear notice that clearing browser data empties the list. A submission shows as "Published on the map" when a published project from the same lead organisation matches at least 4 of 7 data points (project number, name, start month, end month, total budget within 1%, states, IASC criteria). Published items are removed from the list 3 days later.
- When a project is sent, the form proposes the next project number for that agency (for example UNHCR-004), read from `data/project-refs.json`. It appears in the preview, the email subject and My submissions. DSU keeps that number when publishing; this assumes one person at DSU handles the numbering.
- Both template links download the file directly (the page fetches it), also when the dashboard is embedded in another site.
- **Add multiple projects** (`add-multiple.html`): people upload the filled Excel template, the page checks every row (missing fields, unknown states, dates, consent) and sends the ready rows. The Excel reader is bundled in `assets/vendor/` (SheetJS, Apache 2.0 licence).
- **Direct sending (back end):** when `SF.config.apiUrl` is set in `assets/js/common.js`, the form and the Excel page send projects straight to the review queue, with up to 3 photos and a logo, each made smaller in the browser to under 1 MB. If sending fails, the form offers the email route. With `apiUrl` empty, the site works by email as before.

The Projects and Gaps views (Phases 2 and 3) are not built yet. Their menu links are commented out in `assets/js/common.js` (`SF.renderHeader`).

## How it is built

A plain static site: HTML, CSS and JavaScript with no framework and no build step, so it stays light on slow connections and costs nothing to host.

```
index.html              Map explorer
add.html                "Add your project" form (also used for corrections)
about.html              About the data
assets/css/style.css    All styles
assets/js/common.js     Shared settings: contact email, IASC criteria and colours, states, lists, header and footer
assets/js/app.js        Map explorer logic
assets/js/form.js       Form logic, live preview, preview step and the email it builds
assets/js/render.js     Shared drawing of a project (pop-up, cards, place on the map) and the browser-only submissions list
assets/js/mine.js       My submissions page
my-submissions.html     My submissions page
assets/img/             UN Sudan logo (placeholder until the site moves to un.org) and favicon
assets/js/icons.js      OCHA humanitarian icons used for the IASC criteria
assets/img/logos/       Agency logos (full logo and a small square mark)
assets/photos/          Project photos, named <project number>-1.jpg (up to 3)
assets/templates/       Excel template for adding several projects
assets/vendor/          Excel reader for the upload page (SheetJS)
add-multiple.html       Upload the Excel template and send several projects
assets/js/multi.js      Logic of the upload page
data/logos.json         Agency logos shown on the map (written by the admin pages)
worker/                 Back end on Cloudflare: review queue, admin pages, publishing (see below)
data/projects.json      The published project data (public fields only)
data/project-refs.json  Permanent internal project numbers (for example IOM-001)
data/organisations.json Organisation list used by the form and the template
data/localities.json    Localities (OCHA admin 2) grouped by state
data/geo.json           Pre-drawn boundaries for the map (states, Abyei, neighbouring countries)
data/cleaning-log.md    Every change made to the source data before publication
data/boundaries/        Boundary source files used to build the map files
scripts/build_data.py   Turns SharePoint exports and returned templates into data/projects.json
scripts/build_template.py  Builds the Excel template
scripts/organisations_source.py  The organisation list; run it to rewrite data/organisations.json
scripts/build_geo.js    Builds data/geo.json and data/localities.json
```

## Handover note

### Update the data

1. Export the SharePoint list "Sudan DS Interventions" to Excel.
2. Save the export in `data/source/`. This folder is excluded from the repository, because the export contains focal point names and emails.
3. Run:
   ```
   pip install openpyxl
   python3 scripts/build_data.py data/source/<export>.xlsx
   ```
   You can pass several files; later files fill in or update earlier ones.
4. Set `LAST_UPDATED` at the top of `scripts/build_data.py` to the date of the export before running it.
5. Check `data/cleaning-log.md`, then commit `data/projects.json` and `data/cleaning-log.md`. The site updates within a minute or two.

### Load a returned Excel template

Save the returned file in `data/source/` and pass it to the same command, after the SharePoint export:

```
python3 scripts/build_data.py data/source/<export>.xlsx data/source/<returned-template>.xlsx
```

The template has 15 ready rows, no example row, and hidden Lists and Localities sheets that feed the drop-downs. The lead organisation drop-down follows the organisation type in the same row. Rebuild it with `python3 scripts/build_template.py` (this also sets the file author and dates).

### Internal project numbers

Each project gets a permanent number: the lead agency's acronym and a running number (IOM-001, IOM-002, UNDP-001). Numbers are stored in `data/project-refs.json`, never change and are never reused. They are not shown on the site; they appear only when someone suggests a correction (on the form and in the email subject), so DSU knows which project it is about.

### Add photos to a project

Save up to 3 photos (JPG or PNG, under 1 MB) as `assets/photos/<project number>-1.jpg`, `-2.jpg`, `-3.jpg`, then re-run the data update. Without photos, the pop-up shows the agency logo.

### Add an agency logo

Save the logo as `assets/img/logos/<ACRONYM>.png` (full logo, about 96 px high) and `<ACRONYM>-mark.png` (square emblem), and add the agency to `SF.LOGOS` in `assets/js/common.js`.

### Change the organisation list

Edit `scripts/organisations_source.py`, then run it, and run `python3 scripts/build_template.py` so the template lists match.

### Review and publish (admin pages)

Once the back end is on, the admin pages replace the SharePoint list as the place where the data is kept:
`https://solutions-footprint.<subdomain>.workers.dev/admin`

- **Review queue:** new projects from the form and the Excel page, with checks (possible duplicate, organisation without a logo, empty fields). Open one, edit any field, then **Publish to the map**, **Do not publish**, or **Reply to the submitter** (opens your email).
- **All projects:** every project, including private fields (focal point name and email). Edit and **Save and publish**, hide from the map, or delete. **Download a backup** saves everything as JSON.
- **Organisations:** logos of lead organisations; a new logo is published straight away.
- **History:** every change, each linked to its commit on GitHub, so any change can be undone there.

Publishing writes `data/projects.json`, `data/project-refs.json`, `data/logos.json` and any photos or logos to this repository in one commit. GitHub Pages updates the map within about two minutes. Focal point names and emails stay in the database and are never published. Project numbers are given by the back end when a project is received and never change or get reused.

The first time the back end is used it copies the projects already on the map into its database, so numbering continues from the existing numbers. Publishing is blocked until that copy is done.

`scripts/build_data.py` is still there for a one-off import of a SharePoint export, but once the admin pages are in use, change data there rather than with the script (the script would overwrite edits made in the admin pages).

### Set up the back end (once)

The back end is a Cloudflare Worker (free plan) with a Cloudflare D1 database. Its code is in `worker/`; the settings are in `worker/wrangler.toml`.

1. In Cloudflare, create a D1 database called `solutions-footprint` and put its ID in `worker/wrangler.toml` (already done).
2. On GitHub, create a private repository `durable-solutions-sudan-inbox` and click Watch, All activity. Each new submission opens an issue there, and GitHub emails you.
3. Create a fine-grained GitHub key with access to `durable-solutions-sudan` and `durable-solutions-sudan-inbox`, with Contents and Issues set to Read and write.
4. In Cloudflare, Workers & Pages, Create application, Import a repository: choose `durable-solutions-sudan`, set the root directory (path) to `worker`, keep the name `solutions-footprint`, and deploy.
5. In the Worker, Settings, Variables and Secrets, add two secrets: `GITHUB_TOKEN` (the key) and `ADMIN_PASSWORD`. Optional: `TURNSTILE_SECRET` for spam protection, with the matching site key in `SF.config.turnstileSiteKey`.
6. Put the Worker address in `SF.config.apiUrl` in `assets/js/common.js` (for example `https://solutions-footprint.ds-sudan.workers.dev`) and commit. The form now sends projects directly.

Secrets are never kept in this repository. To test the Worker on a computer, put them in `worker/.dev.vars` (excluded from the repository) and run `npx wrangler dev` in `worker/`.

### Change text

- Interface text is in the HTML files and in `assets/js/app.js` and `assets/js/form.js`.
- The contact email, IASC criteria names, colours and examples are in `assets/js/common.js` (`SF.config`, `SF.CRITERIA`).

### Add a filter option

Fixed lists (intervention types, organisation types, target groups, coordination mechanisms for the form) are in `assets/js/common.js`. Donor and coordination filters on the map are built automatically from the data. To add a new filter group, add an entry to `GROUP_META` and a matching test to `GROUPS` in `assets/js/app.js`.

### Replace the boundaries

States and localities come from OCHA's administrative boundaries for Sudan, through geoBoundaries (CC BY 3.0 IGO); neighbouring countries from Natural Earth. To use files downloaded directly from OCHA on HDX, save the admin 1 and admin 2 GeoJSON files in `data/boundaries/` and run:

```
npm install d3-geo topojson-server topojson-simplify topojson-client polylabel world-atlas@2.0.2
node scripts/build_geo.js data/boundaries/<admin1>.geojson data/boundaries/<admin2>.geojson
```

State names are matched in `NAME_FIX` at the top of `scripts/build_geo.js`.

## Data rules

- States come from a fixed list of 18. Towns entered as states are recorded as localities.
- IASC criteria come from the fixed list of eight. Other entries are matched to the closest criterion (see `data/cleaning-log.md`).
- A project in several states counts once in each state; its funding is split equally across them for state totals.
- Nationwide projects are counted separately from state totals.
- Funding towards durable solutions is budget times share, unless the organisation gives an amount.
- People reached: the total adds up five groups (IDPs, returnees, refugees, host community, other or not specified) and cannot be typed in. People reached and the share of women and girls are required. Optional: persons with disabilities (% of the total, and of whom women and girls), and a breakdown by women, girls, men and boys for each group (girls and boys are under 18); a group with a breakdown takes its number from it, and the share of women and girls is then calculated. The data keeps `people`, `femaleShare`, `pwdShare`, `pwdFemaleShare` (shares from 0 to 1) and `peopleSex`. In the Excel template the 20 breakdown columns are folded away (click + above the Remarks column).
- A project can name up to 5 donors. With more than one donor, the amount from each is required (form, Excel template and admin pages), and the amounts cannot add up to more than the total budget. On the map, funding towards durable solutions is split between the donors in line with those amounts. The data keeps `donor` (the names) and `donors` (each name with its amount).
- Status follows the dates and is worked out in the browser each day.
- Fields that are not reported are left empty.
- This is not an exhaustive list of projects contributing to durable solutions in Sudan; it shows only projects reported to the DSWG.
- Focal point names and emails are never published. Every project shows dswg.sd@undp.org as its contact.

## Publish with GitHub Pages

Domain: `durablesolutionshub.org` (DNS at Cloudflare: four A records to GitHub Pages and a CNAME for www, all set to DNS only).

Settings, then Pages, then "Deploy from a branch", branch `main`, folder `/ (root)`.

To embed on sudan.un.org:

```html
<iframe src="https://durablesolutionshub.org/sudan/mapping/" title="Solutions Footprint" style="width:100%;height:1900px;border:0" loading="lazy"></iframe>
```

## Credits

- Icons: [OCHA Humanitarian Icons](https://brand.unocha.org/d/xEPytAUjC3sH/icons), released for free use.
- Boundaries: OCHA administrative boundaries for Sudan via [geoBoundaries](https://www.geoboundaries.org), CC BY 3.0 IGO; [Natural Earth](https://www.naturalearthdata.com), public domain.
- Agency logos belong to their organisations.
- Typeface: Roboto, SIL Open Font License.
- Excel reader: SheetJS Community Edition, Apache 2.0 licence.

The boundaries and names shown and the designations used on the map do not imply official endorsement or acceptance by the United Nations.
