#! /bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

set -a
[ -f .env ] && source .env
set +a

MINIO_PORT="${STGY_MINIO_PORT:-9000}"
if ! [[ "$MINIO_PORT" =~ ^[0-9]+$ ]] || (( MINIO_PORT < 1 || MINIO_PORT > 65535 )); then
    echo "invalid STGY_MINIO_PORT: $MINIO_PORT" >&2
    exit 1
fi
export STGY_STORAGE_S3_ENDPOINT="http://localhost:${MINIO_PORT}"

run_storage_util() {
    npm run storage-util --workspace backend -- "$@"
}

if [ $# -eq 1 ] && [ $1 = "volume" ]
then
    i=0
    while [ $i -lt 333 ] ; do
        i=$((i+1))
        name=$(printf "test-%05d.json" $i)
        echo "$name"
        run_storage_util save "stgy-test:/$name" package.json
    done
    exit
fi

if [ $# -eq 1 ] && [ $1 = "test" ]
then
   run_storage_util save stgy-test:/test-package.json package.json
   run_storage_util head stgy-test:/test-package.json
   run_storage_util list stgy-test:/test-package
   run_storage_util load stgy-test:/test-package.json tmp-package.json
   diff backend/package.json backend/tmp-package.json
   run_storage_util delete stgy-test:/test-package.json
   run_storage_util list stgy-test:/test-package
   run_storage_util presigned-post stgy-test:/test-package.json tmp-package.json
   run_storage_util head stgy-test:/test-package.json
   run_storage_util copy stgy-test:/test-package.json stgy-test:/test-package-copied.json
   run_storage_util head stgy-test:/test-package-copied.json
   run_storage_util move stgy-test:/test-package-copied.json stgy-test:/test-package-moved.json
   run_storage_util head stgy-test:/test-package-moved.json
   run_storage_util delete stgy-test:/test-package.json
   run_storage_util delete stgy-test:/test-package-moved.json
   rm -f backend/tmp-package.json
   exit
fi

run_storage_util "$@"
