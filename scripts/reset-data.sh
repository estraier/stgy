#!/bin/bash

set -euo pipefail

set -a
source .env
set +a

docker compose exec -T postgres psql \
  -v ON_ERROR_STOP=1 \
  -U "$STGY_DATABASE_USER" \
  "$STGY_DATABASE_NAME" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

shopt -s nullglob
sql_files=(postgres/init/*.sql)
shopt -u nullglob

if [ "${#sql_files[@]}" -eq 0 ]; then
  echo "No PostgreSQL initialization files found in postgres/init." >&2
  exit 1
fi

for file in "${sql_files[@]}"; do
  docker compose exec -T postgres psql \
    -v ON_ERROR_STOP=1 \
    -U "$STGY_DATABASE_USER" \
    "$STGY_DATABASE_NAME" < "$file"
done

echo "==> Postgres reset done."
