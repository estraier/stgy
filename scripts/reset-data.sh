#!/bin/bash

set -a
source .env
set +a

docker compose exec postgres psql -U $STGY_DATABASE_USER $STGY_DATABASE_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

ls postgres/init/*.sql | sort | while read file ; do
  docker compose exec -T postgres psql -U $STGY_DATABASE_USER $STGY_DATABASE_NAME < $file
done

echo "==> Postgres reset done."
