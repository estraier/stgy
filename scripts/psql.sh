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
source .env
set +a

if [ "$MODE" = docker ]; then
  exec docker compose exec postgres psql \
    -U "$STGY_DATABASE_USER" \
    "$STGY_DATABASE_NAME"
else
  export PGPASSWORD="$STGY_DATABASE_PASSWORD"
  exec psql \
    -h 127.0.0.1 \
    -p "${STGY_DATABASE_PORT:-5432}" \
    -U "$STGY_DATABASE_USER" \
    "$STGY_DATABASE_NAME"
fi
