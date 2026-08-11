#!/bin/bash

set -euo pipefail

MODE=docker
SINCE='2000-01-01 00:00:00'
OUTPUT=''
ALLOW_POSTS=false
CARRYOVER_SCHEMA='stgy_user_carryover'
CARRYOVER_BUCKET='stgy-live-user-carryover'

usage() {
  cat <<__EOF__
Usage: $0 [--mode docker|native] [--since TIMESTAMP] [--output DIR] [--allow-posts]

Exports users registered on or after TIMESTAMP so they can be restored after
reset-service-data.sh. The default TIMESTAMP is 2000-01-01 00:00:00.

The export contains users, user_secrets (including password hashes),
user_details, user_pub_configs, and the agreement terms referenced by those
users. Profile objects are copied inside MinIO to a carryover bucket that is not
removed by reset-minio-data.sh. Users' posts and social/activity data are not
exported.

Options:
  --mode docker|native   Database/MinIO access mode (default: docker)
  --since TIMESTAMP     Registration cutoff (default: $SINCE)
  --output DIR          Output directory (default: backup/live-users-YYYYMMDD-HHMMSS)
  --allow-posts         Allow selected users to own posts (posts are still NOT exported)
  -h, --help            Show this help
__EOF__
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      [ "$#" -ge 2 ] || { echo "Missing value for --mode" >&2; exit 2; }
      MODE="$2"
      shift 2
      ;;
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    --since)
      [ "$#" -ge 2 ] || { echo "Missing value for --since" >&2; exit 2; }
      SINCE="$2"
      shift 2
      ;;
    --since=*)
      SINCE="${1#*=}"
      shift
      ;;
    --output)
      [ "$#" -ge 2 ] || { echo "Missing value for --output" >&2; exit 2; }
      OUTPUT="$2"
      shift 2
      ;;
    --output=*)
      OUTPUT="${1#*=}"
      shift
      ;;
    --allow-posts)
      ALLOW_POSTS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  docker|native) ;;
  *)
    echo "Invalid mode: $MODE (expected docker or native)" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

set -a
[ -f .env ] && source .env
set +a

if [ -z "$OUTPUT" ]; then
  OUTPUT="backup/live-users-$(date '+%Y%m%d-%H%M%S')"
fi
if [ -e "$OUTPUT" ]; then
  echo "Output already exists: $OUTPUT" >&2
  exit 1
fi
mkdir -p "$OUTPUT"
chmod 700 "$OUTPUT"

run_psql() {
  if [ "$MODE" = docker ]; then
    docker compose exec -T postgres psql \
      -X -q -v ON_ERROR_STOP=1 \
      -U "$STGY_DATABASE_USER" \
      "$STGY_DATABASE_NAME" "$@"
  else
    PGPASSWORD="$STGY_DATABASE_PASSWORD" psql \
      -X -q \
      -h 127.0.0.1 \
      -p "${STGY_DATABASE_PORT:-5432}" \
      -v ON_ERROR_STOP=1 \
      -U "$STGY_DATABASE_USER" \
      "$STGY_DATABASE_NAME" "$@"
  fi
}

run_pg_dump_schema() {
  if [ "$MODE" = docker ]; then
    docker compose exec -T postgres pg_dump \
      -U "$STGY_DATABASE_USER" \
      -d "$STGY_DATABASE_NAME" \
      -F c --no-owner --no-privileges \
      -n "$CARRYOVER_SCHEMA"
  else
    PGPASSWORD="$STGY_DATABASE_PASSWORD" pg_dump \
      -h 127.0.0.1 \
      -p "${STGY_DATABASE_PORT:-5432}" \
      -U "$STGY_DATABASE_USER" \
      -d "$STGY_DATABASE_NAME" \
      -F c --no-owner --no-privileges \
      -n "$CARRYOVER_SCHEMA"
  fi
}

minio_cmd() {
  if [ "$MODE" = docker ]; then
    docker compose exec -T minio sh -eu -c '
      mc alias set carrylocal "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
      exec mc "$@"
    ' sh "$@"
  else
    mc alias set carrylocal \
      "http://127.0.0.1:${STGY_MINIO_PORT:-9000}" \
      "$STGY_MINIO_ROOT_USER" \
      "$STGY_MINIO_ROOT_PASSWORD" >/dev/null
    mc "$@"
  fi
}

