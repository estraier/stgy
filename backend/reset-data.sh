#!/bin/bash

set -a
source ../.env
set +a

docker-compose exec redis redis-cli -a $FAKEBOOK_REDIS_PASSWORD FLUSHALL

docker-compose exec db psql -U $FAKEBOOK_DATABASE_USER $FAKEBOOK_DATABASE_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

for f in ../db/init/*.sql; do
  echo "Applying $f"
  docker-compose exec -T db psql -U fakebook fakebook < "$f"
done
