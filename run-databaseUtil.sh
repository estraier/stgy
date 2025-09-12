#! /bin/bash

set -euo pipefail

set -a
[ -f .env ] && source .env
set +a

export FAKEBOOK_DATABASE_HOST=localhost
export FAKEBOOK_REDIS_HOST=localhost

npm run backend:database-util $@
