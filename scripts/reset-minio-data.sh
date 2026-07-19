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

readonly BUCKETS=(stgy-test stgy-images stgy-profiles stgy-tracks)

if [ "$MODE" = docker ]; then
  docker compose exec -T minio sh -eu -c '
    mc alias set local "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  '

  for bucket in "${BUCKETS[@]}"; do
    docker compose exec -T minio sh -eu -c '
      bucket="$1"
      mc rb --force "local/$bucket" >/dev/null 2>&1 || true
      mc mb "local/$bucket" >/dev/null
      mc anonymous set download "local/$bucket" >/dev/null
    ' sh "$bucket"
    echo "reset bucket: $bucket"
  done
else
  set -a
  source .env
  set +a

  endpoint="http://127.0.0.1:${STGY_MINIO_PORT:-9000}"
  mc alias set stgylocal "$endpoint" "$STGY_MINIO_ROOT_USER" "$STGY_MINIO_ROOT_PASSWORD" >/dev/null

  for bucket in "${BUCKETS[@]}"; do
    mc rb --force "stgylocal/$bucket" >/dev/null 2>&1 || true
    mc mb "stgylocal/$bucket" >/dev/null
    mc anonymous set download "stgylocal/$bucket" >/dev/null
    echo "reset bucket: $bucket"
  done
fi

echo "==> MinIO reset done ($MODE mode)."
