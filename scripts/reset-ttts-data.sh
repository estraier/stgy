#!/bin/bash

SEARCH_HOST="http://localhost:3200"
RESOURCES=("posts" "users")

echo "Resetting search index for: ${RESOURCES[*]} at ${SEARCH_HOST} ..."

for RESOURCE in "${RESOURCES[@]}"; do
  echo "--------------------------------------------------"
  echo "Target Resource: $RESOURCE"
  echo "  -> Fetching shard list ..."
  SHARDS_JSON=$(curl -s "${SEARCH_HOST}/${RESOURCE}/shards")
  if [[ -z "$SHARDS_JSON" ]] || [[ "$SHARDS_JSON" != \[* ]]; then
    echo "     Error or no response from server. Is ttts running?"
    echo "     Response: $SHARDS_JSON"
    continue
  fi
  TIMESTAMPS=$(echo "$SHARDS_JSON" | jq -r '.[].startTimestamp // empty')
  if [ -z "$TIMESTAMPS" ]; then
    echo "     No shards found."
  else
    for TS in $TIMESTAMPS; do
      echo "  -> Deleting shard: $TS ..."
      DELETE_RES=$(curl -s -X DELETE "${SEARCH_HOST}/${RESOURCE}/shards/${TS}?wait=60")
      echo "     $DELETE_RES"
    done
  fi
done

echo "--------------------------------------------------"
echo "==> Search server reset done."
