#! /bin/bash
set -euo pipefail

PORT=3000
EXTRA_NODE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p)
      [[ $# -ge 2 ]] || { echo "Error: --port requires a value" >&2; exit 1; }
      PORT="$2"; shift
      ;;
    --port=*)
      PORT="${1#*=}"
      ;;
    *)
      EXTRA_NODE_ARGS+=("$1")
      ;;
  esac
  shift
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Invalid port: $PORT" >&2
  exit 1
fi

export NEXT_PUBLIC_API_BASE="http://localhost:3001"
export NEXT_PUBLIC_S3_PUBLIC_BASE_URL="http://localhost:9000"

rm -rf .next/standalone

npm run build

mkdir -p .next/standalone/frontend/.next
cp -r .next/static ".next/standalone/frontend/.next/static"
cp -r public ".next/standalone/frontend/public"

cd .next/standalone
echo "Starting Next server on port ${PORT}"
node frontend/server.js -p "$PORT" "${EXTRA_NODE_ARGS[@]}"