run_psql_since_scalar() {
  # psql variable interpolation is performed for SQL read from stdin.  Do not
  # use -c here: some psql versions pass :'since' through to PostgreSQL
  # unchanged when processing a -c argument.
  printf '%s\n' "$1" | run_psql -At -v since="$SINCE"
}

# Validate the timestamp before doing anything destructive to the previous carryover schema.
run_psql_since_scalar "SELECT :'since'::timestamptz;" >/dev/null

USER_COUNT="$(run_psql_since_scalar \
  "SELECT count(*) FROM public.users WHERE id >= public.timestamp_to_id_min(:'since'::timestamptz);")"

printf 'Found %s user(s) registered since %s.\n' "$USER_COUNT" "$SINCE"

SECRET_COUNT="$(run_psql_since_scalar \
  "SELECT count(*) FROM public.user_secrets s JOIN public.users u ON u.id = s.user_id WHERE u.id >= public.timestamp_to_id_min(:'since'::timestamptz);")"
DETAIL_COUNT="$(run_psql_since_scalar \
  "SELECT count(*) FROM public.user_details d JOIN public.users u ON u.id = d.user_id WHERE u.id >= public.timestamp_to_id_min(:'since'::timestamptz);")"
if [ "$SECRET_COUNT" -ne "$USER_COUNT" ] || [ "$DETAIL_COUNT" -ne "$USER_COUNT" ]; then
  echo "Refusing to export: selected users do not have a complete user_secrets/user_details row set." >&2
  echo "users=$USER_COUNT user_secrets=$SECRET_COUNT user_details=$DETAIL_COUNT" >&2
  exit 1
fi

POST_COUNT="$(run_psql_since_scalar \
  "SELECT count(*) FROM public.posts p JOIN public.users u ON u.id = p.owned_by WHERE u.id >= public.timestamp_to_id_min(:'since'::timestamptz);")"
if [ "$POST_COUNT" -ne 0 ] && [ "$ALLOW_POSTS" != true ]; then
  echo "Refusing to export: selected users own $POST_COUNT post(s), but this tool carries user information only." >&2
  echo "Use --allow-posts only if losing those posts is intentional." >&2
  exit 1
fi

run_psql -v since="$SINCE" <<'SQL'
BEGIN;
DROP SCHEMA IF EXISTS stgy_user_carryover CASCADE;
CREATE SCHEMA stgy_user_carryover;

CREATE TABLE stgy_user_carryover.metadata (
  since timestamptz NOT NULL,
  exported_at timestamptz NOT NULL,
  user_count bigint NOT NULL
);
INSERT INTO stgy_user_carryover.metadata
SELECT :'since'::timestamptz, now(), count(*)
FROM public.users
WHERE id >= public.timestamp_to_id_min(:'since'::timestamptz);

CREATE TABLE stgy_user_carryover.users AS
SELECT u.*
FROM public.users u
WHERE u.id >= public.timestamp_to_id_min(:'since'::timestamptz);

CREATE TABLE stgy_user_carryover.user_secrets AS
SELECT s.*
FROM public.user_secrets s
JOIN stgy_user_carryover.users u ON u.id = s.user_id;

CREATE TABLE stgy_user_carryover.user_details AS
SELECT d.*
FROM public.user_details d
JOIN stgy_user_carryover.users u ON u.id = d.user_id;

CREATE TABLE stgy_user_carryover.user_pub_configs AS
SELECT c.*
FROM public.user_pub_configs c
JOIN stgy_user_carryover.users u ON u.id = c.user_id;

CREATE TABLE stgy_user_carryover.user_agreement_terms AS
SELECT t.*
FROM public.user_agreement_terms t
WHERE t.id IN (
  SELECT DISTINCT s.user_agreement_term_id
  FROM stgy_user_carryover.user_secrets s
  WHERE s.user_agreement_term_id IS NOT NULL
);
COMMIT;
SQL

