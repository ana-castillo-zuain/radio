"""Generate driving isochrones from the prepared REFES dataset using public ORS.

The default command is a no-network plan. Use --execute explicitly to consume
ORS quota. Results are checkpointed after each request and can be resumed.
"""
from __future__ import annotations

import argparse
import http.client
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
CACHE = ROOT / ".isochrone-cache"
RANGES = [300, 900, 1800, 3600]
COVERAGE_RANGES = {300: "5", 900: "15", 1800: "30", 3600: "60"}
MAX_LOCATIONS = 5
DEFAULT_CONCURRENCY = 12
ENDPOINT = "https://api.heigit.org/openrouteservice/v2/isochrones/driving-car"


class DailyRequestLimit(RuntimeError):
    pass


class ORSRequestError(RuntimeError):
    def __init__(self, status: int, code: int | None, details: str):
        super().__init__(f"ORS HTTP {status}: {details}")
        self.status = status
        self.code = code
        self.details = details


class FailureReporter:
    def __init__(self, path: Path, preserve: bool):
        self.path = path
        self.lock = threading.Lock()
        if preserve:
            try:
                self.failures = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                self.failures = []
            if not isinstance(self.failures, list):
                self.failures = []
        else:
            self.failures = []
            self._write()

    def _write(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(self.failures, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(self.path)

    def contains(self, facility_id: str) -> bool:
        with self.lock:
            return any(str(item.get("facility_id")) == facility_id for item in self.failures)

    def add(self, failure: dict):
        with self.lock:
            facility_id = str(failure["facility_id"])
            if any(str(item.get("facility_id")) == facility_id for item in self.failures):
                return
            self.failures.append(failure)
            self._write()


class RequestPacer:
    """Serialize request starts and reserve quota before each network attempt."""
    def __init__(self, state_path: Path, delay: float, daily_limit: int, run_limit: int | None):
        self.state_path = state_path
        self.delay = max(0.0, delay)
        self.daily_limit = daily_limit
        self.run_limit = run_limit
        self.lock = threading.Lock()
        self.next_start = 0.0
        self.run_requests = 0
        try:
            self.state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            self.state = {}
        self.counts = self.state.get("requests_by_date", {})
        if not isinstance(self.counts, dict):
            self.counts = {}
        legacy_date = self.state.get("date")
        if legacy_date and legacy_date not in self.counts:
            self.counts[legacy_date] = int(self.state.get("successful_calls", 0))

    def reserve(self):
        with self.lock:
            wait = self.next_start - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            today = datetime.now(timezone.utc).date().isoformat()
            used_today = int(self.counts.get(today, 0))
            if used_today >= self.daily_limit:
                raise DailyRequestLimit(f"UTC daily cap reached ({used_today}/{self.daily_limit}); resume after the UTC date changes.")
            if self.run_limit is not None and self.run_requests >= self.run_limit:
                raise DailyRequestLimit(f"Request cap reached ({self.run_requests}); run again with --resume to continue.")
            # Reserve before sending: a crash or failed response must not make
            # the local counter underestimate requests that may count at ORS.
            self.counts[today] = used_today + 1
            self.run_requests += 1
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = self.state_path.with_suffix(".tmp")
            temp_path.write_text(json.dumps({"requests_by_date": self.counts}), encoding="utf-8")
            temp_path.replace(self.state_path)
            self.next_start = time.monotonic() + self.delay


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


def post(job, api_key, pacer):
    body = {"locations": job["locations"], "range_type": "time", "range": RANGES, "location_type": "destination"}
    request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": api_key, "Content-Type": "application/json",
    })
    rate_limit_attempts = 0
    server_error_attempts = 0
    transport_attempts = 0
    isochrone_error_retried = False
    for attempt in range(9):
        try:
            pacer.reserve()
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", "replace")[:1200]
            lowered = details.casefold()
            if error.code == 429 and any(word in lowered for word in ("quota", "daily limit", "limit exceeded")):
                raise ORSRequestError(error.code, None, f"quota reached; saved checkpoints remain resumable: {details}") from error
            if error.code == 429 and rate_limit_attempts < 5:
                rate_limit_attempts += 1
                delay = int(error.headers.get("Retry-After", min(60 * rate_limit_attempts, 300)))
                print(f"Rate limited; waiting {delay}s", flush=True)
                time.sleep(delay)
                continue
            try:
                code = json.loads(details).get("error", {}).get("code")
            except (json.JSONDecodeError, AttributeError):
                code = None
            if code == 3099 and not isochrone_error_retried:
                isochrone_error_retried = True
                print(f"ORS returned isochrone error 3099 for batch {job['key']}; retrying once in 5s", flush=True)
                time.sleep(5)
                continue
            if error.code in (500, 502, 503, 504) and code != 3099 and server_error_attempts < 2:
                delay = 5 * (2 ** server_error_attempts)
                server_error_attempts += 1
                print(f"ORS HTTP {error.code} for batch {job['key']}; retrying in {delay}s", flush=True)
                time.sleep(delay)
                continue
            raise ORSRequestError(error.code, code, details) from error
        except (http.client.HTTPException, TimeoutError, urllib.error.URLError) as error:
            transport_attempts += 1
            if transport_attempts >= 3:
                raise RuntimeError(
                    f"ORS transport failed for batch {job['key']} after {transport_attempts} attempts: {error}"
                ) from error
            delay = 5 * (2 ** (transport_attempts - 1))
            print(
                f"ORS transport error for batch {job['key']} ({error}); retrying in {delay}s "
                f"({transport_attempts + 1}/3)",
                flush=True,
            )
            time.sleep(delay)
    raise RuntimeError(f"ORS retries exhausted for batch {job['key']}")


