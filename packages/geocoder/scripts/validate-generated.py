#!/usr/bin/env python3
"""Validate the generated STGY geocoder NDJSON without GIS dependencies."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    return parser.parse_args()


def valid_coordinate(value: object, minimum: float, maximum: float) -> bool:
    return isinstance(value, (int, float)) and minimum <= float(value) <= maximum


def main() -> int:
    path = Path(parse_args().file).expanduser().resolve()
    place_ids: set[int] = set()
    place_levels: dict[int, int] = {}
    labels: set[tuple[str, str]] = set()
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
            country = record.get("country")
            addresses = record.get("addresses")
            if not isinstance(place_id, int) or place_id <= 0 or place_id in place_ids:
                raise ValueError(f"{path}:{line_number}: invalid or duplicate place id")
            if not isinstance(level, int) or level <= 0:
                raise ValueError(f"{path}:{line_number}: invalid level")
            if not isinstance(country, str) or not country:
                raise ValueError(f"{path}:{line_number}: invalid country")
            if not isinstance(addresses, list) or not addresses:
                raise ValueError(f"{path}:{line_number}: invalid addresses")
            for address in addresses:
                if not isinstance(address, dict):
                    raise ValueError(f"{path}:{line_number}: invalid address")
                locale = address.get("locale")
                label = address.get("label")
                elements = address.get("elements")
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
                key = (country, label)
                if locale == "ja" and key in labels:
                    raise ValueError(f"{path}:{line_number}: duplicate Japanese label")
                if locale == "ja":
                    labels.add(key)
            place_ids.add(place_id)
            place_levels[place_id] = level
            counts[f"level{level}"] += 1

    if not place_ids:
        raise ValueError(f"{path}: no place records")
    highest_level = max(place_levels.values())
    for target in alias_targets:
        if target not in place_ids:
            raise ValueError(f"{path}: alias refers to unknown place id {target}")
        if place_levels[target] != highest_level:
            raise ValueError(
                f"{path}: alias {target} refers to level {place_levels[target]}, expected {highest_level}"
            )

    result = {
        "file": str(path),
        "bytes": path.stat().st_size,
        "highestLevel": highest_level,
        **dict(sorted(counts.items())),
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
