#! /bin/bash

set -euo pipefail

set -a
[ -f ../.env ] && source ../.env
set +a

export FAKEBOOK_FRONTEND_HOST=localhost
export FAKEBOOK_BACKEND_HOST=localhost
export FAKEBOOK_DATABASE_HOST=localhost
export FAKEBOOK_MINIO_HOST=localhost
export FAKEBOOK_STORAGE_S3_ENDPOINT=http://localhost:9000
export FAKEBOOK_REDIS_HOST=localhost
export FAKEBOOK_SMTP_HOST=localhost

cleanup() {
  trap - INT TERM EXIT
  kill 0 >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

npm run mail-worker &
npm run media-worker &
npm run notification-worker &

npm run dev
