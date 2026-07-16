#! /bin/sh

set -eu

MARKER="/data/.inited"
MC_DIR="/data/bin"
MC="$MC_DIR/mc"

if [ -f "$MARKER" ]; then
  echo "==> already initialized (skip)"
  exit 0
fi

echo "==> ensure mc client"
if ! [ -x "$MC" ]; then
  case "$(uname -m)" in
    x86_64|amd64)
      mc_platform="linux-amd64"
      ;;
    aarch64|arm64)
      mc_platform="linux-arm64"
      ;;
    *)
      echo "Unsupported architecture for MinIO Client: $(uname -m)" >&2
      exit 1
      ;;
  esac
  mc_url="https://dl.min.io/client/mc/release/${mc_platform}/mc"

  mkdir -p "$MC_DIR"
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$MC" "$mc_url"
  else
    curl -fsSL "$mc_url" -o "$MC"
  fi
  chmod +x "$MC"
fi

echo "==> configure alias"
"$MC" alias set local "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

for b in stgy-test stgy-images stgy-profiles stgy-tracks; do
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
