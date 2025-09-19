#! /bin/bash

set -euo pipefail

set -a
[ -f .env ] && source .env
set +a

export STGY_DATABASE_HOST=localhost
export STGY_REDIS_HOST=localhost

npm run backend:database-util $@
