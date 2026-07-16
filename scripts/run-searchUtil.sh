#! /bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

set -a
[ -f .env ] && source .env
set +a

SEARCH_PORT="${STGY_SEARCH_PORT:-3200}"
if ! [[ "$SEARCH_PORT" =~ ^[0-9]+$ ]] || (( SEARCH_PORT < 1 || SEARCH_PORT > 65535 )); then
  echo "Invalid STGY_SEARCH_PORT: $SEARCH_PORT" >&2
  exit 1
fi

export STGY_DATABASE_HOST=localhost
export STGY_SEARCH_API_BASE_URL="http://localhost:${SEARCH_PORT}"

npm exec --workspace backend -- ts-node src/searchUtil.ts "$@"
