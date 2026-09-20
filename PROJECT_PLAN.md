# Project outline: Radiografía del sistema de salud

**Delivery deadline:** Sunday, 18 October 2026  
**Planning window:** Monday, 21 September through Sunday, 18 October 2026  
**Recommended deployment:** static frontend built from this repository and deployed to GitHub Pages or Vercel  
**Primary objective:** deliver a clear, interactive web visualization with two connected views:

1. **El sistema que vemos:** REFES establishments, professional KPIs, typology filtering, and the doctor/nurse ratio.
2. **No siempre está igual de cerca:** geographic accessibility to REFES establishments, province filtering, travel-time indicators, and professional/population rates.

## Current position

### Already available

- Two REFEPS CSVs:
  - `medicos-2023.csv`
  - `enfermeria-2023.csv`
- REFES establishment workbook:
  - `establecimientos-asistenciales-asentados-registro-federal-refes-20260114 (1).xlsx`
- BAHRA settlement GeoJSON:
  - `base_total.geojson/base_total.geojson`
- Census-radio Shapefile and sidecars:
  - `radios_censales2/radios_censales2.shp`
  - `.dbf`, `.shx`, `.prj`, `.cst`
- Methodological PDFs in `docs/`.
- An EDA notebook:
  - `exploratory_data_analysis.ipynb`

### Not available yet

- No frontend, package manifest, routing, components, or deployment configuration.
- No processed frontend-ready data files.
- No population dataset for rates per 1,000 inhabitants.
- No verified accessibility matrix or isochrone data.
- No confirmed resolution of the census-radio CRS conflict:
  - the PDF documents EPSG:4326;
  - the Shapefile currently reads as EPSG:3857.
- REFES coordinates contain malformed numeric values and need validation before mapping.
- No final visual design system or interaction state model.

## Scope strategy

### Must ship by 18 October

- A deployed web page with both story sections.
- A clean cyan/white/black “radiography” visual system.
- REFES map with typology filtering.
- KPI cards for:
  - total establishments;
  - doctors;
  - nurses;
  - doctor/nurse ratio versus 2:1 reference.
- Clickable doctor/nurse KPI detail panels:
  - Argentine/foreign counts;
  - nurse qualification categories where available.
- Province selection that updates the map and all available KPIs.
- A defensible accessibility view using precomputed nearest-facility travel-time or distance results.
- Time-threshold selector for 10, 20, 30, and 60 minutes if the data is available.
- Deployed URL tested on desktop and mobile.

### Can be simplified without failing the main objective

- Use nearest eligible establishment per census radio instead of a full radio-to-every-establishment matrix.
- Use a static precomputed accessibility file rather than calculating routes in the browser.
- Use province boundaries or a province dropdown if clicking tiny provinces is unreliable.
- Use a modal/drawer for KPI detail rather than complex animated expansion.
- Use point density and restrained labels instead of a fully annotated national map.

### Defer until after delivery

- Full all-pairs routing for every radio and every REFES establishment.
- Live routing APIs from the browser.
- User accounts, data upload, and dynamic database infrastructure.
- BAHRA as a primary analytical layer; use it initially for geographic context or validation.
- Advanced animation, search, comparison mode, and multiple simultaneous provinces.
- Exact isochrone polygons if validated travel-time surfaces cannot be produced safely in time.

## Non-negotiable analytical decisions

1. **Professional totals:** aggregate REFEPS with `sum(total)`, never with row counts.
2. **Active professionals:** use the documented active-population definition if age-based filtering is shown; otherwise label the KPI as “habilitados”.
3. **Province attribution:** use `provincia_residencia` for professionals, not province of training.
4. **Nurse categories:** verify the exact values in `profesion_referencia` before grouping as auxiliar, técnico, or licenciado.
5. **Population denominator:** do not publish rates per 1,000 until an authoritative population table and year are present.
6. **Accessibility:** label whether values represent straight-line distance, routed distance, or routed travel time.
7. **CRS:** resolve the census-radio CRS discrepancy before any spatial join or distance calculation.
8. **Missingness:** preserve and document missing/unknown categories; do not silently treat them as zero.

# Four-week execution plan

## Week 1 — Data contract and application skeleton

**Dates:** Monday, 21 September – Sunday, 27 September 2026  
**Milestone:** by Sunday, all analytical inputs are validated, the frontend runs locally, and the first view has a visible data contract.

### Monday, 21 September — Freeze the analytical scope

- Create a one-page data dictionary from the PDFs and the EDA notebook.
- Decide the display labels:
  - “Establecimientos REFES”
  - “Médicos habilitados”
  - “Enfermeros habilitados”
  - “Ratio médicos/enfermeros”
