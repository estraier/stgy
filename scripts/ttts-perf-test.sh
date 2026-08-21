#!/bin/bash
set -euo pipefail

#
# 3TS volume benchmark for label / numeric filtering.
#
# Run from the STGY repository root.
#
# Dataset scale is intentionally identical to the benchmark in:
#   "ゼロから作るSNS その13: 超低コスト全文検索アーキテクチャ3TS"
#
#   1,000,000 documents
#   100,000 documents/shard
#   10 shards
#   200 words/document
#   vocabulary size = 10,000
#   gamma = 0.3
#
# Additional attributes for the new benchmark:
#
#   1,000 labels
#   => exactly 1,000 documents/label over all shards
#   => exactly   100 documents/label/shard
#
#   numericValue = global document index
#   => 0 ... 999999
#

BASE_DIR="${TTTS_BENCH_DIR:-/tmp/stgy-ttts-volume-benchmark-1m}"
LOG="${TTTS_BENCH_LOG:-ttts-volume-benchmark-$(date '+%Y%m%d-%H%M%S').log}"

DOCS_PER_SHARD=100000
SHARDS=10
WORDS_PER_DOC=200
VOCAB_SIZE=10000
GAMMA=0.3

LABEL_CARDINALITY=1000
LABEL="label:203"

LIMIT=100
TIMES=100

TOTAL_DOCS=$((DOCS_PER_SHARD * SHARDS))

NUMERIC_ALL=$((TOTAL_DOCS - 1))
NUMERIC_REJECT_1_SHARD=$((TOTAL_DOCS - DOCS_PER_SHARD - 1))
NUMERIC_REJECT_5_SHARDS=$((TOTAL_DOCS - DOCS_PER_SHARD * 5 - 1))
NUMERIC_REJECT_9_SHARDS=$((DOCS_PER_SHARD - 1))

exec > >(tee "$LOG") 2>&1

echo "============================================================"
echo "3TS 1M-document volume benchmark"
echo "============================================================"
echo "Date               : $(date)"
echo "Repository         : $(pwd)"
echo "Base directory     : $BASE_DIR"
echo "Documents          : $TOTAL_DOCS"
echo "Documents / shard  : $DOCS_PER_SHARD"
echo "Shards             : $SHARDS"
echo "Words / document   : $WORDS_PER_DOC"
echo "Vocabulary         : $VOCAB_SIZE"
echo "Gamma              : $GAMMA"
echo "Label cardinality  : $LABEL_CARDINALITY"
echo "Documents / label  : $((TOTAL_DOCS / LABEL_CARDINALITY))"
echo "Docs / label/shard : $((DOCS_PER_SHARD / LABEL_CARDINALITY))"
echo

echo "=== Machine ==="
sw_vers
echo "Architecture       : $(uname -m)"
echo "CPU                : $(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)"
MEM_BYTES="$(sysctl -n hw.memsize)"
awk -v n="$MEM_BYTES" 'BEGIN {
  printf "Memory             : %.1f GiB\n", n / 1073741824
}'
echo "Node               : $(node --version)"
echo

echo "=== Build ==="
npm run ttts:build

RUNNER=(node ttts/dist/runVolumeTest.js)

echo
echo "============================================================"
echo "PREPARE"
echo "============================================================"

"${RUNNER[@]}" prepare \
  --base-dir "$BASE_DIR" \
  --documents "$DOCS_PER_SHARD" \
  --iteration "$SHARDS" \
  --words "$WORDS_PER_DOC" \
  --vocab "$VOCAB_SIZE" \
  --gamma "$GAMMA" \
  --auto-commit 10000 \
  --record-positions false \
  --record-contents true \
  --label-cardinality "$LABEL_CARDINALITY" \
  --numeric-values


bench()
{
  title="$1"
  shift

  echo
  echo "============================================================"
  echo "$title"
  echo "============================================================"

  "${RUNNER[@]}" search \
    --base-dir "$BASE_DIR" \
    --limit "$LIMIT" \
    --times "$TIMES" \
    "$@"
}


count()
{
  title="$1"
  shift

  echo
  echo "------------------------------------------------------------"
  echo "COUNT: $title"
  echo "------------------------------------------------------------"

  "${RUNNER[@]}" search \
    --base-dir "$BASE_DIR" \
    --limit 0 \
    --times 1 \
    "$@"
}


echo
echo
echo "############################################################"
echo "# A. ORIGINAL 3TS QUERIES"
echo "#"
echo "# Same seven queries as the previous article."
echo "############################################################"

bench "A1. w0 / frequent term" \
  --query "w0"

bench "A2. w9999 / rare term" \
  --query "w9999"

bench "A3. nohit / nonexistent term" \
  --query "nohit"

bench "A4. w0 w1 / frequent AND frequent" \
  --query "w0 w1"

bench "A5. w0 w9999 / frequent AND rare" \
  --query "w0 w9999"

