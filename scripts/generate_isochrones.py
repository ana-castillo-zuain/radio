"""Generate driving isochrones from the prepared REFES dataset using public ORS.

The default command is a no-network plan. Use --execute explicitly to consume
ORS quota. Results are checkpointed after each request and can be resumed.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
CACHE = ROOT / ".isochrone-cache"
RANGES = [150, 300, 450, 600, 900, 1200, 1350, 1800, 2700, 3600]
COVERAGE_RANGES = {600: "10", 1200: "20", 1800: "30", 3600: "60"}
MAX_LOCATIONS = 5
ENDPOINT = "https://api.heigit.org/openrouteservice/v2/isochrones/driving-car"


def read_json(path: Path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def digest(value: object) -> str:
    return hashlib.sha1(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]


def load_work():
    facilities = read_json(DATA / "facilities.geojson")["features"]
    settlements = read_json(DATA / "settlements.geojson")["features"]
    provinces = read_json(DATA / "provinces.geojson")["features"]
    categories = defaultdict(list)
    for feature in facilities:
        props = feature["properties"]
        categories[props.get("category") or "Sin tipología informada"].append(feature)
    return facilities, settlements, provinces, categories


def chunks(values, count):
    for start in range(0, len(values), count):
        yield values[start:start + count]


def jobs_for(categories):
    for category, features in sorted(categories.items(), key=lambda item: item[0].casefold()):
        for group in chunks(features, MAX_LOCATIONS):
            locations = [item["geometry"]["coordinates"] for item in group]
            ids = [item["properties"]["id"] for item in group]
            key = digest({"category": category, "ids": ids, "locations": locations, "ranges": RANGES})
            yield {"key": key, "category": category, "locations": locations, "ids": ids}


def post(job, api_key):
    body = {"locations": job["locations"], "range_type": "time", "range": RANGES, "location_type": "destination"}
    request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": api_key, "Content-Type": "application/json",
    })
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", "replace")[:1200]
            lowered = details.casefold()
            if error.code == 429 and any(word in lowered for word in ("quota", "daily limit", "limit exceeded")):
                raise RuntimeError(f"ORS quota reached; saved checkpoints remain resumable: {details}") from error
            if error.code == 429 and attempt < 5:
                delay = int(error.headers.get("Retry-After", min(60 * (attempt + 1), 300)))
                print(f"Rate limited; waiting {delay}s", flush=True)
                time.sleep(delay)
                continue
            raise RuntimeError(f"ORS HTTP {error.code}: {details}") from error
        except (TimeoutError, urllib.error.URLError) as error:
            if attempt == 5:
                raise RuntimeError(f"ORS connection failed: {error}") from error
            time.sleep(min(15 * (attempt + 1), 60))
    raise RuntimeError("ORS retries exhausted")


def cached_response(job):
    path = CACHE / "responses" / f"{job['key']}.json.gz"
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def save_response(job, value):
    path = CACHE / "responses" / f"{job['key']}.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as stream:
        json.dump(value, stream, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", action="store_true", help="show request count and estimated quota use (default)")
    parser.add_argument("--execute", action="store_true", help="send ORS requests; requires ORS_API_KEY")
    parser.add_argument("--max-requests", type=int, help="cap new requests for a pilot; cached requests do not count")
    parser.add_argument("--delay", type=float, default=3.1, help="seconds between requests (default respects 20/minute)")
    parser.add_argument("--daily-limit", type=int, default=500, help="maximum new calls in this UTC day (default 500)")
    parser.add_argument("--resume", action="store_true", help="reuse completed response checkpoints")
    parser.add_argument("--assemble-only", action="store_true", help="assemble cached responses without calling ORS")
    args = parser.parse_args()
    if not (DATA / "facilities.geojson").exists():
        sys.exit("Prepared data missing. Run npm run prepare-data first.")
    _, settlements, province_features, categories = load_work()
    jobs = list(jobs_for(categories))
    cached = sum(1 for job in jobs if cached_response(job)) if args.resume or args.assemble_only else 0
    remaining = len(jobs) - cached
    print(f"Facilities: {sum(map(len, categories.values())):,}; typologies: {len(categories)}")
    print(f"Batch size: {MAX_LOCATIONS}; exact contours: {len(RANGES)}; planned calls: {len(jobs):,}")
    print(f"Completed checkpoints found: {cached:,}; calls remaining: {remaining:,}")
    if not args.execute and not args.assemble_only:
        print("No requests sent. Review ORS account quota, set ORS_API_KEY in this shell, then pass --execute --resume.")
        return

    if not args.assemble_only:
        api_key = os.environ.get("ORS_API_KEY")
        if not api_key:
            sys.exit("ORS_API_KEY is not set in the current shell. Do not paste it into chat or commit it.")
        state_path = CACHE / "quota-state.json"
        today = datetime.now(timezone.utc).date().isoformat()
        state_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            quota_state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            quota_state = {}
        used_today = int(quota_state.get("date") == today and quota_state.get("successful_calls", 0) or 0)
        if used_today >= args.daily_limit:
            sys.exit(f"Local daily cap reached ({used_today}/{args.daily_limit} calls UTC). Resume tomorrow.")
        sent = 0
        for job in jobs:
            if args.resume and cached_response(job) is not None:
                continue
            if args.max_requests is not None and sent >= args.max_requests:
                print(f"Request cap reached ({sent}); run again with --resume to continue.")
                return
            if used_today >= args.daily_limit:
                print(f"UTC daily cap reached ({used_today}/{args.daily_limit}); run again after the UTC date changes.")
                return
            response = post(job, api_key)
            features = response.get("features")
            if not isinstance(features, list):
                raise RuntimeError(f"Unexpected ORS payload for checkpoint {job['key']}")
            save_response(job, response)
            sent += 1
            used_today += 1
            state_path.write_text(json.dumps({"date": today, "successful_calls": used_today}), encoding="utf-8")
            print(f"Saved {sent} / {args.max_requests or remaining} new response(s); checkpoint {job['key']}", flush=True)
            time.sleep(max(0, args.delay))
        print("All API responses checkpointed. Starting geometry assembly.")

    # GIS dependencies are intentionally needed only after ORS responses exist.
    try:
        from shapely.geometry import Point, shape, mapping
        from shapely.ops import unary_union
        from shapely.prepared import prep
    except ImportError as error:
        sys.exit(f"Geometry assembly needs shapely: {error}")

    # Bound geometry memory by dissolving batches of at most 100 pieces per
    # province / typology / exact range into a running accumulator.
    pending = defaultdict(list)
    unions = {}
    category_codes = {name: sorted({f["properties"].get("category_code", "") for f in features if f["properties"].get("category_code")}) for name, features in categories.items()}
    provinces = []
    for feature in province_features:
        geom = shape(feature["geometry"])
        provinces.append((str(feature["properties"]["province_id"]), geom))

    for job in jobs:
        response = cached_response(job)
        if response is None:
            sys.exit(f"Missing response checkpoint {job['key']}. Rerun with --execute --resume.")
        for feature in response.get("features", []):
            props = feature.get("properties", {})
            try:
                range_seconds = int(props["value"])
                group_index = int(props.get("group_index", 0))
                geometry = shape(feature["geometry"])
            except (KeyError, TypeError, ValueError):
                continue
            if range_seconds not in RANGES or group_index >= len(job["ids"]):
                continue
            for province_id, province in provinces:
                if not geometry.intersects(province):
                    continue
                clipped = geometry.intersection(province)
                if not clipped.is_empty and clipped.area > 1e-12:
                    key = (province_id, job["category"], range_seconds)
                    pending[key].append(clipped)
                    if len(pending[key]) >= 100:
                        block = unary_union(pending.pop(key))
                        unions[key] = unary_union([unions[key], block]) if key in unions else block

    # Write gzip province chunks, keeping individual Pages assets below 25 MiB.
    access_dir = DATA / "access"
    access_dir.mkdir(parents=True, exist_ok=True)
    by_province = defaultdict(list)
    for key, pieces in pending.items():
        block = unary_union(pieces)
        unions[key] = unary_union([unions[key], block]) if key in unions else block
    for key, union in unions.items():
        province_id, category, seconds = key
        by_province[province_id].append({
            "type": "Feature", "geometry": mapping(union),
            "properties": {"province_id": province_id, "category": category,
                           "category_codes": category_codes.get(category, []), "range_seconds": seconds},
        })

    manifest = {"version": 1, "range_seconds": RANGES, "coverage_minutes": [10, 20, 30, 60], "provinces": {}}
    for province_id, _ in provinces:
        feature_collection = {"type": "FeatureCollection", "features": by_province.get(province_id, [])}
        payload = json.dumps(feature_collection, ensure_ascii=False, separators=(",", ":")).encode()
        chunks_for_province = []
        if len(payload) < 24_000_000:
            filename = f"province-{province_id}.geojson.gz"
            with gzip.open(access_dir / filename, "wb", compresslevel=8) as stream:
                stream.write(payload)
            chunks_for_province.append(filename)
        else:
            for category in sorted(categories):
                subset = [f for f in feature_collection["features"] if f["properties"]["category"] == category]
                if not subset:
                    continue
                filename = f"province-{province_id}-{digest(category)}.geojson.gz"
                with gzip.open(access_dir / filename, "wt", encoding="utf-8", compresslevel=8) as stream:
                    json.dump({"type": "FeatureCollection", "features": subset}, stream, ensure_ascii=False, separators=(",", ":"))
                chunks_for_province.append(filename)
        manifest["provinces"][province_id] = chunks_for_province
    (access_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    prepared_unions = {key: prep(geometry) for key, geometry in unions.items()}
    coverage = []
    for settlement in settlements:
        geom = shape(settlement["geometry"])
        if geom.geom_type == "MultiPoint" and len(geom.geoms) == 1:
            point = geom.geoms[0]
        elif geom.geom_type == "Point":
            point = geom
        else:
            point = geom.centroid
        province_id = str(settlement["properties"].get("province_id", ""))
        reachable = {minutes: [] for minutes in ("10", "20", "30", "60")}
        for (pid, category, seconds), prepared in prepared_unions.items():
            if pid == province_id and seconds in COVERAGE_RANGES and prepared.covers(point):
                reachable[COVERAGE_RANGES[seconds]].append(category)
        coverage.append({"settlement_id": settlement["properties"].get("settlement_id"), "province_id": province_id, "reachable": reachable})
    coverage_dir = DATA / "access"
    (coverage_dir / "settlement-coverage.json").write_text(json.dumps(coverage, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {sum(map(len, by_province.values())):,} typology/province/range features and {len(coverage):,} settlement coverage rows")


if __name__ == "__main__":
    main()
