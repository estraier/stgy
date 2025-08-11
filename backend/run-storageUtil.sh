#! /bin/bash

set -a
source ../.env
set +a

export FAKEBOOK_STORAGE_S3_ENDPOINT=http://localhost:9000

set -eux

ts-node src/storageUtil.ts $@
