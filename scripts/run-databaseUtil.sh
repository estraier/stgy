#! /bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

set -a
[ -f .env ] && source .env
set +a

export STGY_DATABASE_HOST=localhost
export STGY_REDIS_HOST=localhost

npm run --silent backend:database-util -- "$@"
