#!/bin/bash

set -a
source .env
set +a

SEARCH_HOST="http://localhost:${STGY_SEARCH_PORT}"
# リセット対象のリソース一覧
RESOURCES=("posts" "users")

echo "Resetting search index for: ${RESOURCES[*]} ..."

for RESOURCE in "${RESOURCES[@]}"; do
  echo "--------------------------------------------------"
  echo "Target Resource: $RESOURCE"

  URL="${SEARCH_HOST}/${RESOURCE}/shards"

  echo "Fetching shard list from $URL ..."
  RESPONSE=$(curl -s "$URL")
  TIMESTAMPS=$(echo "$RESPONSE" | jq -r '.[].startTimestamp' 2>/dev/null)
  if [ -z "$TIMESTAMPS" ]; then
    echo "  -> No shards found or invalid response."
    continue
  fi

  for TS in $TIMESTAMPS; do
    echo "  -> Deleting shard: $TS"
    DELETE_RES=$(curl -s -X DELETE "${URL}/${TS}")
    echo "     $DELETE_RES"
  done
done

echo "--------------------------------------------------"
echo "==> Search server reset done."
