#!/bin/bash

set -a
source .env
set +a

SEARCH_HOST="http://localhost:${STGY_SEARCH_PORT}"
RESOURCES=("posts" "users")

echo "Resetting search index for: ${RESOURCES[*]} ..."

for RESOURCE in "${RESOURCES[@]}"; do
  echo "--------------------------------------------------"
  echo "Target Resource: $RESOURCE"
  echo "  -> Starting maintenance mode ..."
  curl -s -X POST "${SEARCH_HOST}/${RESOURCE}/maintenance" > /dev/null
  echo "  -> Deleting all shards ..."
  DELETE_RES=$(curl -s -X DELETE "${SEARCH_HOST}/${RESOURCE}/shards")
  echo "     $DELETE_RES"
  echo "  -> Ending maintenance mode ..."
  curl -s -X DELETE "${SEARCH_HOST}/${RESOURCE}/maintenance" > /dev/null
done

echo "--------------------------------------------------"
echo "==> Search server reset done."
