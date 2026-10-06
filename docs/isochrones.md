# Generating the access map

The app consumes precomputed ORS driving isochrones. It never calls ORS from a visitor's browser. A generated manifest and settlement coverage file are required before the access map and settlement KPI become active.

## Data contract

- `scripts/prepare_data.py` writes REFES facilities, BAHRA settlements (with stable `settlement_id`), provinces, and metrics. It deliberately does not erase generated access data.
- `scripts/generate_isochrones.py` groups facilities by REFES typology and sends up to five locations per ORS request. Each response asks for exact cumulative drive-time contours at 150, 300, 450, 600, 900, 1,200, 1,350, 1,800, 2,700, and 3,600 seconds, using `location_type: destination`.
- Each contour is intersected with every province it touches. This means a facility across a provincial border can contribute to settlements in the neighboring province; output is tagged to the settlement/coverage province.
- `public/data/access/manifest.json` maps province IDs to static compressed GeoJSON chunks. `settlement-coverage.json` stores each BAHRA settlement's reachable typologies at 10, 20, 30, and 60 minutes.
- `public/_headers` tells Pages that `.geojson.gz` assets are gzip encoded GeoJSON. The browser transparently decompresses them. The site loads province chunks as needed and caches them in memory.
- `.isochrone-cache/` stores gzip ORS response checkpoints and a local UTC daily request counter. It is ignored by Git and must be kept between runs to resume work.

## Windows / PowerShell procedure

1. Install the Python packages already needed by data preparation and geometry assembly if they are missing: `python -m pip install pandas geopandas pyogrio shapely`.
2. Regenerate prepared browser data after source changes: `npm.cmd run prepare-data`.
3. Inspect the estimate without using the key or network: `npm.cmd run generate-isochrones -- --plan`. It prints the number of API calls implied by the current REFES categories and locations.
4. Set the rotated ORS key only in the current PowerShell process (do not put it in source control or chat): `$env:ORS_API_KEY = Read-Host "ORS API key"`.
5. Start with one request: `npm.cmd run generate-isochrones -- --execute --resume --max-requests 1`. This consumes one request and writes one local checkpoint. Confirm the response and resulting checkpoint before continuing.
6. Resume in paced batches: `npm.cmd run generate-isochrones -- --execute --resume --max-requests 100`. Each run stops at 100 new requests or at the default 500-call UTC daily cap. The script waits 3.1 seconds between calls and retries rate limits; keep `.isochrone-cache` intact. If ORS reports quota exhausted, stop and resume after the account quota resets.
7. On the final run, when all request checkpoints exist, the script assembles the outputs automatically. If assembly fails or you want to retry it without any API calls, run `npm.cmd run generate-isochrones -- --assemble-only`.
8. Check `public/data/access/manifest.json`, `settlement-coverage.json`, and the `.geojson.gz` files. Then run `npm.cmd run build` and preview with `npm.cmd run preview`.
9. Commit generated `public/data/access` assets with the app, then deploy the Pages build. Do not commit `.isochrone-cache` or any API key.

The generator has a no-network default. `--execute` is the explicit switch that sends requests. `--max-requests` is useful for a pilot; `--daily-limit` can lower the local cap if the ORS account has less remaining quota, for example `--daily-limit 100`.

## Quota / runtime expectation

At five locations per request, the current prepared dataset plans about 6,425 calls. The default pacing is at most about 20 calls/minute, and the script's local cap is 500 successful calls per UTC day for a Standard key. ORS lists 2,500 isochrone calls/day and 40/minute for eligible Collaborative accounts; the project is academic, so request the upgrade in the HeiGIT account dashboard before processing. If approved, use `--daily-limit 2500 --delay 1.6`; the workload then fits in three quota days. Actual account limits and remaining quota control the schedule. The full generation is intentionally not part of `npm run build` or `npm run prepare-data`.

The map uses exact cumulative polygons: for a selected limit `T`, the four visible contours correspond to `T/4`, `T/2`, `3T/4`, and `T`. The legend labels these bands. Settlement reachability uses the union of any selected typology's isochrones, so a settlement counts once even when more than one selected typology reaches it.

## ORS request reference

The generator uses the current HeiGIT-hosted ORS v2 Isochrones POST endpoint and `Authorization` header. See [ORS API playground and documentation](https://openrouteservice.org/dev/); the service supports one or multiple locations and exact range values. HeiGIT's [API migration notice](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912) lists the replacement endpoint base.
