#!/usr/bin/env python3
"""Generate STGY country, prefecture, municipality and ward geocoding data."""

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

JAPAN_COUNTRY_ID = 392
JAPAN_COUNTRY_CODE = "JP"
JAPAN_COUNTRY_NAME_JA = "日本"
JAPAN_COUNTRY_NAME_EN = "Japan"
JAPAN_LONGITUDE_ORIGIN = 139.7413574722222
JAPAN_LATITUDE_ORIGIN = 35.65809922222222

ENGLISH_NAME_SUFFIXES = (
    (" Prefecture", "prefecture"),
    (" Metropolis", "metropolis"),
    (" Village", "village"),
    ("-machi", "town"),
    ("-mura", "village"),
    (" City", "city"),
    (" Ward", "ward"),
    (" Town", "town"),
    ("-shi", "city"),
    ("-cho", "town"),
    ("-son", "village"),
    ("-gun", "county"),
    ("-ku", "ward"),
)


def make_address_search_labels(elements: list[str], locale: str) -> set[str]:
    language = locale.split("-", 1)[0].lower()
    labels: set[str] = set()
    for start in range(len(elements)):
        suffix = elements[start:]
        label = (
            "".join(suffix)
            if language == "ja"
            else ", ".join(reversed(suffix))
        )
        labels.add(label.casefold())
    return labels


def exclude_search_labels(
    aliases: Iterable[str], elements: list[str], locale: str
) -> list[str]:
    search_labels = make_address_search_labels(elements, locale)
    return unique_strings(
        alias for alias in aliases if alias.casefold() not in search_labels
    )


@dataclass(frozen=True)
class Place:
    id: int
    level: int
    kind: str
    prefecture: str
    municipality: str | None
    ward: str | None
    longitude: float
    latitude: float
    geometry: Polygon | MultiPolygon
    projected_geometry: Polygon | MultiPolygon
    projected_point: Point

    @property
    def elements(self) -> list[str]:
        if self.kind == "country":
            return [JAPAN_COUNTRY_NAME_JA]
        elements = [JAPAN_COUNTRY_NAME_JA, self.prefecture]
        if self.municipality is not None:
            elements.append(self.municipality)
        if self.ward is not None:
            elements.append(self.ward)
        return elements

    @property
    def label(self) -> str:
        return "".join(self.elements)

    @property
    def aliases(self) -> list[str]:
        if self.kind == "country":
            return []
        if self.kind == "prefecture":
            if self.prefecture == "北海道":
                return []
            if self.prefecture.endswith(("都", "府", "県")):
                return [self.prefecture[:-1]]
            return []

        if self.kind == "designated-city-ward":
            assert self.ward is not None
            aliases: list[str] = []
            if self.ward.endswith("区") and len(self.ward) > 1:
                aliases.append(self.ward[:-1])
            return exclude_search_labels(aliases, self.elements, "ja")

        assert self.municipality is not None
        municipality = self.municipality
        local_name = municipality
        if "郡" in local_name:
            local_name = local_name.rsplit("郡", 1)[1]

        aliases: list[str] = []
        if local_name.endswith(("市", "区", "町", "村")) and len(local_name) > 1:
            aliases.append(local_name[:-1])
        aliases.append(local_name)
        if municipality != local_name:
            aliases.append(municipality)
        return exclude_search_labels(aliases, self.elements, "ja")


@dataclass(frozen=True)
class Alias:
    longitude: float
    latitude: float
    belong_to: int
    x: float
    y: float
    source: str


@dataclass(frozen=True)
class EnglishName:
    code: int
    prefecture_japanese: str
    prefecture_english: str
    county_japanese: str
    county_english: str
    municipality_japanese: str
    municipality_english: str
    ward_japanese: str
    ward_english: str

    @property
    def japanese(self) -> str:
        return f"{self.county_japanese}{self.municipality_japanese}{self.ward_japanese}"


