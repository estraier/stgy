#!/bin/bash

set -euo pipefail

set -a
source .env
set +a

docker compose exec -T redis redis-cli -a "$STGY_REDIS_PASSWORD" FLUSHALL

echo "==> Redis reset done."
