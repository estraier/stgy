#! /bin/bash

set -euo pipefail

set -a
[ -f ../.env ] && source ../.env
set +a

CMD="dev"
PORT="${FAKEBOOK_BACKEND_PORT:-3001}"

declare -a PASS_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start)
      CMD="start"
      shift
      ;;
    --port|-p)
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

export FAKEBOOK_FRONTEND_HOST=localhost
export FAKEBOOK_BACKEND_HOST=localhost
export FAKEBOOK_DATABASE_HOST=localhost
export FAKEBOOK_MINIO_HOST=localhost
export FAKEBOOK_STORAGE_S3_ENDPOINT=http://localhost:9000
export FAKEBOOK_REDIS_HOST=localhost
export FAKEBOOK_SMTP_HOST=localhost
export FAKEBOOK_BACKEND_PORT="$PORT"

cleanup() {
  trap - INT TERM EXIT
  kill 0 >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

npm run mail-worker &
npm run media-worker &
npm run notification-worker &

echo "[run-local] port=${FAKEBOOK_BACKEND_PORT}  cmd=${CMD}"
echo "[run-local] npm run ${CMD} -- ${PASS_ARGS[*]-}"

if ((${#PASS_ARGS[@]})); then
  npm run "${CMD}" -- "${PASS_ARGS[@]}"
else
  npm run "${CMD}"
fi