class EnglishAddressIndex:
    def __init__(self, records: Iterable[EnglishName]):
        self.by_code: dict[int, EnglishName] = {}
        self.by_prefecture_and_japanese: dict[tuple[int, str], list[EnglishName]] = (
            defaultdict(list)
        )
        self.prefecture_names: dict[str, str] = {}
        for record in records:
            if record.code in self.by_code:
                raise ValueError(f"duplicate English address code: {record.code:05d}")
            self.by_code[record.code] = record
            self.by_prefecture_and_japanese[(record.code // 1000, record.japanese)].append(
                record
            )
            previous = self.prefecture_names.get(record.prefecture_japanese)
            if previous is not None and previous != record.prefecture_english:
                raise ValueError(
                    f"conflicting English prefecture name: {record.prefecture_japanese}"
                )
            self.prefecture_names[record.prefecture_japanese] = record.prefecture_english

    def prefecture_name(self, japanese: str) -> str | None:
        return self.prefecture_names.get(japanese)

    def find(self, place: Place) -> EnglishName | None:
        japanese_candidates = japanese_name_candidates(place)
        by_code = self.by_code.get(place.id)
        if by_code is not None and by_code.japanese in japanese_candidates:
            return by_code

        matched: dict[int, EnglishName] = {}
        prefecture_code = place.id // 1000
        for japanese in japanese_candidates:
            for record in self.by_prefecture_and_japanese.get(
                (prefecture_code, japanese), []
            ):
                matched[record.code] = record
        if len(matched) == 1:
            return next(iter(matched.values()))
        return None


class EnglishAddressBuilder:
    def __init__(self, index: EnglishAddressIndex | None):
        self.index = index
        self.generated = 0
        self.missing = 0

    def build(self, place: Place) -> dict[str, object] | None:
        if place.kind == "country":
            self.generated += 1
            return {
                "locale": "en",
                "label": JAPAN_COUNTRY_NAME_EN,
                "elements": [JAPAN_COUNTRY_NAME_EN],
                "aliases": [],
            }

        if self.index is None:
            self.missing += 1
            return None

        prefecture = self.index.prefecture_name(place.prefecture)
        if prefecture is None:
            return self.warn(place, f"no matching English prefecture name")

        if place.kind == "prefecture":
            elements = [JAPAN_COUNTRY_NAME_EN, prefecture]
            self.generated += 1
            return {
                "locale": "en",
                "label": ", ".join(reversed(elements)),
                "elements": elements,
                "aliases": [f"{prefecture} prefecture"],
            }

        local_record = self.index.find(place)
        if local_record is None:
            return self.warn(place, "no matching English municipality name")

        city, city_suffix = split_english_name(local_record.municipality_english)
        if not city:
            return self.warn(place, "invalid English municipality name")

        if place.kind == "designated-city-ward":
            ward, ward_suffix = split_english_name(local_record.ward_english)
            if not ward:
                return self.warn(place, "invalid English designated-city ward name")
            elements = [JAPAN_COUNTRY_NAME_EN, prefecture, city, ward]
            aliases = exclude_search_labels(
                [
                    ward,
                    f"{ward} {ward_suffix or 'ward'}",
                    f"{city} {ward}",
                    f"{city} {ward} {ward_suffix or 'ward'}",
                ],
                elements,
                "en",
            )
        else:
            elements = [JAPAN_COUNTRY_NAME_EN, prefecture, city]
            aliases = exclude_search_labels(
                [city, f"{city} {city_suffix or infer_suffix(place)}"],
                elements,
                "en",
            )

        self.generated += 1
        return {
            "locale": "en",
            "label": ", ".join(reversed(elements)),
            "elements": elements,
            "aliases": aliases,
        }

    def warn(self, place: Place, reason: str) -> None:
        self.missing += 1
        print(
            f"warning: no English address for {place.id:05d} {place.label}: {reason}",
            file=sys.stderr,
        )
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        action="append",
        required=True,
        help="N03 ZIP, GeoJSON, GML or Shapefile path/URL; repeat for multiple files",
    )
    parser.add_argument("--output", required=True, help="output NDJSON path")
    parser.add_argument(
        "--english-addresses",
        help="normalized JSON generated from the Digital Agency ABR municipality master",
    )
    parser.add_argument("--grid-km", type=float, default=2.0)
    parser.add_argument("--component-area-km2", type=float, default=0.25)
    parser.add_argument("--validation-grid-km", type=float, default=1.0)
    parser.add_argument("--skip-validation", action="store_true")
    return parser.parse_args()


