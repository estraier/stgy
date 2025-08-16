#!/bin/bash

set -a
source .env
set +a

docker-compose exec redis redis-cli -a $FAKEBOOK_REDIS_PASSWORD FLUSHALL

echo "==> Redis reset done."

docker-compose exec db psql -U $FAKEBOOK_DATABASE_USER $FAKEBOOK_DATABASE_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

docker-compose exec -T db psql -U $FAKEBOOK_DATABASE_USER $FAKEBOOK_DATABASE_NAME < db/init/01-schema.sql
docker-compose exec -T db psql -U $FAKEBOOK_DATABASE_USER $FAKEBOOK_DATABASE_NAME < db/init/02-basic-data.sql
docker-compose exec -T db psql -U $FAKEBOOK_DATABASE_USER $FAKEBOOK_DATABASE_NAME < db/init/03-help-posts-ja.sql

echo "==> Postgres reset done."
