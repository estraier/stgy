#!/bin/bash

set -a
source .env
set +a

docker compose exec db psql -U $STGY_DATABASE_USER $STGY_DATABASE_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

ls db/init/*.sql | sort | while read file ; do
  docker compose exec -T db psql -U $STGY_DATABASE_USER $STGY_DATABASE_NAME < $file
done

echo "==> Postgres reset done."
