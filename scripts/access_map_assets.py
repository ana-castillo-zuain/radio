"""Prepare compact overview and province map files from assembled isochrones."""
from __future__ import annotations

import gzip
import json
import os
import sys
from pathlib import Path

from shapely.geometry import mapping, shape


OVERVIEW_TOLERANCE = 0.08
DETAIL_TOLERANCE = 0.001


def _read_collection(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def _write_collection(path: Path, collection):
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(temp_path, "wt", encoding="utf-8", compresslevel=8) as stream:
        json.dump(collection, stream, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp_path, path)


def prepare_access_map(access_dir: Path):
    manifest_path = access_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    categories_by_province = {}
    overview_path = access_dir / "overview.geojson.gz"
    overview_temp = overview_path.with_suffix(overview_path.suffix + ".tmp")
    overview_count = 0

    with gzip.open(overview_temp, "wt", encoding="utf-8", compresslevel=8) as overview:
        overview.write('{"type":"FeatureCollection","features":[')
        first = True
        for province_id, files in manifest.get("provinces", {}).items():
            print(f"Preparing province {province_id}...", flush=True)
            province_categories = {}
            for filename in files:
                path = access_dir / filename
                collection = _read_collection(path)
                detail_features = []
                for feature in collection.get("features", []):
                    props = feature.get("properties", {})
                    category = props.get("category")
                    if category:
                        province_categories.setdefault(category, []).append(filename)
                    try:
                        geom = shape(feature["geometry"])
                        detail_geom = geom.simplify(DETAIL_TOLERANCE, preserve_topology=True)
                        overview_geom = geom.simplify(OVERVIEW_TOLERANCE, preserve_topology=False)
                        if not overview_geom.is_valid:
                            overview_geom = overview_geom.buffer(0)
                    except (KeyError, TypeError, ValueError):
                        continue
                    if not detail_geom.is_empty:
                        detail_feature = dict(feature)
                        detail_feature["geometry"] = mapping(detail_geom)
                        detail_features.append(detail_feature)
                    if not overview_geom.is_empty and overview_geom.geom_type in ("Polygon", "MultiPolygon"):
                        if not first:
                            overview.write(",")
                        overview.write(json.dumps({**feature, "geometry": mapping(overview_geom)}, ensure_ascii=False, separators=(",", ":")))
                        first = False
                        overview_count += 1
                _write_collection(path, {"type": "FeatureCollection", "features": detail_features})
            categories_by_province[province_id] = {
                category: sorted(set(files)) for category, files in province_categories.items()
            }
        overview.write("]}")

    os.replace(overview_temp, overview_path)
    manifest["overview"] = overview_path.name
    manifest["province_categories"] = categories_by_province
    manifest["map_simplification"] = {
        "overview_degrees": OVERVIEW_TOLERANCE,
        "province_degrees": DETAIL_TOLERANCE,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Prepared {overview_count:,} simplified national overview features at {overview_path}", flush=True)


def simplify_existing_overview(path: Path):
    collection = _read_collection(path)
    for feature in collection.get("features", []):
        try:
            geometry = shape(feature["geometry"]).simplify(OVERVIEW_TOLERANCE, preserve_topology=False)
            if not geometry.is_valid:
                geometry = geometry.buffer(0)
            if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            feature["geometry"] = mapping(geometry)
        except (KeyError, TypeError, ValueError):
            continue
    _write_collection(path, collection)
    print(f"Re-simplified {len(collection.get('features', [])):,} overview features at {path}", flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    overview_only = "--overview-only" in args
    args = [arg for arg in args if arg != "--overview-only"]
    target = Path(args[0]) if args else Path(__file__).resolve().parents[1] / "public" / "data" / "access"
    if overview_only:
        simplify_existing_overview(target / "overview.geojson.gz")
    else:
        prepare_access_map(target)
