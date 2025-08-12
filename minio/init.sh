#! /bin/sh

set -eu

MARKER="/data/.inited"
MC_DIR="/data/bin"
MC="$MC_DIR/mc"
MC_URL="https://dl.min.io/client/mc/release/linux-amd64/mc"

if [ -f "$MARKER" ]; then
  echo "==> already initialized (skip)"
  exit 0
fi

echo "==> ensure mc client"
if ! [ -x "$MC" ]; then
  mkdir -p "$MC_DIR"
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$MC" "$MC_URL"
  else
    curl -fsSL "$MC_URL" -o "$MC"
  fi
  chmod +x "$MC"
fi

echo "==> configure alias"
"$MC" alias set local "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

for b in fakebook-test fakebook-images fakebook-profiles; do
  if "$MC" ls "local/${b}" >/dev/null 2>&1; then
    echo "==> bucket exists: $b (skip)"
  else
    echo "==> create bucket: $b"
    "$MC" mb "local/${b}" >/dev/null
  fi
  "$MC" anonymous set download "local/${b}" >/dev/null
done

touch "$MARKER"
echo "==> minio init done."
