#!/bin/bash

set -euo pipefail

set -a
source .env
set +a

docker compose exec -T postgres psql \
  -U "$STGY_DATABASE_USER" \
  "$STGY_DATABASE_NAME" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

mapfile -t sql_files < <(
  find postgres/init -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort
)

if (( ${#sql_files[@]} == 0 )); then
  echo "No PostgreSQL initialization files found in postgres/init." >&2
  exit 1
fi

for file in "${sql_files[@]}"; do
  docker compose exec -T postgres psql \
    -U "$STGY_DATABASE_USER" \
    "$STGY_DATABASE_NAME" < "$file"
done

echo "==> Postgres reset done."
