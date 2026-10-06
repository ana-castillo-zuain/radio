"""Build compact browser datasets from the repository's source files.

Requires pandas, geopandas and pyogrio (already used by the EDA notebook).
The output is deterministic and contains no routing estimates: isochrones need
a routable Argentina road graph and are intentionally generated separately.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
ACTIVE_AGES = {"20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64"}
INDEC_PROVINCES = {
    "CIUDAD AUTONOMA DE BUENOS AIRES": "02",
    "BUENOS AIRES": "06",
    "CATAMARCA": "10",
    "CORDOBA": "14",
    "CORRIENTES": "18",
    "CHACO": "22",
    "CHUBUT": "26",
    "ENTRE RIOS": "30",
    "FORMOSA": "34",
    "JUJUY": "38",
    "LA PAMPA": "42",
    "LA RIOJA": "46",
    "MENDOZA": "50",
    "MISIONES": "54",
    "NEUQUEN": "58",
    "RIO NEGRO": "62",
    "SALTA": "66",
    "SAN JUAN": "70",
    "SAN LUIS": "74",
    "SANTA CRUZ": "78",
    "SANTA FE": "82",
    "SANTIAGO DEL ESTERO": "86",
    "TIERRA DEL FUEGO": "94",
    "TUCUMAN": "90",
}
PROVINCE_LABELS = {
    "CIUDAD AUTONOMA DE BUENOS AIRES": "Ciudad Autónoma de Buenos Aires",
    "BUENOS AIRES": "Buenos Aires", "CATAMARCA": "Catamarca", "CORDOBA": "Córdoba",
    "CORRIENTES": "Corrientes", "CHACO": "Chaco", "CHUBUT": "Chubut",
    "ENTRE RIOS": "Entre Ríos", "FORMOSA": "Formosa", "JUJUY": "Jujuy",
    "LA PAMPA": "La Pampa", "LA RIOJA": "La Rioja", "MENDOZA": "Mendoza",
    "MISIONES": "Misiones", "NEUQUEN": "Neuquén", "RIO NEGRO": "Río Negro",
    "SALTA": "Salta", "SAN JUAN": "San Juan", "SAN LUIS": "San Luis",
    "SANTA CRUZ": "Santa Cruz", "SANTA FE": "Santa Fe",
    "SANTIAGO DEL ESTERO": "Santiago del Estero", "TIERRA DEL FUEGO": "Tierra del Fuego",
    "TUCUMAN": "Tucumán",
}


def text(value: object) -> str:
    if pd.isna(value):
        return ""
    result = str(value).strip()
    # Repair the common UTF-8-as-Windows-1252 mojibake in the supplied
    # population file without changing already-correct Spanish text.
    if "Ã" in result or "Â" in result:
        try:
            result = result.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return result


def key(value: object) -> str:
    result = text(value).upper()
    result = unicodedata.normalize("NFKD", result)
    result = "".join(ch for ch in result if not unicodedata.combining(ch))
    result = re.sub(r"[^A-Z0-9]+", " ", result).strip()
    result = re.sub(r"^(PROVINCIA DE |PROVINCIA DEL )", "", result)
    if result == "CIUDAD AUTONOMA DE BUENOS AIRES":
        return result
    if result in {"CABA", "CAPITAL FEDERAL"}:
        return "CIUDAD AUTONOMA DE BUENOS AIRES"
    return result


def read_csv(name: str) -> pd.DataFrame:
    return pd.read_csv(ROOT / name, encoding="utf-8-sig", encoding_errors="replace", low_memory=False)


def write_json(name: str, value: object) -> None:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def geojson_frame(frame: gpd.GeoDataFrame, properties: list[str]) -> dict:
    features = []
    for row in frame.itertuples(index=False):
        props = {name: getattr(row, name) for name in properties}
        features.append({"type": "Feature", "geometry": mapping(row.geometry), "properties": props})
    return {"type": "FeatureCollection", "features": features}


def finite_coordinate(lon: object, lat: object) -> tuple[float, float] | None:
    try:
        x, y = float(lon), float(lat)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90):
        return None
    if not (-74 <= x <= -52 and -56 <= y <= -20):
        return None
    return x, y


def professional_totals(frame: pd.DataFrame) -> dict:
    frame = frame.copy()
    frame["total"] = pd.to_numeric(frame["total"], errors="coerce").fillna(0)
    frame["province_id"] = pd.to_numeric(frame["id_provincia_residencia"], errors="coerce").astype("Int64")
    frame["active"] = frame["grupo_etareo"].isin(ACTIVE_AGES)
    output: dict[str, dict] = {}
    for province_id in sorted(INDEC_PROVINCES.values()):
        code = str(int(province_id))
        rows = frame[frame["province_id"].astype("string").eq(code)]
        active = rows[rows["active"]]
        all_count = int(rows["total"].sum())
        active_count = int(active["total"].sum())
        origins = {
            text(origin): int(value)
            for origin, value in active.groupby("pais_origen", dropna=False)["total"].sum().items()
        }
        output[province_id] = {
            "habilitados": all_count,
            "activos": active_count,
            "origen_activos": origins,
        }
    return output


def nurse_specialties(frame: pd.DataFrame) -> dict[str, dict[str, int]]:
    frame = frame.copy()
    frame["total"] = pd.to_numeric(frame["total"], errors="coerce").fillna(0)
    frame = frame[frame["grupo_etareo"].isin(ACTIVE_AGES)].copy()
    frame["province_id"] = pd.to_numeric(frame["id_provincia_residencia"], errors="coerce").astype("Int64")
    result: dict[str, dict[str, int]] = {}
    for province_id in sorted(INDEC_PROVINCES.values()):
        code = str(int(province_id))
        rows = frame[frame["province_id"].astype("string").eq(code)]
        counts: dict[str, int] = {}
        for profession, value in rows.groupby("profesion_referencia")["total"].sum().items():
            label = text(profession).casefold()
            if "auxiliar" in label:
                bucket = "Auxiliarato"
            elif "licenciad" in label:
                bucket = "Licenciatura"
            else:
                bucket = "Enfermería profesional"
            counts[bucket] = counts.get(bucket, 0) + int(value)
        result[province_id] = counts
    return result


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    population = read_csv("poblacion_provincias_2022.csv")
    population_by_key: dict[str, int] = {}
    reported_population_total: int | None = None
    for _, row in population.iterrows():
        province_name = text(row["Provincia"])
        province_key = key(province_name)
        digits = re.sub(r"\D", "", text(row["Poblacion_Censo_2022"]))
        if province_key in {"TOTAL DEL PAIS", "TOTAL PAIS", "ARGENTINA"}:
            if digits:
                reported_population_total = int(digits)
            continue
        if digits:
            population_by_key[province_key] = int(digits)

    refes = read_csv("refes-2023-updated.csv")
    nurses = read_csv("enfermeria-2023.csv")
    doctors = read_csv("medicos-2023.csv")
    doctors_by_province = professional_totals(doctors)
    nurses_by_province = professional_totals(nurses)
    specialties_by_province = nurse_specialties(nurses)

    bahra_path = ROOT / "base_total.geojson" / "base_total.geojson"
    bahra = gpd.read_file(bahra_path)
    if bahra.crs is None:
        raise ValueError("BAHRA GeoJSON has no CRS; refusing to guess coordinates")
    bahra = bahra.to_crs("EPSG:4326")
    if bahra.geometry.geom_type.eq("Point").all():
        bahra_latitudes = bahra.geometry.y
    else:
        bahra_latitudes = bahra.geometry.to_crs("EPSG:6933").centroid.to_crs("EPSG:4326").y
    bahra = bahra.loc[bahra_latitudes >= -60].copy()
    settlement_counts = bahra.groupby("cod_pcia").size().to_dict()

    province_metrics: dict[str, dict] = {}
    for name_key, province_id in INDEC_PROVINCES.items():
        population_key = name_key
        if population_key not in population_by_key:
            raise ValueError(f"Population row missing for INDEC province {name_key}")
        doctors_data = doctors_by_province[province_id]
        nurses_data = nurses_by_province[province_id]
        doctor_active = doctors_data["activos"]
        nurse_active = nurses_data["activos"]
        province_metrics[province_id] = {
            "province_id": province_id,
            "name": PROVINCE_LABELS[name_key],
            "population_2022": population_by_key[population_key],
            "settlement_count": int(settlement_counts.get(province_id, settlement_counts.get(int(province_id), 0))),
            "refes_total": int((pd.to_numeric(refes["provincia_id"], errors="coerce").astype("Int64") == int(province_id)).sum()),
            "doctors": doctors_data,
            "nurses": nurses_data,
            "nurse_specialties_active": specialties_by_province[province_id],
            "doctors_per_1000": round(doctor_active / population_by_key[population_key] * 1000, 3),
            "nurses_per_1000": round(nurse_active / population_by_key[population_key] * 1000, 3),
            "nurses_per_doctor": round(nurse_active / doctor_active, 3) if doctor_active else None,
        }

    categories = []
    for name, rows in refes.groupby("tipologia_nombre", dropna=False):
        categories.append({
            "name": text(name) or "Sin tipología informada",
            "count": int(len(rows)),
            "codes": sorted({text(value) for value in rows["tipologia_sigla"].dropna()}),
        })
    categories.sort(key=lambda row: row["name"].casefold())

    facilities = []
    status_counts = {"valid_argentina_bounds": 0, "recovered_from_healthsites": 0, "missing_or_non_numeric": 0}
    for row in refes.itertuples(index=False):
        status = text(row.coordinate_status)
        status_counts[status] = status_counts.get(status, 0) + 1
        coordinate = finite_coordinate(row.longitud, row.latitud)
        if coordinate is None:
            continue
        lon, lat = coordinate
        province_id = str(int(float(row.provincia_id))).zfill(2)
        facilities.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "id": text(row.establecimiento_id),
                "name": text(row.establecimiento_nombre),
                "locality": text(row.localidad_nombre),
                "province": text(row.provincia_nombre),
                "province_id": province_id,
                "category": text(row.tipologia_nombre) or "Sin tipología informada",
                "category_code": text(row.tipologia_sigla),
                "coordinate_status": status,
            },
        })
    write_json("facilities.geojson", {"type": "FeatureCollection", "features": facilities})

    bahra["province_id"] = bahra["cod_pcia"].map(lambda value: text(value).zfill(2))
    bahra["province"] = bahra["nom_pcia"].map(text)
    bahra["settlement_name"] = bahra["nombre"].map(text)
    bahra["settlement_type"] = bahra["tipo"].map(text)
    settlements = []
    for row in bahra.itertuples(index=False):
        if row.geometry is None or row.geometry.is_empty:
            continue
        settlements.append({
            "type": "Feature",
            "geometry": mapping(row.geometry),
            "properties": {
                "settlement_id": text(getattr(row, "id", "")),
                "province_id": row.province_id,
                "province": row.province,
                "name": row.settlement_name,
                "settlement_type": row.settlement_type,
            },
        })
    write_json("settlements.geojson", {"type": "FeatureCollection", "features": settlements})

    radios = gpd.read_file(ROOT / "radios_censales2" / "radios_censales2.shp")
    if radios.crs is None:
        raise ValueError("Census radio shapefile has no CRS")
    radios = radios.to_crs("EPSG:4326")
    radios = radios[["jur", "geometry"]].dissolve(by="jur", as_index=False)
    radios["geometry"] = radios.geometry.simplify(0.005, preserve_topology=True)
    radios["province"] = radios["jur"].map(text)
    radios["province_id"] = radios["jur"].map(lambda value: INDEC_PROVINCES.get(key(value), ""))
    province_features = []
    for row in radios.itertuples(index=False):
        province_features.append({
            "type": "Feature",
            "geometry": mapping(row.geometry),
            "properties": {"province": row.province, "province_id": row.province_id},
        })
    write_json("provinces.geojson", {"type": "FeatureCollection", "features": province_features})

    # Isochrones are a separately generated, quota-consuming product. Never
    # overwrite them when rebuilding the source datasets.
    global_doctors = sum(row["doctors"]["activos"] for row in province_metrics.values())
    global_nurses = sum(row["nurses"]["activos"] for row in province_metrics.values())
    write_json("metrics.json", {
        "source_years": {"refes": 2026, "professionals": 2023, "population": 2022},
        "definitions": {
            "active_professionals": "REFePS habilitados de 20 a 64 años inclusive, según grupos etarios publicados.",
            "nurse_doctor_ratio": "Enfermeros activos divididos por médicos activos.",
            "accessibility": "Áreas de isócrona por red vial; aún no calculadas.",
        },
        "facility_counts": {**status_counts, "total": len(refes), "mapped": len(facilities)},
        "facility_categories": categories,
        "professionals": {
            "doctors_active": global_doctors,
            "nurses_active": global_nurses,
            "doctors": doctors_by_province,
            "nurses": nurses_by_province,
            "nurse_specialties_active": specialties_by_province,
            "doctors_per_1000": round(global_doctors / sum(v["population_2022"] for v in province_metrics.values()) * 1000, 3),
            "nurses_per_1000": round(global_nurses / sum(v["population_2022"] for v in province_metrics.values()) * 1000, 3),
            "nurses_per_doctor": round(global_nurses / global_doctors, 3),
        },
        "provinces": province_metrics,
        "settlement_count": len(settlements),
        "population_audit": {
            "sum_of_provinces": sum(population_by_key.values()),
            "reported_country_total": reported_population_total,
            "difference": reported_population_total - sum(population_by_key.values()) if reported_population_total is not None else None,
        },
    })
    print(f"Wrote {len(facilities):,} mapped facilities; {len(settlements):,} settlements; {len(province_features)} provinces")


if __name__ == "__main__":
    main()