bench "A6. w8000 w9000 / rare AND rare" \
  --query "w8000 w9000"

bench "A7. w0 nohit / frequent AND nonexistent" \
  --query "w0 nohit"


echo
echo
echo "############################################################"
echo "# B. SAME QUERIES WITH LABEL FILTER"
echo "#"
echo "# label:203 exists in exactly 1,000 documents:"
echo "#   100 documents in each shard."
echo "#"
echo "# This measures both:"
echo "#   - the benefit of the small label posting list as leader"
echo "#   - the cost of losing shard-level early termination when"
echo "#     the final intersection becomes sparse"
echo "############################################################"

bench "B1. w0 + label" \
  --query "w0" \
  --label "$LABEL"

bench "B2. w9999 + label" \
  --query "w9999" \
  --label "$LABEL"

bench "B3. nohit + label" \
  --query "nohit" \
  --label "$LABEL"

bench "B4. w0 w1 + label" \
  --query "w0 w1" \
  --label "$LABEL"

bench "B5. w0 w9999 + label" \
  --query "w0 w9999" \
  --label "$LABEL"

bench "B6. w8000 w9000 + label" \
  --query "w8000 w9000" \
  --label "$LABEL"

bench "B7. w0 nohit + label" \
  --query "w0 nohit" \
  --label "$LABEL"


echo
echo
echo "############################################################"
echo "# C. NUMERIC FILTER"
echo "#"
echo "# numericValue = global document index."
echo "#"
echo "# C1: all documents pass."
echo "# C2: newest 1 shard is rejected."
echo "# C3: newest 5 shards are rejected."
echo "# C4: newest 9 shards are rejected."
echo "#"
echo "# w0 is used because it is extremely frequent. Therefore the"
echo "# cost here is dominated by the numeric post-filter and by how"
echo "# many shards must be traversed before 100 valid hits are found."
echo "############################################################"

bench "C1. w0 + numeric / all pass" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_ALL"

bench "C2. w0 + numeric / newest 1 shard rejected" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_1_SHARD"

bench "C3. w0 + numeric / newest 5 shards rejected" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_5_SHARDS"

bench "C4. w0 + numeric / newest 9 shards rejected" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_9_SHARDS"


echo
echo
echo "############################################################"
echo "# D. LABEL + NUMERIC FILTER"
echo "#"
echo "# Same numeric conditions as C, but the FTS5 label condition"
echo "# first restricts each shard to about 100 documents."
echo "#"
echo "# Comparing C and D shows how much the label posting list"
echo "# reduces work before numericValue is checked."
echo "############################################################"

bench "D1. w0 + label + numeric / all pass" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_ALL"

bench "D2. w0 + label + numeric / newest 1 shard rejected" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_1_SHARD"

bench "D3. w0 + label + numeric / newest 5 shards rejected" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_5_SHARDS"

bench "D4. w0 + label + numeric / newest 9 shards rejected" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_9_SHARDS"


echo
echo
echo "############################################################"
echo "# E. TRUE HIT COUNTS"
echo "#"
echo "# Run after timing so full-result scans do not warm the cache"
echo "# before the benchmarks."
echo "############################################################"

count "w0" \
  --query "w0"

count "w9999" \
  --query "w9999"

count "nohit" \
  --query "nohit"

count "w0 w1" \
  --query "w0 w1"

count "w0 w9999" \
  --query "w0 w9999"

count "w8000 w9000" \
  --query "w8000 w9000"

count "w0 nohit" \
  --query "w0 nohit"


count "w0 + label" \
  --query "w0" \
  --label "$LABEL"

count "w9999 + label" \
  --query "w9999" \
  --label "$LABEL"

count "w0 w1 + label" \
  --query "w0 w1" \
  --label "$LABEL"

count "w0 w9999 + label" \
  --query "w0 w9999" \
  --label "$LABEL"

count "w8000 w9000 + label" \
  --query "w8000 w9000" \
  --label "$LABEL"


count "w0 + numeric / all pass" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_ALL"

count "w0 + numeric / newest 1 shard rejected" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_1_SHARD"

count "w0 + numeric / newest 5 shards rejected" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_5_SHARDS"

count "w0 + numeric / newest 9 shards rejected" \
  --query "w0" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_9_SHARDS"


count "w0 + label + numeric / all pass" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_ALL"

count "w0 + label + numeric / newest 1 shard rejected" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_1_SHARD"

count "w0 + label + numeric / newest 5 shards rejected" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_5_SHARDS"

count "w0 + label + numeric / newest 9 shards rejected" \
  --query "w0" \
  --label "$LABEL" \
  --numeric-op lte \
  --numeric-value "$NUMERIC_REJECT_9_SHARDS"


echo
echo
echo "============================================================"
echo "DONE"
echo "============================================================"
echo "Log             : $LOG"
echo "Index directory : $BASE_DIR"
