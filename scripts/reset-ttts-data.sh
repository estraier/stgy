#!/bin/bash

set -euo pipefail

MODE=docker
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      [ "$#" -ge 2 ] || { echo "Missing value for --mode" >&2; exit 2; }
      MODE="$2"
      shift 2
      ;;
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--mode docker|native]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--mode docker|native]" >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  docker|native) ;;
  *)
    echo "Invalid mode: $MODE (expected docker or native)" >&2
    exit 2
    ;;
esac

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

if [ "$MODE" = docker ]; then
  SEARCH_HOST="http://localhost:${SEARCH_PORT}"
else
  SEARCH_HOST="http://127.0.0.1:${SEARCH_PORT}"
fi
RESOURCES=("posts" "users")

echo "Resetting search index for: ${RESOURCES[*]} at ${SEARCH_HOST} ..."

for RESOURCE in "${RESOURCES[@]}"; do
  echo "--------------------------------------------------"
  echo "Target Resource: $RESOURCE"
  echo "  -> Fetching shard list ..."

  SHARDS_JSON=$(curl --fail --silent --show-error \
    "${SEARCH_HOST}/${RESOURCE}/shards")

  if ! jq -e 'type == "array" and all(.[]; (.startTimestamp | type) == "number")' \
    >/dev/null <<<"$SHARDS_JSON"; then
    echo "     Invalid shard-list response: $SHARDS_JSON" >&2
    exit 1
  fi

  if [ "$(jq 'length' <<<"$SHARDS_JSON")" -eq 0 ]; then
    echo "     No shards found."
    continue
  fi

  while IFS= read -r TS; do
    echo "  -> Deleting shard: $TS ..."
    DELETE_RES=$(curl --fail --silent --show-error -X DELETE \
      "${SEARCH_HOST}/${RESOURCE}/shards/${TS}?wait=60")
    if ! jq -e '.result == "enqueued" and (.taskId | type) == "string"' \
      >/dev/null <<<"$DELETE_RES"; then
      echo "     Invalid delete response: $DELETE_RES" >&2
      exit 1
    fi
    echo "     $DELETE_RES"
  done < <(jq -r '.[].startTimestamp' <<<"$SHARDS_JSON")
done

echo "--------------------------------------------------"
echo "==> Search server reset done ($MODE mode)."
