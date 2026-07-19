#!/bin/bash

set -euo pipefail

MODE=docker
INSECURE_PASSWORD=false
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
    --insecure-password)
      INSECURE_PASSWORD=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--mode docker|native] [--insecure-password]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--mode docker|native] [--insecure-password]" >&2
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

./scripts/reset-data.sh --mode "$MODE"
./scripts/reset-minio-data.sh --mode "$MODE"
./scripts/reset-ttts-data.sh --mode "$MODE"

if [ "$INSECURE_PASSWORD" = true ]; then
  ./scripts/edit-users.py --insecure-password seeder/user-0*.txt
else
  ./scripts/edit-users.py seeder/user-0*.txt
fi
./scripts/edit-posts.py seeder/post-0*.txt
./scripts/user-actions.py seeder/action-*.txt
./scripts/edit-posts.py seeder/post-x0*.txt