- Decide whether the submitted story uses “habilitados” or “activos”.
- Decide the minimum accessibility metric for the MVP:
  - recommended: nearest eligible REFES facility and travel-time threshold per radio.
- Record decisions in `PROJECT_PLAN.md` or a project issue before coding.

**Acceptance check:** every KPI has a named source column, aggregation rule, geographic level, and missing-data rule.

### Tuesday, 22 September — Clean and validate REFES

- Convert the workbook into a clean tabular export.
- Keep identifiers as strings where leading zeros or code structure matter.
- Convert administrative numeric codes explicitly.
- Validate longitude/latitude ranges:
  - longitude between -75 and -50;
  - latitude between -56 and -20.
- Separate:
  - valid coordinate rows;
  - missing coordinates;
  - malformed/out-of-range coordinates.
- Deduplicate by `establecimiento_id`.
- Keep all original fields in a raw copy and create a cleaned copy for the web.

**Deliverable:** `data/processed/refes_clean.parquet` or `.csv` plus a quality summary.

### Wednesday, 23 September — Clean professional datasets

- Normalize both professional files to the same schema.
- Convert documented sentinel codes to missing values.
- Create an explicit `profession` field: `medicos` or `enfermeria`.
- Create an explicit `origin_group`:
  - `Argentino`;
  - `Extranjero`;
  - `Sin datos`.
- Inspect and map actual `profesion_referencia` values for nurse qualification groups.
- Produce national and province-level aggregates:
  - total professionals;
  - origin;
  - nurse qualification;
  - sex and age group only if useful to the story.

**Deliverable:** `data/processed/professionals_by_province.csv` and `professionals_national.json`.

### Thursday, 24 September — Resolve geography and population dependencies

- Confirm the real CRS of `radios_censales2.shp` using the `.prj`, coordinate bounds, and a known province location.
- Do not overwrite CRS metadata until confirmed.
- Obtain the authoritative population table required for rates per 1,000.
- Confirm its year and geographic key against the radio/province data.
- If population data cannot be obtained by Thursday:
  - remove rates per 1,000 from the MVP;
  - keep absolute professional totals and ratio;
  - document the limitation visibly.

**Decision gate:** no population denominator means no published rate card.

### Friday, 25 September — Scaffold the web project

- Create the frontend, preferably with Vite + React + TypeScript.
- Add:
  - `package.json`;
  - development command;
  - production build command;
  - map library such as MapLibre GL JS or Leaflet;
  - chart/UI library only if it reduces implementation time.
- Create the initial routes or view state:
  - `/` for “El sistema que vemos”;
  - `/acceso` or an in-page second section for “No siempre está igual de cerca”.
- Add the cyan/white/black design tokens.

**Acceptance check:** a blank app builds locally and can be deployed to a preview URL.

### Weekend, 26–27 September — Prepare frontend data packages

- Generate small, browser-friendly files:
  - REFES points with only required fields;
  - province aggregates;
  - professional KPI aggregates;
  - province geometry or simplified boundary data;
  - radio accessibility input/output.
- Simplify geometries for web delivery.
- Do not put the raw 150 MB DBF or unprocessed source files into the frontend bundle.

**Week 1 exit criteria**

- `npm run build` works.
- Clean REFES data exists.
- Professional aggregates reproduce totals from the CSVs.
- CRS decision is documented.
- Population decision is made.
- The frontend loads a map and a test KPI from processed data.

## Week 2 — Build and finish “El sistema que vemos”

**Dates:** Monday, 28 September – Sunday, 4 October 2026  
**Milestone:** by Sunday, the first story section is usable end to end.

### Monday, 28 September — Base map and REFES styling

- Load cleaned REFES points.
- Use a dark or pale background with cyan-white establishment marks.
- Add zoom-dependent point sizing.
- Avoid labels at national zoom.
- Add loading, empty, and invalid-coordinate states.
- Add a simple legend for establishment visibility.

### Tuesday, 29 September — Typology interaction

- Compute the list of available `tipologia_sigla` / display names.
- Add a clickable “total establishments” KPI.
- Open a drawer/popover with multi-select typologies.
- On selection:
  - selected facilities remain bright;
  - non-selected facilities reduce opacity or disappear;
  - total KPI updates to the selected count.
- Add “Clear selection”.

**Acceptance check:** selecting one or more typologies updates both the KPI and map without reloading.

### Wednesday, 30 September — Professional KPI cards

- Add doctor and nurse totals.
- Make each KPI clickable.
- Show detail panel with:
  - Argentine;
  - foreign;
  - unknown;
  - nurse qualification breakdown.
