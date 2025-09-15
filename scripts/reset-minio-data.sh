#!/bin/bash

set -eu

docker compose exec -T minio sh -lc "
  mc alias set local 'http://localhost:9000' \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null
"

BUCKETS="stgy-test stgy-images stgy-profiles"

for b in $BUCKETS; do
  docker-compose exec -T minio sh -lc "
    mc rb --force local/$b >/dev/null 2>&1 || true
    mc mb local/$b >/dev/null 2>&1 || true
    mc anonymous set download local/$b >/dev/null 2>&1 || true
  "
  echo "reset bucket: $b"
done

echo "==> MinIO reset done."
