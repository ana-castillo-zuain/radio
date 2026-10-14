# Generating the access map

The app consumes precomputed ORS driving isochrones. It never calls ORS from a visitor's browser. A generated manifest and settlement coverage file are required before the access map and settlement KPI become active.

## Data contract

- `scripts/prepare_data.py` writes REFES facilities, BAHRA settlements (with stable `settlement_id`), provinces, and metrics. It deliberately does not erase generated access data.
- `scripts/generate_isochrones.py` groups facilities by REFES typology and sends up to five locations per ORS request. Each response asks for cumulative drive-time contours at 300, 900, 1,800, and 3,600 seconds (5, 15, 30, and 60 minutes), using `location_type: destination`.
- Each contour is intersected with every province it touches. This means a facility across a provincial border can contribute to settlements in the neighboring province; output is tagged to the settlement/coverage province.
- `public/data/access/manifest.json` maps province IDs to compressed GeoJSON chunks and records generation progress. The map also uses `overview.geojson.gz`, a simplified nationwide view, and province chunks that are simplified less for closer inspection. The browser loads only the overview nationally and only the selected province's files after a province is chosen.
- `scripts/access_map_assets.py` builds the simplified overview and province chunks from generated assets. It records province-to-category chunk mappings so category filters can avoid unrelated chunks. Run it on existing generated files with `npm.cmd run prepare-access-map`; normal isochrone generation invokes it automatically.
- The browser decompresses `.geojson.gz` assets and reports loading errors on the map. It does not keep every previously viewed province in memory.
- `.isochrone-cache/` stores gzip ORS response checkpoints, a local UTC daily request counter, and the failed-facility report used when resuming. It is ignored by Git and must be kept between runs to resume work.
- Persistent ORS error 3099 is retried once, then multi-facility requests are split until the failing facility is isolated. That facility is skipped and recorded with its ID, typology, coordinates, and ORS message. Other persistent server errors stop the run after bounded retries.
- The final assembly writes `public/data/access/generation-report.json`; the access map displays a notice and links to it when any facilities were omitted.

## Windows / PowerShell procedure

1. Install the Python packages already needed by data preparation and geometry assembly if they are missing: `python -m pip install pandas geopandas pyogrio shapely`.
2. Regenerate prepared browser data after source changes: `npm.cmd run prepare-data`.
3. Inspect the estimate without using the key or network: `npm.cmd run generate-isochrones -- --plan`. It prints the number of API calls implied by the current REFES categories and locations.
4. Set the rotated ORS key only in the current PowerShell process (do not put it in source control or chat): `$env:ORS_API_KEY = Read-Host "ORS API key"`.
5. Start with one request: `npm.cmd run generate-isochrones -- --execute --resume --max-requests 1`. This consumes one request and writes one local checkpoint. Confirm the response and resulting checkpoint before continuing.
6. Generate up to the Collaborative daily quota with `npm.cmd run generate-isochrones -- --execute --resume --daily-limit 2500 --delay 1.8 --concurrency 12`. The script allows up to 12 in-flight calls while starting requests at least 1.8 seconds apart across all workers (about 33/minute). The daily cap counts all reserved API attempts, including retries; keep `.isochrone-cache` intact. Add `--max-requests 100` if you prefer a shorter run session, then repeat with `--resume`. If ORS reports quota exhausted, resume after the account quota resets.
7. On the final run, when all request checkpoints exist, the script assembles the outputs automatically. If assembly fails or you want to retry it without any API calls, run `npm.cmd run generate-isochrones -- --assemble-only`.
8. To preview the checkpoints already generated before the full run finishes, use `npm.cmd run generate-isochrones -- --assemble-partial`. This makes no ORS requests and does not require an API key: it assembles completed top-level batch checkpoints and skips unfinished batches. It replaces the local `public/data/access` preview files. The manifest records progress, and the site labels the settlement access KPI as a minimum reached so far; unfinished batches may increase that figure. Continue the usual `--execute --resume` runs later. When all batches finish, normal generation publishes a complete manifest and replaces the partial preview.
9. Check `public/data/access/manifest.json`, `overview.geojson.gz`, `settlement-coverage.json`, `generation-report.json`, and the province `.geojson.gz` files. For an existing dataset, run `npm.cmd run prepare-access-map` once to create the overview and simplified province assets. Then run `npm.cmd run build` and preview with `npm.cmd run preview`.
10. Commit generated `public/data/access` assets with the app, then deploy the Pages build. Do not commit `.isochrone-cache` or any API key.

The generator has a no-network default. `--execute` is the explicit switch that sends requests. `--max-requests` is useful for a pilot or shorter run sessions; `--daily-limit` can lower the local cap if the ORS account has less remaining quota, for example `--daily-limit 100`. Checkpoints created for the previous ten-contour configuration have different keys and will not count as completed for this run. `--resume` preserves the failed-facility report; a fresh execution replaces it. Both assembly options run without ORS: `--assemble-only` requires every batch checkpoint, while `--assemble-partial` skips missing batches and marks output progress in the manifest.

## Quota / runtime expectation

At five locations per request, the current prepared dataset plans about 6,425 calls. The default local cap remains 500 attempts per UTC day; for an account with a 2,500/day and 40/minute quota, set `--daily-limit 2500 --delay 1.8 --concurrency 12`. This paces starts at about 33/minute with bounded in-flight requests and keeps headroom under the minute limit. At that pace, 2,500 calls take roughly 75 minutes of provider runtime per quota day, and the full workload takes about 3.2 hours across at least three quota days. Actual API latency, rate limits, and remaining account quota affect elapsed time. The full generation is intentionally not part of `npm run build` or `npm run prepare-data`.

The map displays non-overlapping time bands: 0–5 minutes in red, 5–15 in yellow, 15–30 in green, and 30–60 in blue. Selecting 60 minutes shows all bands; selecting 30, 15, or 5 minutes hides the longer bands. Settlement reachability uses cumulative contours and the selected threshold, so a settlement counts once even when more than one selected typology reaches it.

## ORS request reference

The generator uses the current HeiGIT-hosted ORS v2 Isochrones POST endpoint and `Authorization` header. See [ORS API playground and documentation](https://openrouteservice.org/dev/); the service supports one or multiple locations and exact range values. HeiGIT's [API migration notice](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912) lists the replacement endpoint base.
