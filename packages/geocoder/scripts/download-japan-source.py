#!/usr/bin/env python3
"""Download the official N03 2026 administrative-area source archive."""

from __future__ import annotations

import argparse
import shutil
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

import certifi

DEFAULT_URL = (
    "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/"
    "N03-20260101_GML.zip"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--output", required=True)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    if output.exists() and not args.force:
        print(output)
        return 0

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".part")
    request = urllib.request.Request(
        args.url,
        headers={"User-Agent": "STGY geocoder source downloader"},
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    print(f"downloading {args.url}", file=sys.stderr)
    try:
        with urllib.request.urlopen(
            request, context=ssl_context
        ) as response, temporary.open("wb") as stream:
            shutil.copyfileobj(response, stream, length=1024 * 1024)
        temporary.replace(output)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    print(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, urllib.error.URLError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