def job_key(category, ids, locations):
    return digest({"category": category, "ids": ids, "locations": locations, "ranges": RANGES})


def child_job(job, start, end):
    child = {
        "category": job["category"],
        "ids": job["ids"][start:end],
        "locations": job["locations"][start:end],
    }
    child["key"] = job_key(child["category"], child["ids"], child["locations"])
    return child


def solve_job(job, api_key, pacer, reporter, allow_cached):
    if allow_cached:
        saved = cached_response(job)
        if saved is not None:
            return saved
    if len(job["ids"]) == 1 and reporter.contains(str(job["ids"][0])):
        return {"type": "FeatureCollection", "features": []}
    try:
        return post(job, api_key, pacer)
    except ORSRequestError as error:
        if error.code != 3099:
            raise
        if len(job["ids"]) == 1:
            reporter.add({
                "facility_id": str(job["ids"][0]),
                "category": job["category"],
                "coordinates": job["locations"][0],
                "ors_code": error.code,
                "message": error.details,
            })
            print(f"Skipping facility {job['ids'][0]} after isolated ORS 3099; recorded in failure report", flush=True)
            return {"type": "FeatureCollection", "features": []}

        midpoint = len(job["ids"]) // 2
        left_job = child_job(job, 0, midpoint)
        right_job = child_job(job, midpoint, len(job["ids"]))
        print(f"Isolating ORS 3099 in batch {job['key']} by splitting {len(job['ids'])} locations", flush=True)
        left = solve_job(left_job, api_key, pacer, reporter, allow_cached)
        save_response(left_job, left)
        right = solve_job(right_job, api_key, pacer, reporter, allow_cached)
        save_response(right_job, right)
        combined = dict(left)
        combined["features"] = []
        for offset, response in ((0, left), (midpoint, right)):
            for feature in response.get("features", []):
                item = dict(feature)
                properties = dict(item.get("properties", {}))
                try:
                    properties["group_index"] = int(properties.get("group_index", 0)) + offset
                except (TypeError, ValueError):
                    properties["group_index"] = offset
                item["properties"] = properties
                combined["features"].append(item)
        return combined