printf 'id\temail\tnickname\tcreated_at\tlocale\ttimezone\tavatar\n' > "$OUTPUT/manifest.tsv"
run_psql -At -F $'\t' -c "
  SELECT
    lpad(upper(to_hex(u.id)), 16, '0'),
    s.email,
    u.nickname,
    public.id_to_timestamp(u.id),
    u.locale,
    u.timezone,
    coalesce(u.avatar, '')
  FROM stgy_user_carryover.users u
  JOIN stgy_user_carryover.user_secrets s ON s.user_id = u.id
  ORDER BY u.id;
" >> "$OUTPUT/manifest.tsv"

TOKEN="live-users-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
printf '%s\n' "$SINCE" > "$OUTPUT/since.txt"
printf '%s\n' "$USER_COUNT" > "$OUTPUT/user-count.txt"
printf '%s\n' "$TOKEN" > "$OUTPUT/minio-prefix.txt"
printf '%s\n' "$CARRYOVER_BUCKET" > "$OUTPUT/minio-bucket.txt"
: > "$OUTPUT/profiles.txt"
chmod 600 "$OUTPUT"/*.txt "$OUTPUT/manifest.tsv"

# Keep an external custom-format PostgreSQL dump as a second copy. The live
# carryover schema itself survives `DROP SCHEMA public CASCADE`.
run_pg_dump_schema > "$OUTPUT/users.dump"
chmod 600 "$OUTPUT/users.dump"

minio_cmd mb --ignore-existing "carrylocal/$CARRYOVER_BUCKET" >/dev/null

PROFILE_COUNT=0
while IFS=$'\t' read -r ID_HEX AVATAR; do
  [ -n "$ID_HEX" ] || continue
  [ -n "$AVATAR" ] || continue

  BUCKET="${AVATAR%%/*}"
  KEY="${AVATAR#*/}"
  STORAGE_ID="${KEY%%/*}"
  if [ "$BUCKET" != "stgy-profiles" ] || [ -z "$STORAGE_ID" ] || [ "$KEY" = "$AVATAR" ]; then
    echo "Invalid avatar object reference for $ID_HEX: $AVATAR" >&2
    exit 1
  fi

  if ! minio_cmd stat "carrylocal/$AVATAR" >/dev/null; then
    echo "Avatar referenced by the database is missing: $AVATAR" >&2
    exit 1
  fi

  minio_cmd mirror --overwrite --preserve \
    "carrylocal/stgy-profiles/$STORAGE_ID/" \
    "carrylocal/$CARRYOVER_BUCKET/$TOKEN/profiles/$STORAGE_ID/" >/dev/null
  printf '%s\n' "$AVATAR" >> "$OUTPUT/profiles.txt"
  PROFILE_COUNT=$((PROFILE_COUNT + 1))
done <<__PROFILE_ROWS__
$(run_psql -At -F $'\t' -c "
  SELECT lpad(upper(to_hex(id)), 16, '0'), avatar
  FROM stgy_user_carryover.users
  WHERE avatar IS NOT NULL
  ORDER BY id;
")
__PROFILE_ROWS__

cat > "$OUTPUT/README.txt" <<__EOF__
STGY live-user carryover export

Created: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
Registration cutoff: $SINCE
Users: $USER_COUNT
Owned posts: $POST_COUNT
Profile avatars: $PROFILE_COUNT
Database carryover schema: $CARRYOVER_SCHEMA
MinIO carryover bucket: $CARRYOVER_BUCKET
MinIO carryover prefix: $TOKEN

This export intentionally does NOT preserve posts, follows, blocks, likes,
notifications, sessions, counters, AI impressions, or search-index tasks.

Restore after `npm run vps:reset-data` with:
  ./scripts/import-live-users.sh "$OUTPUT"

users.dump contains password hashes and must be kept private.
__EOF__
chmod 600 "$OUTPUT/README.txt"

printf '\nExported %s user(s) registered since %s.\n' "$USER_COUNT" "$SINCE"
printf 'Owned posts: %s\n' "$POST_COUNT"
printf 'Profile avatars copied: %s\n' "$PROFILE_COUNT"
printf 'Manifest: %s/manifest.tsv\n' "$OUTPUT"
printf 'Database backup: %s/users.dump\n' "$OUTPUT"
printf 'MinIO carryover: %s/%s\n' "$CARRYOVER_BUCKET" "$TOKEN"
printf '\nReview the manifest before resetting production:\n  cat %q\n' "$OUTPUT/manifest.tsv"
