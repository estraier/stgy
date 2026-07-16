#!/bin/bash

set -euo pipefail

docker compose exec -T minio sh -eu -c '
  mc alias set local "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
'

readonly BUCKETS=(stgy-test stgy-images stgy-profiles stgy-tracks)

for bucket in "${BUCKETS[@]}"; do
  docker compose exec -T minio sh -eu -c '
    bucket="$1"
    mc rb --force "local/$bucket" >/dev/null 2>&1 || true
    mc mb "local/$bucket" >/dev/null
    mc anonymous set download "local/$bucket" >/dev/null
  ' sh "$bucket"
  echo "reset bucket: $bucket"
done

echo "==> MinIO reset done."
