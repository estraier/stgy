#!/bin/sh
set -eu

PACKAGE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON=${PYTHON:-python3}
VENV=${STGY_GEOCODER_GENERATOR_VENV:-"$PACKAGE_ROOT/.cache/generator-venv"}
SOURCE=${STGY_GEOCODER_SOURCE_FILE:-"$PACKAGE_ROOT/source-data/N03-2026/N03-20260101_GML.zip"}
SOURCE_URL=${STGY_GEOCODER_SOURCE_URL:-"https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_GML.zip"}
OUTPUT=${STGY_GEOCODER_OUTPUT_FILE:-"$PACKAGE_ROOT/data/geo-japan.ndjson"}

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON" -m venv "$VENV"
fi

if ! "$VENV/bin/python" -c 'import certifi, geopandas, numpy, pandas, pyogrio, pyproj, scipy, shapely' >/dev/null 2>&1; then
  "$VENV/bin/python" -m pip install -r "$PACKAGE_ROOT/scripts/requirements-geo.txt"
fi

if [ -f "$SOURCE" ]; then
  if "$VENV/bin/python" -c 'import sys, zipfile; raise SystemExit(0 if zipfile.is_zipfile(sys.argv[1]) else 1)' "$SOURCE"; then
    echo "using existing source $SOURCE" >&2
  else
    echo "removing invalid source archive $SOURCE" >&2
    rm -f "$SOURCE"
  fi
fi

if [ ! -f "$SOURCE" ]; then
  "$VENV/bin/python" "$PACKAGE_ROOT/scripts/download-japan-source.py" \
    --url "$SOURCE_URL" \
    --output "$SOURCE"
fi

exec "$VENV/bin/python" "$PACKAGE_ROOT/scripts/generate-japan.py" \
  --input "$SOURCE" \
  --output "$OUTPUT" \
  --grid-km 5 \
  --component-area-km2 0.25 \
  --validation-grid-km 1 \
  "$@"
