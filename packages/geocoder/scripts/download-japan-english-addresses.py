#!/usr/bin/env python3
"""Download the public ABR municipality master and normalize its English names."""

from __future__ import annotations

import argparse
import csv
from datetime import date
import io
import json
import ssl
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable

import certifi

DEFAULT_CATALOG_URL = (
    "https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json"
)
CITY_DATASET_FILENAME = "mt_city_all.csv.zip"

COLUMN_ALIASES = {
    "code": ("lg_code", "全国地方公共団体コード"),
    "prefecture_ja": ("pref", "都道府県名"),
    "prefecture_en": (
        "pref_roma",
        "pref_en",
        "prefecture_en",
        "都道府県名_英字",
    ),
    "county_ja": ("county", "郡名"),
    "county_en": ("county_roma", "county_en", "郡名_英字"),
    "municipality_ja": ("city", "市区町村名"),
    "municipality_en": (
        "city_roma",
        "city_en",
        "municipality_en",
        "市区町村名_英字",
    ),
    "ward_ja": ("ward", "政令市区名"),
    "ward_en": ("ward_roma", "ward_en", "政令市区名_英字"),
    "effective_date": ("efct_date", "effective_date", "効力発生日"),
    "end_date": ("ablt_date", "end_date", "abolition_date", "廃止日"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--catalog-url", default=DEFAULT_CATALOG_URL)
    parser.add_argument(
        "--dataset-url",
        help="direct mt_city_all.csv.zip URL; skips catalog lookup",
    )
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def open_url(url: str, ssl_context: ssl.SSLContext) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, application/zip, text/csv, */*",
            "User-Agent": "STGY geocoder source downloader",
        },
    )
    with urllib.request.urlopen(request, context=ssl_context) as response:
        return response.read()


def iter_access_urls(value: object) -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"accessURL", "downloadURL"} and isinstance(child, str):
                yield child
            else:
                yield from iter_access_urls(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_access_urls(child)


def find_city_dataset_url(catalog: object) -> str:
    matches = []
    for url in iter_access_urls(catalog):
        path = urllib.parse.urlparse(url).path
        if Path(path).name == CITY_DATASET_FILENAME:
            matches.append(url)
    matches = sorted(set(matches))
    if len(matches) != 1:
        raise ValueError(
            f"expected one {CITY_DATASET_FILENAME} in ABR catalog, found {len(matches)}"
        )
    return matches[0]


def extract_csv(payload: bytes, source_url: str) -> str:
    if source_url.lower().endswith(".zip") or payload.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            candidates = sorted(
                name
                for name in archive.namelist()
                if not name.endswith("/") and name.lower().endswith(".csv")
            )
            if not candidates:
                raise ValueError(f"ABR archive has no CSV file: {source_url}")
            preferred = next(
                (
                    name
                    for name in candidates
                    if Path(name).name == CITY_DATASET_FILENAME.removesuffix(".zip")
                ),
                candidates[0],
            )
            payload = archive.read(preferred)
    return payload.decode("utf-8-sig")


def normalize_header(value: str) -> str:
    return value.strip().lstrip("\ufeff").casefold()


def find_column(fieldnames: list[str], aliases: tuple[str, ...]) -> str | None:
    normalized = {normalize_header(name): name for name in fieldnames}
    for alias in aliases:
        found = normalized.get(normalize_header(alias))
        if found is not None:
            return found
    return None


def get_value(row: dict[str, str], column: str | None) -> str:
    if column is None:
        return ""
    return (row.get(column) or "").strip()


def normalize_lg_code(value: str) -> str | None:
    code = value.strip()
    if code.endswith(".0"):
        code = code[:-2]
    if not code.isdigit():
        return None
    if len(code) == 6:
        code = code[:5]
    elif len(code) < 5:
        code = code.zfill(5)
    if len(code) != 5 or int(code) <= 47:
        return None
    return code



def parse_date(value: str, field: str, row_number: int) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"invalid {field} at ABR municipality row {row_number}: {value!r}"
        ) from exc

def parse_records(csv_text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(csv_text, newline=""))
    if reader.fieldnames is None:
        raise ValueError("ABR municipality CSV has no header")
    fieldnames = list(reader.fieldnames)
    columns = {
        name: find_column(fieldnames, aliases)
        for name, aliases in COLUMN_ALIASES.items()
    }
    for required in (
        "code",
        "prefecture_ja",
        "prefecture_en",
        "municipality_ja",
        "municipality_en",
    ):
        if columns[required] is None:
            raise ValueError(
                f"ABR municipality CSV is missing column for {required}; "
                f"headers={fieldnames!r}"
            )

    by_code: dict[str, dict[str, str]] = {}
    today = date.today()
    for row_number, row in enumerate(reader, start=2):
        effective_date = parse_date(
            get_value(row, columns["effective_date"]), "effective date", row_number
        )
        end_date = parse_date(
            get_value(row, columns["end_date"]), "abolition date", row_number
        )
        if effective_date is not None and effective_date > today:
            continue
        if end_date is not None and end_date <= today:
            continue
        code = normalize_lg_code(get_value(row, columns["code"]))
        if code is None:
            continue
        record = {
            "code": code,
            "prefectureJa": get_value(row, columns["prefecture_ja"]),
            "prefectureEn": get_value(row, columns["prefecture_en"]),
            "countyJa": get_value(row, columns["county_ja"]),
            "countyEn": get_value(row, columns["county_en"]),
            "municipalityJa": get_value(row, columns["municipality_ja"]),
            "municipalityEn": get_value(row, columns["municipality_en"]),
            "wardJa": get_value(row, columns["ward_ja"]),
            "wardEn": get_value(row, columns["ward_en"]),
        }
        if not all(
            record[key]
            for key in (
                "prefectureJa",
                "prefectureEn",
                "municipalityJa",
                "municipalityEn",
            )
        ):
            print(
                f"warning: incomplete ABR municipality record at row {row_number}: "
                f"code={code}",
                file=sys.stderr,
            )
            continue
        previous = by_code.get(code)
        if previous is not None and previous != record:
            raise ValueError(f"conflicting active ABR municipality records for code {code}")
        by_code[code] = record
    if not by_code:
        raise ValueError("ABR municipality CSV produced no active records")
    return [by_code[code] for code in sorted(by_code)]


def main() -> int:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    if output.exists() and not args.force:
        print(output)
        return 0

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    dataset_url = args.dataset_url
    if dataset_url is None:
        print(f"downloading ABR catalog {args.catalog_url}", file=sys.stderr)
        catalog = json.loads(open_url(args.catalog_url, ssl_context).decode("utf-8"))
        dataset_url = find_city_dataset_url(catalog)

    print(f"downloading ABR municipality master {dataset_url}", file=sys.stderr)
    records = parse_records(extract_csv(open_url(dataset_url, ssl_context), dataset_url))

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".part")
    document = {
        "source": "Digital Agency Address Base Registry municipality master",
        "catalogUrl": args.catalog_url,
        "datasetUrl": dataset_url,
        "records": records,
    }
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(output)
    print(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