def cached_response(job):
    path = CACHE / "responses" / f"{job['key']}.json.gz"
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def save_response(job, value):
    path = CACHE / "responses" / f"{job['key']}.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    with gzip.open(temp_path, "wt", encoding="utf-8") as stream:
        json.dump(value, stream, separators=(",", ":"))
    temp_path.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", action="store_true", help="show request count and estimated quota use (default)")
    parser.add_argument("--execute", action="store_true", help="send ORS requests; requires ORS_API_KEY")
    parser.add_argument("--max-requests", type=int, help="cap new requests for a pilot; cached requests do not count")
    parser.add_argument("--delay", type=float, default=1.8, help="minimum seconds between all request starts (default about 33/minute)")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="maximum simultaneous API requests (default 12)")
    parser.add_argument("--daily-limit", type=int, default=500, help="maximum API attempts in this UTC day (default 500)")
    parser.add_argument("--resume", action="store_true", help="reuse completed response checkpoints")
    parser.add_argument("--assemble-only", action="store_true", help="assemble cached responses without calling ORS")
    parser.add_argument("--assemble-partial", action="store_true", help="assemble available checkpoints without calling ORS; skip unfinished batches")
    args = parser.parse_args()
    if args.assemble_only and args.assemble_partial:
        parser.error("choose either --assemble-only or --assemble-partial")
    if args.execute and (args.assemble_only or args.assemble_partial):
        parser.error("--execute cannot be combined with cached assembly options")
    if not (DATA / "facilities.geojson").exists():
        sys.exit("Prepared data missing. Run npm run prepare-data first.")
    _, settlements, province_features, categories = load_work()
    jobs = list(jobs_for(categories))
    cached = sum(1 for job in jobs if cached_response(job)) if args.resume or args.assemble_only or args.assemble_partial else 0
    remaining = len(jobs) - cached
    print(f"Facilities: {sum(map(len, categories.values())):,}; typologies: {len(categories)}")
    print(f"Batch size: {MAX_LOCATIONS}; exact contours: {len(RANGES)}; planned calls: {len(jobs):,}")
    print(f"Completed checkpoints found: {cached:,}; calls remaining: {remaining:,}")
    if not args.execute and not args.assemble_only and not args.assemble_partial:
        print("No requests sent. Review ORS account quota, set ORS_API_KEY in this shell, then pass --execute --resume.")
        return

    if args.assemble_only or args.assemble_partial:
        reporter = FailureReporter(CACHE / "failed-locations.json", preserve=True)
    else:
        api_key = os.environ.get("ORS_API_KEY")
        if not api_key:
            sys.exit("ORS_API_KEY is not set in the current shell. Do not paste it into chat or commit it.")
        if args.concurrency < 1:
            sys.exit("--concurrency must be at least 1")
        reporter = FailureReporter(CACHE / "failed-locations.json", preserve=args.resume)
        state_path = CACHE / "quota-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        pacer = RequestPacer(state_path, args.delay, args.daily_limit, args.max_requests)
        today = datetime.now(timezone.utc).date().isoformat()
        used_today = int(pacer.counts.get(today, 0))
        if used_today >= args.daily_limit:
            sys.exit(f"Local daily cap reached ({used_today}/{args.daily_limit} requests UTC). Resume tomorrow.")
        pending_jobs = [job for job in jobs if not (args.resume and cached_response(job) is not None)]
        completed = 0
        failure = None
        job_iter = iter(pending_jobs)
        with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            active = {}
            for _ in range(args.concurrency):
                try:
                    job = next(job_iter)
                except StopIteration:
                    break
                active[executor.submit(solve_job, job, api_key, pacer, reporter, args.resume)] = job
            paused = False
            while active:
                future = next(as_completed(active))
                job = active.pop(future)
                try:
                    response = future.result()
                except DailyRequestLimit as error:
                    print(str(error), flush=True)
                    paused = True
                except Exception as error:
                    failure = error
                    print(f"Stopping new requests after error: {error}", flush=True)
                    paused = True
                if not paused:
                    features = response.get("features")
                    if not isinstance(features, list):
                        raise RuntimeError(f"Unexpected ORS payload for checkpoint {job['key']}")
                    save_response(job, response)
                    completed += 1
                    print(f"Saved {completed} / {len(pending_jobs)} new response(s); checkpoint {job['key']}", flush=True)
                    try:
                        next_job = next(job_iter)
                    except StopIteration:
                        continue
                    active[executor.submit(solve_job, next_job, api_key, pacer, reporter, args.resume)] = next_job
                if paused:
                    for future in active:
                        future.cancel()
                    # Already running requests finish and their response checkpoints are retained.
                    for future in as_completed(active):
                        try:
                            response = future.result()
                            job = active[future]
                            if isinstance(response.get("features"), list):
                                save_response(job, response)
                                completed += 1
                        except DailyRequestLimit:
                            pass
                        except Exception as error:
                            print(f"Request failed while stopping: {error}", flush=True)
                    active.clear()
                    break
        if failure is not None:
            raise failure
        if paused:
            return
        print("All API responses checkpointed. Starting geometry assembly.")

    # GIS dependencies are intentionally needed only after ORS responses exist.
    try:
        from shapely.geometry import Point, shape, mapping
        from shapely.ops import unary_union
        from shapely.prepared import prep
        from shapely.strtree import STRtree
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
    province_tree = STRtree([geometry for _, geometry in provinces])

    completed_jobs = 0
    print("Assembling cached contours and clipping them to provinces...", flush=True)
    for job_index, job in enumerate(jobs, start=1):
        response = cached_response(job)
        if response is None:
            if args.assemble_partial:
                if job_index % 500 == 0:
                    print(f"Scanned {job_index:,}/{len(jobs):,} batches; assembled {completed_jobs:,} cached", flush=True)
                continue
            sys.exit(f"Missing response checkpoint {job['key']}. Rerun with --execute --resume.")
        completed_jobs += 1
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
            # Query the spatial index first so each contour is clipped only
            # against provinces whose bounds intersect it.
            for province_index in province_tree.query(geometry):
                province_id, province = provinces[int(province_index)]
                if not geometry.intersects(province):
                    continue
                clipped = geometry.intersection(province)
                if not clipped.is_empty and clipped.area > 1e-12:
                    key = (province_id, job["category"], range_seconds)
                    pending[key].append(clipped)
                    if len(pending[key]) >= 100:
                        block = unary_union(pending.pop(key))
                        # Keep dissolved blocks and perform one final union per
                        # group. Re-unioning the growing accumulator for every
                        # block becomes increasingly expensive on large runs.
                        unions.setdefault(key, []).append(block)
        if job_index % 100 == 0:
            print(f"Assembled {completed_jobs:,} cached batches ({job_index:,}/{len(jobs):,} scanned)", flush=True)

    # Write gzip province chunks, keeping individual Pages assets below 25 MiB.
    access_dir = DATA / "access"
    access_dir.mkdir(parents=True, exist_ok=True)
    by_province = defaultdict(list)
    for key, pieces in pending.items():
        block = unary_union(pieces)
        unions.setdefault(key, []).append(block)
    # Convert cumulative ORS contours into disjoint rings so the four colors
    # remain legible instead of larger translucent polygons covering interiors.
    grouped = defaultdict(dict)
    for (province_id, category, seconds), pieces in unions.items():
        union = unary_union(pieces)
        grouped[(province_id, category)][seconds] = union
    for (province_id, category), ranges in grouped.items():
        inner = None
        for seconds in RANGES:
            cumulative = ranges.get(seconds)
            if cumulative is None:
                continue
            band = cumulative if inner is None else cumulative.difference(inner)
            if not band.is_empty:
                by_province[province_id].append({
                    "type": "Feature", "geometry": mapping(band),
                    "properties": {"province_id": province_id, "category": category,
                                   "category_codes": category_codes.get(category, []), "range_seconds": seconds},
                })
            inner = cumulative

    manifest = {
        "version": 3,
        "range_seconds": RANGES,
        "coverage_minutes": [5, 15, 30, 60],
        "complete": completed_jobs == len(jobs),
        "completed_jobs": completed_jobs,
        "total_jobs": len(jobs),
        "provinces": {},
    }
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

    prepared_by_province = defaultdict(list)
    for (province_id, category, seconds), geometry in unions.items():
        prepared_by_province[province_id].append((category, seconds, prep(geometry)))
    coverage = []
    print("Calculating settlement reachability...", flush=True)
    for settlement_index, settlement in enumerate(settlements, start=1):
        geom = shape(settlement["geometry"])
        if geom.geom_type == "MultiPoint" and len(geom.geoms) == 1:
            point = geom.geoms[0]
        elif geom.geom_type == "Point":
            point = geom
        else:
            point = geom.centroid
        province_id = str(settlement["properties"].get("province_id", ""))
        reachable = {minutes: [] for minutes in ("5", "15", "30", "60")}
        for category, seconds, prepared in prepared_by_province.get(province_id, []):
            if seconds in COVERAGE_RANGES and prepared.covers(point):
                reachable[COVERAGE_RANGES[seconds]].append(category)
        coverage.append({"settlement_id": settlement["properties"].get("settlement_id"), "province_id": province_id, "reachable": reachable})
        if settlement_index % 10000 == 0:
            print(f"Checked {settlement_index:,}/{len(settlements):,} settlements", flush=True)
    coverage_dir = DATA / "access"
    (coverage_dir / "settlement-coverage.json").write_text(json.dumps(coverage, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    omitted_facilities = sorted(reporter.failures, key=lambda item: (str(item.get("category", "")).casefold(), str(item.get("facility_id", ""))))
    generation_report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "omitted_facility_count": len(omitted_facilities),
        "omitted_facilities": omitted_facilities,
    }
    (coverage_dir / "generation-report.json").write_text(
        json.dumps(generation_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {sum(map(len, by_province.values())):,} typology/province/range features and {len(coverage):,} settlement coverage rows")
    print(f"Access coverage status: {completed_jobs:,}/{len(jobs):,} batches ({'complete' if manifest['complete'] else 'partial'})")
    print(f"Omitted facilities recorded: {len(omitted_facilities):,} ({access_dir / 'generation-report.json'})")


if __name__ == "__main__":
    main()
