#!/usr/bin/env python3
"""Generate STGY level-1/level-2 static geocoding NDJSON from N03 boundaries."""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    import geopandas as gpd
    import numpy as np
    import pandas as pd
    import shapely
    from pyproj import CRS, Transformer
    from scipy.spatial import cKDTree
    from shapely.geometry import MultiPolygon, Point, Polygon
except ImportError as exc:  # pragma: no cover - command-line dependency check
    raise SystemExit(
        "generate-geo-static.py requires geopandas, numpy, pandas, shapely, pyproj and scipy"
    ) from exc

PROJECTED_CRS = CRS.from_proj4(
    "+proj=aea +lat_1=30 +lat_2=46 +lat_0=36 +lon_0=138 +datum=WGS84 +units=m +no_defs"
)
GEOGRAPHIC_CRS = CRS.from_epsg(4326)


@dataclass(frozen=True)
class Place:
    id: int
    level: int
    prefecture: str
    municipality: str | None
    longitude: float
    latitude: float
    geometry: Polygon | MultiPolygon
    projected_geometry: Polygon | MultiPolygon
    projected_point: Point

    @property
    def elements(self) -> list[str]:
        return [self.prefecture] if self.municipality is None else [self.prefecture, self.municipality]

    @property
    def label(self) -> str:
        return "".join(self.elements)


@dataclass(frozen=True)
class Alias:
    longitude: float
    latitude: float
    belong_to: int
    x: float
    y: float
    source: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        action="append",
        required=True,
        help="N03 ZIP, GeoJSON, GML or Shapefile path/URL; repeat for multiple files",
    )
    parser.add_argument("--output", required=True, help="output NDJSON path")
    parser.add_argument("--grid-km", type=float, default=5.0)
    parser.add_argument("--component-area-km2", type=float, default=0.25)
    parser.add_argument("--validation-grid-km", type=float, default=1.0)
    parser.add_argument("--skip-validation", action="store_true")
    return parser.parse_args()


def load_sources(sources: list[str]) -> gpd.GeoDataFrame:
    frames: list[gpd.GeoDataFrame] = []
    with tempfile.TemporaryDirectory(prefix="stgy-geo-") as temp_dir:
        temp = Path(temp_dir)
        for index, source in enumerate(sources):
            path = materialize_source(source, temp, index)
            if path.suffix.lower() == ".zip":
                target = temp / str(index)
                target.mkdir()
                with zipfile.ZipFile(path) as archive:
                    members = select_vector_members(archive)
                    if not members:
                        raise ValueError(f"no supported vector file in {path}")
                    for member in members:
                        archive.extract(member, target)
                frames.append(gpd.read_file(target / members[0]))
            else:
                frames.append(gpd.read_file(path))

    if not frames:
        raise ValueError("no input data")
    frame = gpd.GeoDataFrame(
        pd.concat(frames, ignore_index=True), geometry="geometry", crs=frames[0].crs
    )
    if frame.crs is None:
        raise ValueError("input data has no CRS")
    frame = frame.to_crs(GEOGRAPHIC_CRS)
    required = {"N03_001", "N03_004", "N03_007"}
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise ValueError(f"missing N03 columns: {', '.join(missing)}")
    if "N03_003" not in frame.columns:
        frame["N03_003"] = None
    if "N03_005" not in frame.columns:
        frame["N03_005"] = None
    return frame



def materialize_source(source: str, temp: Path, index: int) -> Path:
    parsed = urllib.parse.urlparse(source)
    if parsed.scheme not in {"http", "https"}:
        path = Path(source).expanduser().resolve()
        if not path.is_file():
            raise ValueError(f"input file not found: {path}")
        return path

    filename = Path(parsed.path).name or f"source-{index}.zip"
    target = temp / f"download-{index}-{filename}"
    request = urllib.request.Request(source, headers={"User-Agent": "STGY geo data generator"})
    print(f"downloading {source}", file=sys.stderr)
    with urllib.request.urlopen(request) as response, target.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    return target