def load_english_addresses(path_value: str | None) -> EnglishAddressIndex | None:
    if path_value is None:
        return None
    path = Path(path_value).expanduser().resolve()
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("records"), list):
        raise ValueError(f"invalid English address source: {path}")
    records: list[EnglishName] = []
    fields = (
        "prefectureJa",
        "prefectureEn",
        "countyJa",
        "countyEn",
        "municipalityJa",
        "municipalityEn",
        "wardJa",
        "wardEn",
    )
    for index, value in enumerate(document["records"]):
        if not isinstance(value, dict):
            raise ValueError(f"invalid English address record {index}: {path}")
        code = value.get("code")
        if not isinstance(code, str) or not code.isdigit() or len(code) != 5:
            raise ValueError(f"invalid English address code at record {index}: {path}")
        values: dict[str, str] = {}
        for field in fields:
            item = value.get(field)
            if not isinstance(item, str):
                raise ValueError(
                    f"invalid {field} at English address record {index}: {path}"
                )
            values[field] = item.strip()
        if not all(
            values[field]
            for field in (
                "prefectureJa",
                "prefectureEn",
                "municipalityJa",
                "municipalityEn",
            )
        ):
            raise ValueError(f"incomplete English address record {index}: {path}")
        records.append(
            EnglishName(
                int(code),
                values["prefectureJa"],
                values["prefectureEn"],
                values["countyJa"],
                values["countyEn"],
                values["municipalityJa"],
                values["municipalityEn"],
                values["wardJa"],
                values["wardEn"],
            )
        )
    return EnglishAddressIndex(records)


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


def strip_district(japanese: str) -> str:
    if "郡" in japanese:
        return japanese.rsplit("郡", 1)[1]
    return japanese


def japanese_name_candidates(place: Place) -> set[str]:
    if place.kind == "prefecture":
        return {place.prefecture}
    if place.kind == "designated-city-ward":
        assert place.municipality is not None
        assert place.ward is not None
        municipality = strip_district(place.municipality)
        return {
            place.ward,
            f"{place.municipality}{place.ward}",
            f"{municipality}{place.ward}",
        }
    assert place.municipality is not None
    return {place.municipality, strip_district(place.municipality)}


def split_english_name(value: str) -> tuple[str, str | None]:
    normalized = " ".join(value.split())
    for suffix, kind in ENGLISH_NAME_SUFFIXES:
        if normalized.lower().endswith(suffix.lower()):
            return normalized[: -len(suffix)].strip(), kind
    return normalized, None



def infer_suffix(place: Place) -> str:
    japanese = place.ward if place.ward is not None else place.municipality or ""
    if japanese.endswith("市"):
        return "city"
    if japanese.endswith("区"):
        return "ward"
    if japanese.endswith("町"):
        return "town"
    if japanese.endswith("村"):
        return "village"
    return place.kind


