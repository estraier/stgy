#! /bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

set -a
[ -f .env ] && source .env
set +a

CMD="dev"
PORT="${STGY_BACKEND_PORT:-3100}"
WORKER="one"
OVERRIDING_OPENAI_API_KEY="-"

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
    --multi-worker)
      WORKER="multi"
      shift
      ;;
    --no-worker)
      WORKER="no"
      shift
      ;;
    --openai-api-key)
      [[ $# -ge 2 ]] || { echo "Error: --openai-api-key requires a value" >&2; exit 1; }
      OVERRIDING_OPENAI_API_KEY="$2"
      shift 2
      ;;
    --openai-api-key=*)
      OVERRIDING_OPENAI_API_KEY="${1#*=}"
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

export STGY_FRONTEND_HOST=localhost
export STGY_FRONTEND_CANONICAL_URL=http://localhost:8080
export STGY_FRONTEND_ORIGIN=http://localhost:3000,http://localhost:8080
export STGY_BACKEND_API_BASE_URL=http://localhost:3100
export STGY_BACKEND_API_PRIVATE_URL_LIST=http://localhost:3100
export STGY_SEARCH_API_BASE_URL=http://localhost:3200
export STGY_DATABASE_HOST=localhost
export STGY_STORAGE_S3_ENDPOINT=http://localhost:9000
export STGY_REDIS_HOST=localhost
export STGY_STORAGE_S3_PUBLIC_URL_PREFIX=http://localhost:9000/{bucket}/
export STGY_SMTP_HOST=localhost
export STGY_BACKEND_PORT="$PORT"
export STGY_LOG_FORMAT="simple"
if [ "${OVERRIDING_OPENAI_API_KEY}" != "-" ]; then
  export STGY_OPENAI_API_KEY="${OVERRIDING_OPENAI_API_KEY}"
fi

cleanup() {
  trap - INT TERM EXIT
  kill 0 >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

case "${WORKER}" in
  multi)
    echo "[run-local-backend] running multiple workers"
    (sleep 3 ; npm run backend:mail-worker) &
    (sleep 3 ; npm run backend:media-worker) &
    (sleep 3 ; npm run backend:notification-worker) &
    (sleep 3 ; npm run backend:search-index-worker) &
    (sleep 3 ; npm run backend:ai-summary-worker) &
    (sleep 3 ; npm run backend:ai-user-worker) &
    ;;
  one)
    echo "[run-local-backend] running one workers"
    (sleep 3 ; npm run backend:one-worker) &
    ;;
  *)
    echo "[run-local-backend] running no workers"
    ;;
esac

echo "[run-local-backend] port=${STGY_BACKEND_PORT} cmd=${CMD}"
echo "[run-local-backend] npm run ${CMD} -- ${PASS_ARGS[*]-}"

if ((${#PASS_ARGS[@]})); then
  npm run "backend:${CMD}" -- "${PASS_ARGS[@]}"
else
  npm run "backend:${CMD}"
fi
