#!/bin/sh
set -eu

PACKAGE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VENV=${STGY_GEOCODER_GENERATOR_VENV:-"$PACKAGE_ROOT/.cache/generator-venv"}
REQUIREMENTS="$PACKAGE_ROOT/scripts/requirements-geo.txt"
SOURCE=${STGY_GEOCODER_SOURCE_FILE:-"$PACKAGE_ROOT/source-data/N03-2026/N03-20260101_GML.zip"}
SOURCE_URL=${STGY_GEOCODER_SOURCE_URL:-"https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_GML.zip"}
OUTPUT=${STGY_GEOCODER_OUTPUT_FILE:-"$PACKAGE_ROOT/data/geo-japan.ndjson"}
ENGLISH_SOURCE=${STGY_GEOCODER_ENGLISH_SOURCE_FILE:-"$PACKAGE_ROOT/source-data/address-base-registry/mt_city_all-en.json"}
ABR_CATALOG_URL=${STGY_GEOCODER_ABR_CATALOG_URL:-"https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json"}
ABR_CITY_URL=${STGY_GEOCODER_ABR_CITY_URL:-}

python_is_supported() {
  "$1" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
    >/dev/null 2>&1
}

find_python() {
  if [ -n "${PYTHON:-}" ]; then
    if command -v "$PYTHON" >/dev/null 2>&1 && python_is_supported "$PYTHON"; then
      command -v "$PYTHON"
      return 0
    fi
    echo "error: PYTHON must point to Python 3.10 or later: $PYTHON" >&2
    return 1
  fi

  for candidate in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && python_is_supported "$candidate"; then
      command -v "$candidate"
      return 0
    fi
  done

  if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    echo "installing Python 3.12 for the geocoder generator" >&2
    brew install python@3.12 >&2
    candidate="$(brew --prefix python@3.12)/bin/python3.12"
    if [ -x "$candidate" ] && python_is_supported "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  echo "error: Python 3.10 or later is required for the geocoder generator" >&2
  return 1
}

PYTHON=$(find_python)
REQUIREMENTS_HASH=$(
  "$PYTHON" - "$REQUIREMENTS" <<'PY'
import hashlib
from pathlib import Path
import sys
print(hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)
VENV_MARKER="$VENV/.stgy-generator-environment"
EXPECTED_MARKER=$(
  "$PYTHON" - "$REQUIREMENTS_HASH" <<'PY'
import sys
print(f"{sys.executable}\n{sys.version_info.major}.{sys.version_info.minor}\n{sys.argv[1]}")
PY
)

RECREATE_VENV=false
if [ ! -x "$VENV/bin/python" ] || [ ! -f "$VENV_MARKER" ]; then
  RECREATE_VENV=true
elif [ "$(cat "$VENV_MARKER")" != "$EXPECTED_MARKER" ]; then
  RECREATE_VENV=true
elif ! "$VENV/bin/python" -c '
import sys
import geopandas
import shapely
parts = tuple(int(part) for part in shapely.__version__.split(".")[:2])
raise SystemExit(0 if sys.version_info >= (3, 10) and parts >= (2, 1) else 1)
' >/dev/null 2>&1; then
  RECREATE_VENV=true
fi

if [ "$RECREATE_VENV" = true ]; then
  rm -rf "$VENV"
  "$PYTHON" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install -r "$REQUIREMENTS"
  printf '%s\n' "$EXPECTED_MARKER" > "$VENV_MARKER"
elif ! "$VENV/bin/python" -c 'import certifi, geopandas, numpy, pandas, pyogrio, pyproj, scipy, shapely' >/dev/null 2>&1; then
  "$VENV/bin/python" -m pip install -r "$REQUIREMENTS"
  printf '%s\n' "$EXPECTED_MARKER" > "$VENV_MARKER"
fi

"$VENV/bin/python" - <<'PY' >&2
import platform
import geopandas
import pyogrio
import shapely
print(
    "geocoder generator environment: "
    f"Python {platform.python_version()}, "
    f"GeoPandas {geopandas.__version__}, "
    f"Pyogrio {pyogrio.__version__}, "
    f"Shapely {shapely.__version__}"
)
PY

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

if [ ! -f "$ENGLISH_SOURCE" ]; then
  if [ -n "$ABR_CITY_URL" ]; then
    if ! "$VENV/bin/python" "$PACKAGE_ROOT/scripts/download-japan-english-addresses.py" \
      --catalog-url "$ABR_CATALOG_URL" \
      --dataset-url "$ABR_CITY_URL" \
      --output "$ENGLISH_SOURCE"; then
      echo "warning: failed to download ABR municipality names; generating Japanese addresses only" >&2
    fi
  elif ! "$VENV/bin/python" "$PACKAGE_ROOT/scripts/download-japan-english-addresses.py" \
    --catalog-url "$ABR_CATALOG_URL" \
    --output "$ENGLISH_SOURCE"; then
    echo "warning: failed to download ABR municipality names; generating Japanese addresses only" >&2
  fi
fi

if [ -f "$ENGLISH_SOURCE" ]; then
  exec "$VENV/bin/python" "$PACKAGE_ROOT/scripts/generate-japan.py" \
    --input "$SOURCE" \
    --english-addresses "$ENGLISH_SOURCE" \
    --output "$OUTPUT" \
    --grid-km 2 \
    --component-area-km2 0.25 \
    --validation-grid-km 1 \
    "$@"
else
  exec "$VENV/bin/python" "$PACKAGE_ROOT/scripts/generate-japan.py" \
    --input "$SOURCE" \
    --output "$OUTPUT" \
    --grid-km 2 \
    --component-area-km2 0.25 \
    --validation-grid-km 1 \
    "$@"
fi
