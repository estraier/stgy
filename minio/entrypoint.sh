#! /bin/sh

set -eu

"$@" &
pid=$!

echo "==> waiting for MinIO to be ready..."
i=0
until curl -fsS http://localhost:9000/minio/health/ready >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -gt 180 ]; then
    echo "MinIO not ready (timeout)" >&2
    kill "$pid" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

/init.sh

wait "$pid"