def select_vector_members(archive: zipfile.ZipFile) -> list[str]:
    names = [name for name in archive.namelist() if not name.endswith("/")]
    candidates = [
        name
        for name in names
        if "N03" in Path(name).name.upper()
        and Path(name).suffix.lower() in {".geojson", ".json", ".shp", ".gml"}
    ]
    priority = {".geojson": 0, ".json": 1, ".shp": 2, ".gml": 3}
    candidates.sort(
        key=lambda name: (
            priority.get(Path(name).suffix.lower(), 9),
            -archive.getinfo(name).file_size,
        )
    )
    if not candidates:
        return []
    selected = candidates[0]
    if Path(selected).suffix.lower() != ".shp":
        return [selected]
    stem = str(Path(selected).with_suffix(""))
    sidecars = [name for name in names if str(Path(name).with_suffix("")) == stem]
    sidecars.sort(key=lambda name: name != selected)
    return sidecars


def clean_text(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def parse_municipality_code(code_value: object) -> int | None:
    if code_value is None or pd.isna(code_value):
        return None
    code = str(code_value).strip()
    if code.endswith(".0"):
        code = code[:-2]
    if not code.isdigit() or len(code) > 5:
        return None
    value = int(code.zfill(5))
    if value <= 47 or value > 65535:
        return None
    return value


def resolve_municipality_code(codes: Iterable[int], has_wards: bool) -> int:
    unique_codes = sorted(set(codes))
    if not unique_codes:
        raise ValueError("municipality has no valid code")
    if has_wards:
        # N03_007 contains designated-city ward codes on ward rows.  The
        # parent city code is the lower multiple of ten that contains the
        # first ward code.  Using the minimum is important for cities such as
        # Yokohama, whose ward codes span 14101 through 14118, while Kawasaki
        # starts at 14131 and belongs to city code 14130.
        return (unique_codes[0] // 10) * 10
    if len(unique_codes) != 1:
        formatted = ", ".join(f"{code:05d}" for code in unique_codes)
        raise ValueError(f"municipality has conflicting codes: [{formatted}]")
    return unique_codes[0]


def make_places(frame: gpd.GeoDataFrame) -> tuple[list[Place], list[Place]]:
    records: list[tuple[str, str, str, int, bool, object]] = []
    for row in frame.itertuples(index=False):
        prefecture = clean_text(getattr(row, "N03_001", ""))
        district = clean_text(getattr(row, "N03_003", ""))
        municipality = clean_text(getattr(row, "N03_004", ""))
        ward = clean_text(getattr(row, "N03_005", ""))
        code = parse_municipality_code(getattr(row, "N03_007", None))
        geometry = getattr(row, "geometry")
        if not prefecture or not municipality or code is None or geometry is None or geometry.is_empty:
            continue
        records.append((prefecture, district, municipality, code, bool(ward), geometry))

    grouped: dict[tuple[str, str, str], list[tuple[int, bool, object]]] = defaultdict(list)
    for prefecture, district, municipality, code, has_ward, geometry in records:
        grouped[(prefecture, district, municipality)].append((code, has_ward, geometry))

    to_projected = Transformer.from_crs(GEOGRAPHIC_CRS, PROJECTED_CRS, always_xy=True)
    to_geographic = Transformer.from_crs(PROJECTED_CRS, GEOGRAPHIC_CRS, always_xy=True)

    level2: list[Place] = []
    prepared_groups: list[tuple[int, str, str, list[object]]] = []
    for (prefecture, district, municipality), entries in grouped.items():
        code = resolve_municipality_code(
            (entry[0] for entry in entries), any(entry[1] for entry in entries)
        )
        municipality_element = f"{district}{municipality}"
        prepared_groups.append(
            (code, prefecture, municipality_element, [entry[2] for entry in entries])
        )

    for code, prefecture, municipality, geometries in sorted(prepared_groups):
        geometry = shapely.make_valid(shapely.union_all(geometries))
        geometry = polygonal_only(geometry)
        if geometry is None or geometry.is_empty:
            continue
        projected = shapely.transform(geometry, to_projected.transform, interleaved=False)
        point = largest_component(projected).representative_point()
        longitude, latitude = to_geographic.transform(point.x, point.y)
        level2.append(
            Place(
                id=code,
                level=2,
                prefecture=prefecture,
                municipality=municipality,
                longitude=longitude,
                latitude=latitude,
                geometry=geometry,
                projected_geometry=projected,
                projected_point=point,
            )
        )

    if not level2:
        raise ValueError("no level-2 records generated")
    labels_by_id: dict[int, str] = {}
    for place in level2:
        previous = labels_by_id.get(place.id)
        if previous is not None and previous != place.label:
            raise ValueError(
                f"municipality id collision: {place.id:05d}: {previous} / {place.label}"
            )
        labels_by_id[place.id] = place.label

    by_prefecture: dict[str, list[Place]] = defaultdict(list)
    for place in level2:
        by_prefecture[place.prefecture].append(place)

    level1: list[Place] = []
    for prefecture, municipalities in sorted(by_prefecture.items(), key=lambda item: min(p.id for p in item[1])):
        prefecture_code = min(place.id for place in municipalities) // 1000
        geometry = polygonal_only(shapely.make_valid(shapely.union_all([p.geometry for p in municipalities])))
        projected = polygonal_only(
            shapely.make_valid(shapely.union_all([p.projected_geometry for p in municipalities]))
        )
        if geometry is None or projected is None:
            continue
        point = largest_component(projected).representative_point()
        longitude, latitude = to_geographic.transform(point.x, point.y)
        level1.append(
            Place(
                id=prefecture_code,
                level=1,
                prefecture=prefecture,
                municipality=None,
                longitude=longitude,
                latitude=latitude,
                geometry=geometry,
                projected_geometry=projected,
                projected_point=point,
            )
        )

    return level1, level2


def polygonal_only(geometry: object) -> Polygon | MultiPolygon | None:
    if isinstance(geometry, Polygon):
        return geometry
    if isinstance(geometry, MultiPolygon):
        return geometry
    parts = [part for part in shapely.get_parts(geometry) if isinstance(part, (Polygon, MultiPolygon))]
    if not parts:
        return None
    merged = shapely.union_all(parts)
    return merged if isinstance(merged, (Polygon, MultiPolygon)) else None


def components(geometry: Polygon | MultiPolygon) -> list[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry]
    return list(geometry.geoms)


def largest_component(geometry: Polygon | MultiPolygon) -> Polygon:
    return max(components(geometry), key=lambda part: part.area)


def aligned_values(minimum: float, maximum: float, spacing: float, origin: float) -> np.ndarray:
    start = math.ceil((minimum - origin) / spacing) * spacing + origin
    if start > maximum:
        return np.empty(0, dtype=np.float64)
    return np.arange(start, maximum + spacing * 0.25, spacing, dtype=np.float64)


def make_aliases(level2: list[Place], grid_km: float, component_area_km2: float) -> list[Alias]:
    spacing = grid_km * 1000.0
    area_limit = component_area_km2 * 1_000_000.0
    if spacing <= 0 or area_limit < 0:
        raise ValueError("invalid grid parameters")

    min_x = min(place.projected_geometry.bounds[0] for place in level2)
    min_y = min(place.projected_geometry.bounds[1] for place in level2)
    origin_x = math.floor(min_x / spacing) * spacing
    origin_y = math.floor(min_y / spacing) * spacing
    to_geographic = Transformer.from_crs(PROJECTED_CRS, GEOGRAPHIC_CRS, always_xy=True)

    aliases: list[Alias] = []
    for place in level2:
        minx, miny, maxx, maxy = place.projected_geometry.bounds
        xs = aligned_values(minx, maxx, spacing, origin_x)
        ys = aligned_values(miny, maxy, spacing, origin_y)
        selected_x = np.empty(0, dtype=np.float64)
        selected_y = np.empty(0, dtype=np.float64)
        if len(xs) and len(ys):
            mesh_x, mesh_y = np.meshgrid(xs, ys)
            flat_x = mesh_x.ravel()
            flat_y = mesh_y.ravel()
            points = shapely.points(flat_x, flat_y)
            mask = shapely.contains(place.projected_geometry, points)
            selected_x = flat_x[mask]
            selected_y = flat_y[mask]
            for x, y in zip(selected_x, selected_y, strict=True):
                longitude, latitude = to_geographic.transform(float(x), float(y))
                aliases.append(Alias(longitude, latitude, place.id, float(x), float(y), "grid"))

        sample_points = shapely.points(selected_x, selected_y) if len(selected_x) else np.empty(0)
        for component in components(place.projected_geometry):
            has_sample = component.covers(place.projected_point)
            if not has_sample and len(sample_points):
                has_sample = bool(np.any(shapely.covers(component, sample_points)))
            if has_sample or component.area < area_limit:
                continue
            point = component.representative_point()
            longitude, latitude = to_geographic.transform(point.x, point.y)
            aliases.append(Alias(longitude, latitude, place.id, point.x, point.y, "component"))

    return aliases


def place_record(place: Place) -> dict[str, object]:
    return {
        "id": place.id,
        "level": place.level,
        "country": "JP",
        "longitude": round(place.longitude, 6),
        "latitude": round(place.latitude, 6),
        "addresses": [
            {
                "locale": "ja",
                "label": place.label,
                "elements": place.elements,
            }
        ],
    }


def alias_record(alias: Alias) -> dict[str, object]:
    return {
        "longitude": round(alias.longitude, 6),
        "latitude": round(alias.latitude, 6),
        "belongTo": alias.belong_to,
    }


def write_ndjson(output: Path, level1: list[Place], level2: list[Place], aliases: list[Alias]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(output.suffix + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as stream:
        for place in sorted(level1, key=lambda item: item.id):
            stream.write(json.dumps(place_record(place), ensure_ascii=False, separators=(",", ":")) + "\n")
        for place in sorted(level2, key=lambda item: item.id):
            stream.write(json.dumps(place_record(place), ensure_ascii=False, separators=(",", ":")) + "\n")
        for alias in aliases:
            stream.write(json.dumps(alias_record(alias), ensure_ascii=False, separators=(",", ":")) + "\n")
    temp.replace(output)


def validate(level2: list[Place], aliases: list[Alias], grid_km: float) -> dict[str, object]:
    spacing = grid_km * 1000.0
    candidate_x = [place.projected_point.x for place in level2] + [alias.x for alias in aliases]
    candidate_y = [place.projected_point.y for place in level2] + [alias.y for alias in aliases]
    candidate_ids = np.array([place.id for place in level2] + [alias.belong_to for alias in aliases])
    tree = cKDTree(np.column_stack((candidate_x, candidate_y)))

    totals: dict[int, int] = defaultdict(int)
    correct: dict[int, int] = defaultdict(int)
    max_distance = 0.0
    total = 0
    total_correct = 0

    min_x = min(place.projected_geometry.bounds[0] for place in level2)
    min_y = min(place.projected_geometry.bounds[1] for place in level2)
    origin_x = math.floor(min_x / spacing) * spacing
    origin_y = math.floor(min_y / spacing) * spacing

    for place in level2:
        minx, miny, maxx, maxy = place.projected_geometry.bounds
        xs = aligned_values(minx, maxx, spacing, origin_x)
        ys = aligned_values(miny, maxy, spacing, origin_y)
        if not len(xs) or not len(ys):
            continue
        mesh_x, mesh_y = np.meshgrid(xs, ys)
        flat_x = mesh_x.ravel()
        flat_y = mesh_y.ravel()
        mask = shapely.contains(place.projected_geometry, shapely.points(flat_x, flat_y))
        points = np.column_stack((flat_x[mask], flat_y[mask]))
        if not len(points):
            continue
        distances, indices = tree.query(points, k=1)
        predicted = candidate_ids[indices]
        count = len(points)
        hit = int(np.count_nonzero(predicted == place.id))
        totals[place.id] += count
        correct[place.id] += hit
        total += count
        total_correct += hit
        max_distance = max(max_distance, float(np.max(distances)))

    worst = []
    labels = {place.id: place.label for place in level2}
    for place_id, count in totals.items():
        accuracy = correct[place_id] / count if count else 1.0
        worst.append((accuracy, labels[place_id], count))
    worst.sort()

    return {
        "validationPoints": total,
        "accuracy": total_correct / total if total else None,
        "maxNearestDistanceKm": max_distance / 1000.0,
        "worstMunicipalities": [
            {"label": label, "accuracy": accuracy, "points": count}
            for accuracy, label, count in worst[:10]
        ],
    }


def main() -> int:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()

    frame = load_sources(args.input)
    level1, level2 = make_places(frame)
    aliases = make_aliases(level2, args.grid_km, args.component_area_km2)
    write_ndjson(output, level1, level2, aliases)

    stats: dict[str, object] = {
        "output": str(output),
        "bytes": output.stat().st_size,
        "level1": len(level1),
        "level2": len(level2),
        "aliases": len(aliases),
        "gridAliases": sum(alias.source == "grid" for alias in aliases),
        "componentAliases": sum(alias.source == "component" for alias in aliases),
        "typedArrayBytes": len(aliases) * 10,
        "gridKm": args.grid_km,
        "componentAreaKm2": args.component_area_km2,
    }
    if not args.skip_validation:
        stats["validation"] = validate(level2, aliases, args.validation_grid_km)
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
