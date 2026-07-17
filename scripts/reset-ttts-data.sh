#!/bin/bash

set -euo pipefail

SEARCH_HOST="http://localhost:3200"
RESOURCES=("posts" "users")

echo "Resetting search index for: ${RESOURCES[*]} at ${SEARCH_HOST} ..."

for RESOURCE in "${RESOURCES[@]}"; do
  echo "--------------------------------------------------"
  echo "Target Resource: $RESOURCE"
  echo "  -> Fetching shard list ..."

  SHARDS_JSON=$(curl --fail --silent --show-error \
    "${SEARCH_HOST}/${RESOURCE}/shards")

  if ! jq -e 'type == "array" and all(.[]; (.startTimestamp | type) == "number")' \
    >/dev/null <<<"$SHARDS_JSON"; then
    echo "     Invalid shard-list response: $SHARDS_JSON" >&2
    exit 1
  fi

  if [ "$(jq 'length' <<<"$SHARDS_JSON")" -eq 0 ]; then
    echo "     No shards found."
    continue
  fi

  while IFS= read -r TS; do
    echo "  -> Deleting shard: $TS ..."
    DELETE_RES=$(curl --fail --silent --show-error -X DELETE \
      "${SEARCH_HOST}/${RESOURCE}/shards/${TS}?wait=60")
    if ! jq -e '.result == "enqueued" and (.taskId | type) == "string"' \
      >/dev/null <<<"$DELETE_RES"; then
      echo "     Invalid delete response: $DELETE_RES" >&2
      exit 1
    fi
    echo "     $DELETE_RES"
  done < <(jq -r '.[].startTimestamp' <<<"$SHARDS_JSON")
done

echo "--------------------------------------------------"
echo "==> Search server reset done."
