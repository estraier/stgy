#!/usr/bin/env python3
"""Validate the generated STGY geocoder NDJSON without GIS dependencies."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

PLACE_KIND_LEVELS = {
    "prefecture": 1,
    "municipality": 2,
    "special-ward": 2,
    "designated-city-ward": 3,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    return parser.parse_args()


def valid_coordinate(value: object, minimum: float, maximum: float) -> bool:
    return isinstance(value, (int, float)) and minimum <= float(value) <= maximum


def main() -> int:
    path = Path(parse_args().file).expanduser().resolve()
    place_ids: set[int] = set()
    place_kinds: dict[int, str] = {}
    japanese_labels: dict[tuple[str, str], int] = {}
    japanese_elements: dict[int, list[str]] = {}
    alias_targets: Counter[int] = Counter()
    counts: Counter[str] = Counter()

    with path.open(encoding="utf-8") as stream:
        for line_number, raw_line in enumerate(stream, 1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
            if not isinstance(record, dict):
                raise ValueError(f"{path}:{line_number}: record must be an object")
            is_place = "id" in record
            is_alias = "belongTo" in record
            if is_place == is_alias:
                raise ValueError(
                    f"{path}:{line_number}: record must contain exactly one of id or belongTo"
                )
            if not valid_coordinate(record.get("longitude"), -180, 180):
                raise ValueError(f"{path}:{line_number}: invalid longitude")
            if not valid_coordinate(record.get("latitude"), -90, 90):
                raise ValueError(f"{path}:{line_number}: invalid latitude")

            if is_alias:
                target = record.get("belongTo")
                if not isinstance(target, int) or target <= 0:
                    raise ValueError(f"{path}:{line_number}: invalid belongTo")
                alias_targets[target] += 1
                counts["aliases"] += 1
                continue

            place_id = record.get("id")
            level = record.get("level")
            kind = record.get("kind")
            country = record.get("country")
            addresses = record.get("addresses")
            if not isinstance(place_id, int) or place_id <= 0 or place_id in place_ids:
                raise ValueError(f"{path}:{line_number}: invalid or duplicate place id")
            if not isinstance(kind, str) or kind not in PLACE_KIND_LEVELS:
                raise ValueError(f"{path}:{line_number}: invalid kind")
            if level != PLACE_KIND_LEVELS[kind]:
                raise ValueError(
                    f"{path}:{line_number}: kind {kind} requires level {PLACE_KIND_LEVELS[kind]}"
                )
            if not isinstance(country, str) or not country:
                raise ValueError(f"{path}:{line_number}: invalid country")
            if not isinstance(addresses, list) or not addresses:
                raise ValueError(f"{path}:{line_number}: invalid addresses")

            japanese_address_found = False
            for address in addresses:
                if not isinstance(address, dict):
                    raise ValueError(f"{path}:{line_number}: invalid address")
                locale = address.get("locale")
                label = address.get("label")
                elements = address.get("elements")
                aliases = address.get("aliases")
                if not isinstance(locale, str) or not locale:
                    raise ValueError(f"{path}:{line_number}: invalid locale")
                if not isinstance(label, str) or not label:
                    raise ValueError(f"{path}:{line_number}: invalid label")
                if (
                    not isinstance(elements, list)
                    or len(elements) != level
                    or not all(isinstance(element, str) and element for element in elements)
                    or "".join(elements) != label
                ):
                    raise ValueError(f"{path}:{line_number}: invalid elements")
                if (
                    not isinstance(aliases, list)
                    or not all(isinstance(alias, str) and alias for alias in aliases)
                    or len(set(aliases)) != len(aliases)
                ):
                    raise ValueError(f"{path}:{line_number}: invalid aliases")
                counts["addressAliases"] += len(aliases)
                if locale == "ja":
                    key = (country, label)
                    if key in japanese_labels:
                        raise ValueError(f"{path}:{line_number}: duplicate Japanese label")
                    japanese_labels[key] = place_id
                    japanese_elements[place_id] = elements
                    japanese_address_found = True
            if not japanese_address_found:
                raise ValueError(f"{path}:{line_number}: place has no Japanese address")

            place_ids.add(place_id)
            place_kinds[place_id] = kind
            counts[f"level{level}"] += 1
            counts[kind] += 1

    if not place_ids:
        raise ValueError(f"{path}: no place records")

    designated_city_parent_ids: set[int] = set()
    for place_id, kind in place_kinds.items():
        if kind != "designated-city-ward":
            continue
        elements = japanese_elements[place_id]
        parent_label = elements[0] + elements[1]
        parent_id = japanese_labels.get(("JP", parent_label))
        if parent_id is None or place_kinds.get(parent_id) != "municipality":
            raise ValueError(
                f"{path}: designated-city ward {place_id} has no municipality parent {parent_label}"
            )
        designated_city_parent_ids.add(parent_id)

    decode_place_ids = {
        place_id
        for place_id, kind in place_kinds.items()
        if kind in {"special-ward", "designated-city-ward"}
        or (kind == "municipality" and place_id not in designated_city_parent_ids)
    }
    if not decode_place_ids:
        raise ValueError(f"{path}: no reverse-geocoding places")

    for target in alias_targets:
        if target not in place_ids:
            raise ValueError(f"{path}: alias refers to unknown place id {target}")
        if target not in decode_place_ids:
            raise ValueError(
                f"{path}: alias {target} does not refer to a reverse-geocoding place"
            )

    result = {
        "file": str(path),
        "bytes": path.stat().st_size,
        **dict(sorted(counts.items())),
        "decodePlaces": len(decode_place_ids),
        "designatedCityParents": len(designated_city_parent_ids),
        "aliasTargets": len(alias_targets),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
