#!/bin/bash

set -a
source .env
set +a

#docker-compose exec redis redis-cli -a $FAKEBOOK_REDIS_PASSWORD FLUSHALL

echo "==> Redis reset done."

docker-compose exec db psql -U $FAKEBOOK_DATABASE_USER $FAKEBOOK_DATABASE_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

ls db/init/*.sql | sort | while read file ; do
  docker-compose exec -T db psql -U $FAKEBOOK_DATABASE_USER $FAKEBOOK_DATABASE_NAME < $file
done

echo "==> Postgres reset done."
