"""Validate the checked-in browser datasets and access coverage."""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "public" / "data"
EXPECTED_PROVINCE_IDS = {
    "02", "06", "10", "14", "18", "22", "26", "30", "34", "38", "42", "46",
    "50", "54", "58", "62", "66", "70", "74", "78", "82", "86", "90", "94",
}


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Cannot read {path.relative_to(DATA)}: {error}") from error


def main() -> int:
    metrics = read_json(DATA / "metrics.json")
    province_features = read_json(DATA / "provinces.geojson").get("features", [])
    facilities = read_json(DATA / "facilities.geojson").get("features", [])
    coverage = read_json(DATA / "access" / "settlement-coverage.json")

    province_ids = [str(feature.get("properties", {}).get("province_id", "")) for feature in province_features]
    if any(not province_id for province_id in province_ids):
        raise ValueError("Every province polygon must have a province_id")
    if set(province_ids) != EXPECTED_PROVINCE_IDS:
        raise ValueError(f"Expected all 24 province IDs; got {sorted(set(province_ids))}")

    facility_counts = Counter(str(feature.get("properties", {}).get("province_id", "")) for feature in facilities)
    if "" in facility_counts or not set(facility_counts).issubset(EXPECTED_PROVINCE_IDS):
        raise ValueError("Every mapped facility must have a recognized province_id")
    if sum(facility_counts.values()) != len(facilities) or len(facilities) != metrics["facility_counts"]["mapped"]:
        raise ValueError("Facility counts by province do not match facility_counts.mapped")
    source_total = sum(int(metrics["provinces"][province_id]["refes_total"]) for province_id in EXPECTED_PROVINCE_IDS)
    if source_total != int(metrics["facility_counts"]["total"]):
        raise ValueError("Province source facility counts do not match facility_counts.total")

    reached = Counter(
        str(row.get("province_id", ""))
        for row in coverage
        if row.get("reachable", {}).get("60")
    )
    empty = sorted(province_id for province_id in EXPECTED_PROVINCE_IDS if not reached[province_id])
    if empty:
        raise ValueError(f"No settlements are reached within 60 minutes in provinces: {', '.join(empty)}")

    if not coverage or len(coverage) != metrics["settlement_count"]:
        raise ValueError("Settlement coverage row count does not match metrics.settlement_count")

    training_residence = metrics["professionals"]["training_residence"]
    for profession in ("doctors", "nurses"):
        dataset = training_residence[profession]
        matrix = dataset["residence_by_training"]
        if set(matrix) != EXPECTED_PROVINCE_IDS:
            raise ValueError(f"{profession} training/residence matrix must contain all 24 residence provinces")
        matrix_total = 0
        for residence_id, row in matrix.items():
            if set(row) != EXPECTED_PROVINCE_IDS:
                raise ValueError(f"{profession} training/residence row {residence_id} must contain all 24 formation provinces")
            matrix_total += sum(int(value) for value in row.values())
        if matrix_total != int(dataset["domestic_pairs"]):
            raise ValueError(f"{profession} matrix counts do not match domestic_pairs")
        if matrix_total > int(dataset["active_total"]):
            raise ValueError(f"{profession} domestic pairs exceed its active-professional total")
    print(f"Validated {len(province_ids)} province polygons, {len(facilities)} facilities, and {len(coverage)} settlements.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyError, TypeError, ValueError) as error:
        print(f"Data validation failed: {error}", file=sys.stderr)
        sys.exit(1)