- Clearly display whether values are national and whether they represent habilitados.
- Add formatted numbers and accessible labels.

### Thursday, 1 October — Ratio card and reference

- Calculate `medicos / enfermeros`.
- Show the reference ratio `2:1` as a benchmark, not as a target achieved by the data.
- Decide wording for the direction:
  - “1 médico por cada X enfermeros”;
  - or “X médicos por enfermero”.
- Add a small visual comparison to 2:1.
- Add a data-source note.

### Friday, 2 October — Explore button and narrative flow

- Add the “Explorar” button.
- Scroll or transition to the accessibility section.
- Add a short explanatory intro:
  - what REFES represents;
  - what the professional totals represent;
  - what the map does not claim.

### Weekend, 3–4 October — First-view QA

- Test national totals against notebook outputs.
- Test every typology.
- Test keyboard navigation and mobile layout.
- Capture a preview screenshot.
- Fix only issues in this view; do not start decorative animation yet.

**Week 2 exit criteria**

- First view works without placeholder values.
- Typology filtering works.
- KPI detail interactions work.
- Ratio works.
- The first view is deployable independently.

## Week 3 — Accessibility view and province state

**Dates:** Monday, 5 October – Sunday, 11 October 2026  
**Milestone:** by Sunday, the second view has a defensible precomputed metric and shared province filters.

### Monday, 5 October — Build the accessibility data

- Start with census-radio centroids.
- Restrict candidate facilities using:
  - province or bounding-box prefilter;
  - REFES valid coordinates;
  - selected typology.
- For the MVP, calculate the nearest eligible facility per radio.
- Use routed travel time if a reliable batch service is available.
- Otherwise use a clearly labeled approximation:
  - straight-line distance;
  - or a validated distance-to-time approximation.
- Store only the fields needed by the web:
  - radio ID;
  - province;
  - geometry/centroid;
  - nearest facility ID;
  - distance or time;
  - typology used;
  - calculation method.

**Important:** OSRM provides routing/table capabilities but does not by itself provide a complete isochrone product. Do not promise full isochrone polygons unless they have been generated and validated with an appropriate service or offline workflow.

### Tuesday, 6 October — Accessibility colors and map

- Add the eco-doppler scale:
  - red = shorter distance/time;
  - yellow/green = intermediate;
  - blue = longer distance/time.
- Use census-radio centroids or simplified polygons depending on performance.
- Add a legend with units.
- Add an explicit “data method” label.

### Wednesday, 7 October — Typology and threshold controls

- Add the typology dropdown.
- Add threshold control:
  - 10 minutes;
  - 20 minutes;
  - 30 minutes;
  - 60 minutes.
- Recalculate the displayed percentage from precomputed values or select a precomputed column.
- Show no-data state when a selected typology has no eligible facility.

### Thursday, 8 October — Province interaction

- Add province boundary layer or reliable province selection.
- On province click:
  - update selected province;
  - zoom to the province;
  - filter accessibility radios;
  - filter REFES;
  - update professional totals;
  - update population denominator if available.
- Add a visible “Argentina” reset control.

### Friday, 9 October — Accessibility KPI cards

- Add `% of radios beyond selected threshold`.
- Add doctors per 1,000 and nurses per 1,000 only if the population denominator passed Week 1 validation.
- Add doctor/nurse ratio for the selected province.
- Reuse the professional detail panel interaction from the first view.

### Weekend, 10–11 October — Performance and data QA

- Test national data volume and initial load time.
- Simplify geometry further if the page is slow.
- Test all provinces and all typology selections.
- Compare a sample of routes/distances manually.
- Record limitations directly in the interface or methodology note.

**Week 3 exit criteria**

- Accessibility view works for Argentina and at least three provinces.
- Typology and time controls update the metric.
- Province selection updates all connected data.
- The metric has a clear unit and method.
- No browser-side all-pairs routing is required.

## Week 4 — Integration, polish, deployment, and submission

**Dates:** Monday, 12 October – Sunday, 18 October 2026  
**Milestone:** public production URL and final submission package by Friday, 16 October; reserve the weekend for contingency.

### Monday, 12 October — Integrate the two stories

- Finalize transitions between sections.
- Preserve selected province and typology state where appropriate.
- Add responsive layouts:
  - desktop map + side cards;
  - stacked mobile cards;
  - touch-friendly controls.
- Remove notebook-only assumptions from the web.

### Tuesday, 13 October — Visual polish

- Apply the radiography palette consistently.
- Tune cyan/white contrast and map opacity.
- Add typography hierarchy.
- Add subtle hover/focus states.
- Avoid animation that blocks reading or delays the first useful result.

