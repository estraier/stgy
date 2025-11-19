#! /bin/bash

set -euo pipefail

set -a
[ -f .env ] && source .env
set +a

CMD="dev"
PORT="${STGY_FRONTEND_PORT:-3000}"

declare -a PASS_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start)
      CMD="start"
      shift
      ;;
    --port)
      [[ $# -ge 2 ]] || { echo "Error: --port requires a value" >&2; exit 1; }
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    *)
      PASS_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Invalid port: $PORT" >&2
  exit 1
fi

export NEXT_PUBLIC_FRONTEND_CANONICAL_URL=${STGY_FRONTEND_CANONICAL_URL}
export NEXT_PUBLIC_BACKEND_API_BASE_URL=${STGY_BACKEND_API_BASE_URL}
export NEXT_PUBLIC_STORAGE_S3_BUCKET_PREFIX=${STGY_STORAGE_S3_BUCKET_PREFIX}
export NEXT_PUBLIC_STORAGE_S3_PUBLIC_URL_PREFIX=${STGY_STORAGE_S3_PUBLIC_URL_PREFIX}

echo "[run-local-frontend] port=${STGY_BACKEND_PORT}  cmd=${CMD}"
echo "[run-local-frontend] npm run ${CMD} -- ${PASS_ARGS[*]-}"

if ((${#PASS_ARGS[@]})); then
  npm run "frontend:${CMD}" -- "${PASS_ARGS[@]}"
else
  npm run "frontend:${CMD}"
fi