def unique_strings(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


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


def make_places(
    frame: gpd.GeoDataFrame,
) -> tuple[list[Place], list[Place], list[Place], list[Place], list[Place]]:
    records: list[tuple[str, str, str, str, int, object]] = []
    for row in frame.itertuples(index=False):
        prefecture = clean_text(getattr(row, "N03_001", ""))
        district = clean_text(getattr(row, "N03_003", ""))
        municipality = clean_text(getattr(row, "N03_004", ""))
        ward = clean_text(getattr(row, "N03_005", ""))
        code = parse_municipality_code(getattr(row, "N03_007", None))
        geometry = getattr(row, "geometry")
        if not prefecture or not municipality or code is None or geometry is None or geometry.is_empty:
            continue
        records.append((prefecture, district, municipality, ward, code, geometry))

    municipality_groups: dict[
        tuple[str, str, str], list[tuple[int, bool, object]]
    ] = defaultdict(list)
    ward_groups: dict[
        tuple[str, str, str, str, int], list[object]
    ] = defaultdict(list)
    for prefecture, district, municipality, ward, code, geometry in records:
        municipality_groups[(prefecture, district, municipality)].append(
            (code, bool(ward), geometry)
        )
        if ward:
            ward_groups[(prefecture, district, municipality, ward, code)].append(geometry)

    to_projected = Transformer.from_crs(GEOGRAPHIC_CRS, PROJECTED_CRS, always_xy=True)
    to_geographic = Transformer.from_crs(PROJECTED_CRS, GEOGRAPHIC_CRS, always_xy=True)

    def make_place(
        place_id: int,
        level: int,
        kind: str,
        prefecture: str,
        municipality: str | None,
        ward: str | None,
        geometries: list[object],
        fixed_coordinates: tuple[float, float] | None = None,
    ) -> Place | None:
        geometry = shapely.make_valid(shapely.union_all(geometries))
        geometry = polygonal_only(geometry)
        if geometry is None or geometry.is_empty:
            return None
        projected = shapely.transform(geometry, to_projected.transform, interleaved=False)
        if fixed_coordinates is None:
            point = largest_component(projected).representative_point()
            longitude, latitude = to_geographic.transform(point.x, point.y)
        else:
            longitude, latitude = fixed_coordinates
            x, y = to_projected.transform(longitude, latitude)
            point = Point(x, y)
        return Place(
            id=place_id,
            level=level,
            kind=kind,
            prefecture=prefecture,
            municipality=municipality,
            ward=ward,
            longitude=longitude,
            latitude=latitude,
            geometry=geometry,
            projected_geometry=projected,
            projected_point=point,
        )

    level3: list[Place] = []
    designated_city_parent_ids: set[int] = set()
    prepared_municipalities: list[tuple[int, str, str, list[object]]] = []
    for (prefecture, district, municipality), entries in municipality_groups.items():
        has_wards = any(entry[1] for entry in entries)
        code = resolve_municipality_code((entry[0] for entry in entries), has_wards)
        municipality_element = f"{district}{municipality}"
        prepared_municipalities.append(
            (code, prefecture, municipality_element, [entry[2] for entry in entries])
        )
        if has_wards:
            designated_city_parent_ids.add(code)

    for code, prefecture, municipality, geometries in sorted(prepared_municipalities):
        kind = (
            "special-ward"
            if prefecture == "東京都" and 13101 <= code <= 13123 and municipality.endswith("区")
            else "municipality"
        )
        place = make_place(
            code,
            3,
            kind,
            prefecture,
            municipality,
            None,
            geometries,
        )
        if place is not None:
            level3.append(place)

    level4: list[Place] = []
    for (prefecture, district, municipality, ward, code), geometries in sorted(
        ward_groups.items(), key=lambda item: item[0][4]
    ):
        place = make_place(
            code,
            4,
            "designated-city-ward",
            prefecture,
            f"{district}{municipality}",
            ward,
            geometries,
        )
        if place is not None:
            level4.append(place)

    if not level3:
        raise ValueError("no level-3 records generated")
    labels_by_id: dict[int, str] = {}
    for place in [*level3, *level4]:
        previous = labels_by_id.get(place.id)
        if previous is not None and previous != place.label:
            raise ValueError(
                f"place id collision: {place.id:05d}: {previous} / {place.label}"
            )
        labels_by_id[place.id] = place.label

    parents_by_label = {place.label: place for place in level3}
    for ward in level4:
        parent_label = f"{JAPAN_COUNTRY_NAME_JA}{ward.prefecture}{ward.municipality}"
        parent = parents_by_label.get(parent_label)
        if parent is None or parent.id not in designated_city_parent_ids:
            raise ValueError(f"ward has no designated-city parent: {ward.label}")

    by_prefecture: dict[str, list[Place]] = defaultdict(list)
    for place in level3:
        by_prefecture[place.prefecture].append(place)

    level2: list[Place] = []
    for prefecture, municipalities in sorted(
        by_prefecture.items(), key=lambda item: min(p.id for p in item[1])
    ):
        prefecture_code = min(place.id for place in municipalities) // 1000
        place = make_place(
            prefecture_code,
            2,
            "prefecture",
            prefecture,
            None,
            None,
            [place.geometry for place in municipalities],
        )
        if place is not None:
            level2.append(place)

    if JAPAN_COUNTRY_ID in labels_by_id or any(
        place.id == JAPAN_COUNTRY_ID for place in level2
    ):
        raise ValueError(f"country id collision: {JAPAN_COUNTRY_ID}")
    country = make_place(
        JAPAN_COUNTRY_ID,
        1,
        "country",
        JAPAN_COUNTRY_NAME_JA,
        None,
        None,
        [place.geometry for place in level2],
        (JAPAN_LONGITUDE_ORIGIN, JAPAN_LATITUDE_ORIGIN),
    )
    if country is None:
        raise ValueError("failed to generate Japan country record")
    level1 = [country]

    decode_places = [
        place for place in level3 if place.id not in designated_city_parent_ids
    ] + level4
    return level1, level2, level3, level4, decode_places

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


def make_aliases(places: list[Place], grid_km: float, component_area_km2: float) -> list[Alias]:
    spacing = grid_km * 1000.0
    area_limit = component_area_km2 * 1_000_000.0
    if spacing <= 0 or area_limit < 0:
        raise ValueError("invalid grid parameters")

    min_x = min(place.projected_geometry.bounds[0] for place in places)
    min_y = min(place.projected_geometry.bounds[1] for place in places)
    origin_x = math.floor(min_x / spacing) * spacing
    origin_y = math.floor(min_y / spacing) * spacing
    to_geographic = Transformer.from_crs(PROJECTED_CRS, GEOGRAPHIC_CRS, always_xy=True)

    aliases: list[Alias] = []
    for place in places:
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


def place_record(
    place: Place,
    english_addresses: EnglishAddressBuilder,
) -> dict[str, object]:
    addresses: list[dict[str, object]] = [
        {
            "locale": "ja",
            "label": place.label,
            "elements": place.elements,
            "aliases": place.aliases,
        }
    ]
    english_address = english_addresses.build(place)
    if english_address is not None:
        addresses.append(english_address)
    return {
        "id": place.id,
        "level": place.level,
        "kind": place.kind,
        "country": JAPAN_COUNTRY_CODE,
        "longitude": (
            place.longitude if place.kind == "country" else round(place.longitude, 6)
        ),
        "latitude": (
            place.latitude if place.kind == "country" else round(place.latitude, 6)
        ),
        "addresses": addresses,
    }


def alias_record(alias: Alias) -> dict[str, object]:
    return {
        "longitude": round(alias.longitude, 6),
        "latitude": round(alias.latitude, 6),
        "belongTo": alias.belong_to,
    }


def write_ndjson(
    output: Path,
    level1: list[Place],
    level2: list[Place],
    level3: list[Place],
    level4: list[Place],
    aliases: list[Alias],
    english_addresses: EnglishAddressBuilder,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(output.suffix + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as stream:
        for place in sorted(level1, key=lambda item: item.id):
            stream.write(json.dumps(place_record(place, english_addresses), ensure_ascii=False, separators=(",", ":")) + "\n")
        for place in sorted(level2, key=lambda item: item.id):
            stream.write(json.dumps(place_record(place, english_addresses), ensure_ascii=False, separators=(",", ":")) + "\n")
        for place in sorted(level3, key=lambda item: item.id):
            stream.write(json.dumps(place_record(place, english_addresses), ensure_ascii=False, separators=(",", ":")) + "\n")
        for place in sorted(level4, key=lambda item: item.id):
            stream.write(json.dumps(place_record(place, english_addresses), ensure_ascii=False, separators=(",", ":")) + "\n")
        for alias in aliases:
            stream.write(json.dumps(alias_record(alias), ensure_ascii=False, separators=(",", ":")) + "\n")
    temp.replace(output)


def validate(places: list[Place], aliases: list[Alias], grid_km: float) -> dict[str, object]:
    spacing = grid_km * 1000.0
    candidate_x = [place.projected_point.x for place in places] + [alias.x for alias in aliases]
    candidate_y = [place.projected_point.y for place in places] + [alias.y for alias in aliases]
    candidate_ids = np.array([place.id for place in places] + [alias.belong_to for alias in aliases])
    tree = cKDTree(np.column_stack((candidate_x, candidate_y)))

    totals: dict[int, int] = defaultdict(int)
    correct: dict[int, int] = defaultdict(int)
    max_distance = 0.0
    total = 0
    total_correct = 0

    min_x = min(place.projected_geometry.bounds[0] for place in places)
    min_y = min(place.projected_geometry.bounds[1] for place in places)
    origin_x = math.floor(min_x / spacing) * spacing
    origin_y = math.floor(min_y / spacing) * spacing

    for place in places:
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
    labels = {place.id: place.label for place in places}
    for place_id, count in totals.items():
        accuracy = correct[place_id] / count if count else 1.0
        worst.append((accuracy, labels[place_id], count))
    worst.sort()

    return {
        "validationPoints": total,
        "accuracy": total_correct / total if total else None,
        "maxNearestDistanceKm": max_distance / 1000.0,
        "worstPlaces": [
            {"label": label, "accuracy": accuracy, "points": count}
            for accuracy, label, count in worst[:10]
        ],
    }


def main() -> int:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()

    frame = load_sources(args.input)
    level1, level2, level3, level4, decode_places = make_places(frame)
    aliases = make_aliases(decode_places, args.grid_km, args.component_area_km2)
    all_places = [*level1, *level2, *level3, *level4]
    english_index = load_english_addresses(args.english_addresses)
    if english_index is None:
        print(
            "warning: English address source is unavailable; non-country English addresses will be omitted",
            file=sys.stderr,
        )
    english_addresses = EnglishAddressBuilder(english_index)
    write_ndjson(output, level1, level2, level3, level4, aliases, english_addresses)

    stats: dict[str, object] = {
        "output": str(output),
        "bytes": output.stat().st_size,
        "level1": len(level1),
        "level2": len(level2),
        "level3": len(level3),
        "level4": len(level4),
        "kinds": {
            kind: sum(place.kind == kind for place in all_places)
            for kind in (
                "country",
                "prefecture",
                "municipality",
                "special-ward",
                "designated-city-ward",
            )
        },
        "decodePlaces": len(decode_places),
        "aliases": len(aliases),
        "gridAliases": sum(alias.source == "grid" for alias in aliases),
        "componentAliases": sum(alias.source == "component" for alias in aliases),
        "typedArrayBytes": len(aliases) * 10,
        "gridKm": args.grid_km,
        "componentAreaKm2": args.component_area_km2,
        "englishAddresses": english_addresses.generated,
        "missingEnglishAddresses": english_addresses.missing,
    }
    if not args.skip_validation:
        stats["validation"] = validate(decode_places, aliases, args.validation_grid_km)
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
