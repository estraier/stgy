#!/bin/bash

set -a
source .env
set +a

docker-compose exec redis redis-cli -a $STGY_REDIS_PASSWORD FLUSHALL

echo "==> Redis reset done."
