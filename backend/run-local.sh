#! /bin/bash
set -a
source ../.env
set +a

export FAKEBOOK_FRONTEND_HOST=localhost
export FAKEBOOK_BACKEND_HOST=localhost
export FAKEBOOK_DATABASE_HOST=localhost
export FAKEBOOK_MINIO_HOST=localhost
export FAKEBOOK_REDIS_HOST=localhost
export FAKEBOOK_SMTP_HOST=localhost

npm run mail-worker &
MAIL_PID=$!

npm run dev

trap "kill $MAIL_PID" EXIT
