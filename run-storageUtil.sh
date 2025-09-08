#! /bin/bash

set -euo pipefail

set -a
[ -f .env ] && source .env
set +a

export FAKEBOOK_STORAGE_S3_ENDPOINT=http://localhost:9000

if [ $# -eq 1 ] && [ $1 = "volume" ]
then
    i=0
    while [ $i -lt 333 ] ; do
        i=$((i+1))
        name=$(printf "test-%05d.json" $i)
        echo $name
        npm run backend:storage-util save fakebook-test:/$name package.json
    done
    exit
fi

if [ $# -eq 1 ] && [ $1 = "test" ]
then
   npm run backend:storage-util save fakebook-test:/test-package.json package.json
   npm run backend:storage-util head fakebook-test:/test-package.json
   npm run backend:storage-util list fakebook-test:/test-package
   npm run backend:storage-util load fakebook-test:/test-package.json tmp-package.json
   diff backend/package.json backend/tmp-package.json
   npm run backend:storage-util delete fakebook-test:/test-package.json
   npm run backend:storage-util list fakebook-test:/test-package
   npm run backend:storage-util presigned-post fakebook-test:/test-package.json tmp-package.json
   npm run backend:storage-util head fakebook-test:/test-package.json
   npm run backend:storage-util copy fakebook-test:/test-package.json fakebook-test:/test-package-copied.json
   npm run backend:storage-util head fakebook-test:/test-package-copied.json
   npm run backend:storage-util move fakebook-test:/test-package-copied.json fakebook-test:/test-package-moved.json
   npm run backend:storage-util head fakebook-test:/test-package-moved.json
   npm run backend:storage-util delete fakebook-test:/test-package.json
   npm run backend:storage-util delete fakebook-test:/test-package-moved.json
   rm -f backend/tmp-package.json
   exit
fi

npm run backend:storage-util $@