### Wednesday, 14 October — Accuracy and accessibility QA

- Verify every headline KPI against processed source tables.
- Test:
  - zero-selection;
  - one typology;
  - multiple typologies;
  - province reset;
  - missing coordinates;
  - empty typology result;
  - mobile viewport;
  - keyboard navigation;
  - color contrast.
- Add a concise sources/methodology panel.

### Thursday, 15 October — Deploy from the repository

- Add the deployment workflow:
  - GitHub Actions + GitHub Pages, or
  - Vercel connected to the repository.
- Configure production base path if using GitHub Pages.
- Build with production data.
- Verify that all assets load from the deployed URL.
- Test a clean browser session with no development server.

### Friday, 16 October — Submission candidate

- Freeze the data and code used in the submission.
- Tag or branch the release.
- Produce:
  - public URL;
  - short project description;
  - data sources;
  - methodology and limitations;
  - screenshots or short screen recording if required;
  - repository instructions.
- Ask one person unfamiliar with the data to use the page and report confusion.

### Weekend, 17–18 October — Contingency and final handoff

- Fix only high-severity issues:
  - broken deployment;
  - incorrect totals;
  - unusable map;
  - failed province/typology controls.
- Do not introduce new analytical features.
- Confirm the final URL, repository state, and submission form.

## Feature implementation breakdown

### REFES map

1. Clean and validate coordinates.
2. Export only `id`, name, province, typology, financing, longitude, latitude.
3. Load points into MapLibre or Leaflet.
4. Style points with cyan-white opacity.
5. Bind typology filters to a single shared selection state.
6. Derive the visible count from the filtered point set.

### Typology selector

1. Build a unique typology list from cleaned REFES.
2. Store selected typologies as an array/set.
3. Filter map features and count from that state.
4. Keep the selection visible in the drawer.
5. Add clear-all and no-result states.

### Doctor/nurse KPI cards

1. Aggregate professional totals nationally and by province.
2. Aggregate origin using `pais_origen`.
3. Aggregate nurse qualifications from verified profession labels.
4. Store national and province aggregates in compact JSON.
5. Render the headline number.
6. Open a shared detail drawer on click.

### Ratio

1. Define numerator and denominator precisely.
2. Calculate from the same selected geography.
3. Display the 2:1 reference separately.
4. Add a note explaining that the reference is a benchmark.
5. Handle zero or missing nurse counts explicitly.

### Province selection

1. Load simplified province boundaries.
2. Attach a stable province code, not only a name.
3. Store `selectedProvince = null` for national view.
4. Filter all aggregate data by that code.
5. Fit map bounds to the province.
6. Add an explicit reset-to-Argentina control.

### Accessibility metric

1. Confirm radio CRS and create radio centroids.
2. Validate REFES coordinates.
3. Define candidate facilities by selected typology.
4. Compute nearest facility per radio offline.
5. Store travel time/distance and method.
6. Aggregate threshold percentages by province, typology, and threshold.
7. Let the frontend select precomputed results rather than call a routing API.

### Population rates

1. Obtain authoritative population by province and compatible year.
2. Match geographic codes.
3. Check for missing or duplicate province keys.
4. Calculate professionals / population * 1,000.
5. Label the population year.
6. Remove the card if the denominator cannot be verified by 24 September.

## Suggested repository structure

```text
data/
  raw/                    # source files, if moved
  processed/              # cleaned tables and web-ready JSON/GeoJSON
src/
  components/
  data/
  views/
  styles/
public/
  assets/
exploratory_data_analysis.ipynb
PROJECT_PLAN.md
README.md
package.json
vite.config.*
.github/workflows/deploy.yml
```

## Weekly project management routine

At the beginning of each work session:

1. Choose one task from the current week.
2. Define its acceptance check before coding.
3. Commit a working increment.
4. Record blockers immediately; do not silently move them to the final week.

At the end of each week:

- Run the frontend production build.
- Re-run the relevant data validation.
- Compare headline numbers with the notebook.
- Record what is complete, blocked, or intentionally deferred.

## Definition of done

The project is ready to submit when:

- The production URL loads from a clean browser session.
- Both story sections are reachable and understandable without verbal explanation.
- National REFES, doctor, nurse, and ratio values match the processed data.
- Typology filtering visibly changes the map and establishment KPI.
- Province selection updates the available geography-dependent values.
- Accessibility values state their method, units, and limitations.
- No unverified population rate is shown.
- The repository contains the source code, processed-data generation steps, deployment configuration, and source/methodology notes.
