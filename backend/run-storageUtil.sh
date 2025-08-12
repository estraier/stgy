#! /bin/bash

set -a
source ../.env
set +a

export FAKEBOOK_STORAGE_S3_ENDPOINT=http://localhost:9000

set -eux

if [ $1 = "volume" ]
then
    i=0
    while [ $i -lt 333 ] ; do
        i=$((i+1))
        name=$(printf "test-%05d.json" $i)
        echo $name
        ts-node src/storageUtil.ts save fakebook-test:/$name package.json
    done
    exit
fi

if [ $1 = "test" ]
then
   ts-node src/storageUtil.ts save fakebook-test:/test-package.json package.json
   ts-node src/storageUtil.ts head fakebook-test:/test-package.json package.json
   ts-node src/storageUtil.ts list fakebook-test:/test-package
   ts-node src/storageUtil.ts load fakebook-test:/test-package.json tmp-package.json
   diff package.json tmp-package.json
   ts-node src/storageUtil.ts delete fakebook-test:/test-package.json
   ts-node src/storageUtil.ts list fakebook-test:/test-package
   ts-node src/storageUtil.ts presigned-post fakebook-test:/test-package.json tmp-package.json
   ts-node src/storageUtil.ts head fakebook-test:/test-package.json package.json
   ts-node src/storageUtil.ts delete fakebook-test:/test-package.json
   rm -f tmp-package.json
   exit
fi

ts-node src/storageUtil.ts $@
