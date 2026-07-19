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

run_psql() {
  if [ "$MODE" = docker ]; then
    docker compose exec -T postgres psql \
      -v ON_ERROR_STOP=1 \
      -U "$STGY_DATABASE_USER" \
      "$STGY_DATABASE_NAME" "$@"
  else
    PGPASSWORD="$STGY_DATABASE_PASSWORD" psql \
      -h 127.0.0.1 \
      -p "${STGY_DATABASE_PORT:-5432}" \
      -v ON_ERROR_STOP=1 \
      -U "$STGY_DATABASE_USER" \
      "$STGY_DATABASE_NAME" "$@"
  fi
}

run_psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

shopt -s nullglob
sql_files=(postgres/init/*.sql)
shopt -u nullglob

if [ "${#sql_files[@]}" -eq 0 ]; then
  echo "No PostgreSQL initialization files found in postgres/init." >&2
  exit 1
fi

for file in "${sql_files[@]}"; do
  run_psql < "$file"
done

echo "==> Postgres reset done ($MODE mode)."
