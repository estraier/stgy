#!/bin/bash

set -euo pipefail

MODE=docker
CORE_ONLY=false
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
    --core-only)
      CORE_ONLY=true
      shift
      ;;
    --insecure-password)
      INSECURE_PASSWORD=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--mode docker|native] [--core-only] [--insecure-password]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--mode docker|native] [--core-only] [--insecure-password]" >&2
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

edit_users() {
  if [ "$INSECURE_PASSWORD" = true ]; then
    ./scripts/edit-users.py --insecure-password "$@"
  else
    ./scripts/edit-users.py "$@"
  fi
}

if [ "$CORE_ONLY" = true ]; then
  edit_users seeder/user-core-*.txt
  ./scripts/edit-agreement.py seeder/agreement-core-*.json
  ./scripts/edit-posts.py seeder/post-core-*.txt
  ./scripts/user-actions.py seeder/action-core-*.txt
else
  edit_users seeder/user-core-*.txt seeder/user-test-*.txt
  ./scripts/edit-agreement.py seeder/agreement-core-*.json
  ./scripts/edit-posts.py seeder/post-core-*.txt seeder/post-test-*.txt
  ./scripts/user-actions.py seeder/action-core-*.txt seeder/action-test*.txt
  ./scripts/edit-posts.py seeder/post-after-actions-*.txt
fi
