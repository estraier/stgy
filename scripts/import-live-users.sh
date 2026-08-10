#!/bin/bash

set -euo pipefail

MODE=docker
NO_SEARCH_RESET=false
CARRYOVER_SCHEMA='stgy_user_carryover'
INPUT=''

usage() {
  cat <<__EOF__
Usage: $0 [--mode docker|native] [--no-search-reset] EXPORT_DIR

Restores the users saved by export-live-users.sh after reset-service-data.sh.
The restore preserves IDs, emails, password hashes, profile data, publication
settings, agreement acceptance, and avatar objects. It does not restore posts
or social/activity data.

By default the user full-text search index is rebuilt after the database and
profile restore succeeds.

Options:
  --mode docker|native   Database/MinIO access mode (default: docker)
  --no-search-reset      Do not rebuild the user search index automatically
  -h, --help             Show this help
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
    --no-search-reset)
      NO_SEARCH_RESET=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$INPUT" ]; then
        echo "Unexpected argument: $1" >&2
        usage >&2
        exit 2
      fi
      INPUT="$1"
      shift
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

if [ -z "$INPUT" ]; then
  usage >&2
  exit 2
fi
if [ ! -d "$INPUT" ]; then
  echo "Export directory not found: $INPUT" >&2
  exit 1
fi
for f in manifest.tsv users.dump user-count.txt minio-prefix.txt minio-bucket.txt profiles.txt; do
  if [ ! -f "$INPUT/$f" ]; then
    echo "Missing export file: $INPUT/$f" >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

set -a
[ -f .env ] && source .env
set +a

EXPECTED_USERS="$(cat "$INPUT/user-count.txt")"
MINIO_PREFIX="$(cat "$INPUT/minio-prefix.txt")"
MINIO_BUCKET="$(cat "$INPUT/minio-bucket.txt")"

if ! printf '%s' "$EXPECTED_USERS" | grep -Eq '^[1-9][0-9]*$'; then
  echo "Invalid user-count.txt: $EXPECTED_USERS" >&2
  exit 1
fi
if [ -z "$MINIO_PREFIX" ] || [ -z "$MINIO_BUCKET" ]; then
  echo "Invalid MinIO carryover metadata." >&2
  exit 1
fi

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

run_pg_restore_stdin() {
  if [ "$MODE" = docker ]; then
    docker compose exec -T postgres pg_restore \
      -U "$STGY_DATABASE_USER" \
      -d "$STGY_DATABASE_NAME" \
      --no-owner --no-privileges
  else
    PGPASSWORD="$STGY_DATABASE_PASSWORD" pg_restore \
      -h 127.0.0.1 \
      -p "${STGY_DATABASE_PORT:-5432}" \
      -U "$STGY_DATABASE_USER" \
      -d "$STGY_DATABASE_NAME" \
      --no-owner --no-privileges
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

SCHEMA_EXISTS="$(run_psql -At -c "SELECT CASE WHEN to_regnamespace('$CARRYOVER_SCHEMA') IS NULL THEN 0 ELSE 1 END;")"
if [ "$SCHEMA_EXISTS" -eq 0 ]; then
  echo "Carryover schema is not present; restoring it from $INPUT/users.dump ..."
  run_pg_restore_stdin < "$INPUT/users.dump"
fi

CARRY_COUNT="$(run_psql -At -c "SELECT count(*) FROM $CARRYOVER_SCHEMA.users;")"
if [ "$CARRY_COUNT" -ne "$EXPECTED_USERS" ]; then
  echo "Carryover user count mismatch: expected $EXPECTED_USERS, found $CARRY_COUNT" >&2
  exit 1
fi

# Preflight: an already-restored row is allowed only when it is identical.
# This makes the import resumable if a later MinIO/search step failed previously.
run_psql <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM stgy_user_carryover.users c
    JOIN public.users u ON u.id = c.id
    WHERE to_jsonb(u) IS DISTINCT FROM to_jsonb(c)
  ) THEN
    RAISE EXCEPTION 'a carryover user ID exists with different data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stgy_user_carryover.user_secrets c
    JOIN public.user_secrets s ON s.user_id = c.user_id
    WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(c)
  ) THEN
    RAISE EXCEPTION 'a carryover user secret exists with different data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stgy_user_carryover.user_secrets c
    JOIN public.user_secrets s ON lower(s.email) = lower(c.email)
    WHERE s.user_id <> c.user_id
  ) THEN
    RAISE EXCEPTION 'a carryover email belongs to a different user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stgy_user_carryover.user_details c
    JOIN public.user_details d ON d.user_id = c.user_id
    WHERE to_jsonb(d) IS DISTINCT FROM to_jsonb(c)
  ) THEN
    RAISE EXCEPTION 'carryover user_details exists with different data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stgy_user_carryover.user_pub_configs c
    JOIN public.user_pub_configs p ON p.user_id = c.user_id
    WHERE to_jsonb(p) IS DISTINCT FROM to_jsonb(c)
  ) THEN
    RAISE EXCEPTION 'carryover user_pub_configs exists with different data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stgy_user_carryover.user_agreement_terms c
    JOIN public.user_agreement_terms t ON t.id = c.id
    WHERE t.contents IS DISTINCT FROM c.contents
  ) THEN
    RAISE EXCEPTION 'an agreement-term ID exists with different contents';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stgy_user_carryover.users c
    WHERE c.ai_model IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.ai_models m WHERE m.label = c.ai_model)
  ) THEN
    RAISE EXCEPTION 'a carryover user references an AI model not present after reset';
  END IF;
END $$;
SQL

# Check all referenced avatar masters before modifying the database, then restore
# whole profile prefixes. Restoring objects first avoids leaving a DB avatar
# reference behind if the object copy itself fails.
RESTORED_PROFILE_IDS=''
while IFS= read -r AVATAR; do
  [ -n "$AVATAR" ] || continue
  KEY="${AVATAR#*/}"
  STORAGE_ID="${KEY%%/*}"
  if [ -z "$STORAGE_ID" ] || [ "$KEY" = "$AVATAR" ]; then
    echo "Invalid avatar reference in profiles.txt: $AVATAR" >&2
    exit 1
  fi
  if ! minio_cmd stat "carrylocal/$MINIO_BUCKET/$MINIO_PREFIX/profiles/$STORAGE_ID/${KEY#*/}" >/dev/null; then
    echo "Missing avatar in MinIO carryover backup: $AVATAR" >&2
    exit 1
  fi
  case " $RESTORED_PROFILE_IDS " in
    *" $STORAGE_ID "*)
      ;;
    *)
      minio_cmd mirror --overwrite --preserve \
        "carrylocal/$MINIO_BUCKET/$MINIO_PREFIX/profiles/$STORAGE_ID/" \
        "carrylocal/stgy-profiles/$STORAGE_ID/" >/dev/null
      RESTORED_PROFILE_IDS="$RESTORED_PROFILE_IDS $STORAGE_ID"
      ;;
  esac
done < "$INPUT/profiles.txt"

run_psql <<'SQL'
BEGIN;

INSERT INTO public.user_agreement_terms (id, contents)
SELECT id, contents
FROM stgy_user_carryover.user_agreement_terms
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (
  id, updated_at, snippet, nickname, avatar, locale, timezone,
  ai_model, is_admin, is_frozen, block_strangers
)
SELECT
  id, updated_at, snippet, nickname, avatar, locale, timezone,
  ai_model, is_admin, is_frozen, block_strangers
FROM stgy_user_carryover.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_secrets (
  user_id, user_agreement_term_id, email, password
)
SELECT user_id, user_agreement_term_id, email, password
FROM stgy_user_carryover.user_secrets
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_details (user_id, introduction, ai_personality)
SELECT user_id, introduction, ai_personality
FROM stgy_user_carryover.user_details
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_pub_configs (
  user_id, site_name, subtitle, author, introduction, design_theme,
  show_service_header, show_site_name, show_pagenation, show_side_profile,
  show_side_recent, show_side_popular
)
SELECT
  user_id, site_name, subtitle, author, introduction, design_theme,
  show_service_header, show_site_name, show_pagenation, show_side_profile,
  show_side_recent, show_side_popular
FROM stgy_user_carryover.user_pub_configs
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
SQL

# Verify database rows byte-for-byte/value-for-value for the carried tables.
run_psql <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    (SELECT * FROM stgy_user_carryover.users EXCEPT SELECT u.* FROM public.users u JOIN stgy_user_carryover.users c ON c.id = u.id)
    UNION ALL
    (SELECT u.* FROM public.users u JOIN stgy_user_carryover.users c ON c.id = u.id EXCEPT SELECT * FROM stgy_user_carryover.users)
  ) THEN
    RAISE EXCEPTION 'users verification failed';
  END IF;

  IF EXISTS (
    (SELECT * FROM stgy_user_carryover.user_secrets EXCEPT SELECT s.* FROM public.user_secrets s JOIN stgy_user_carryover.user_secrets c ON c.user_id = s.user_id)
    UNION ALL
    (SELECT s.* FROM public.user_secrets s JOIN stgy_user_carryover.user_secrets c ON c.user_id = s.user_id EXCEPT SELECT * FROM stgy_user_carryover.user_secrets)
  ) THEN
    RAISE EXCEPTION 'user_secrets verification failed';
  END IF;

  IF EXISTS (
    (SELECT * FROM stgy_user_carryover.user_details EXCEPT SELECT d.* FROM public.user_details d JOIN stgy_user_carryover.user_details c ON c.user_id = d.user_id)
    UNION ALL
    (SELECT d.* FROM public.user_details d JOIN stgy_user_carryover.user_details c ON c.user_id = d.user_id EXCEPT SELECT * FROM stgy_user_carryover.user_details)
  ) THEN
    RAISE EXCEPTION 'user_details verification failed';
  END IF;

  IF EXISTS (
    (SELECT * FROM stgy_user_carryover.user_pub_configs EXCEPT SELECT p.* FROM public.user_pub_configs p JOIN stgy_user_carryover.user_pub_configs c ON c.user_id = p.user_id)
    UNION ALL
    (SELECT p.* FROM public.user_pub_configs p JOIN stgy_user_carryover.user_pub_configs c ON c.user_id = p.user_id EXCEPT SELECT * FROM stgy_user_carryover.user_pub_configs)
  ) THEN
    RAISE EXCEPTION 'user_pub_configs verification failed';
  END IF;
END $$;
SQL

while IFS= read -r AVATAR; do
  [ -n "$AVATAR" ] || continue
  if ! minio_cmd stat "carrylocal/$AVATAR" >/dev/null; then
    echo "Restored avatar verification failed: $AVATAR" >&2
    exit 1
  fi
done < "$INPUT/profiles.txt"

if [ "$NO_SEARCH_RESET" != true ]; then
  echo "Rebuilding user full-text search index ..."
  ./scripts/run-searchUtil.sh user-reset --stop-on-error --print-logs
fi

# Cleanup transient in-service copies only after all verification/search work succeeds.
run_psql -c "DROP SCHEMA $CARRYOVER_SCHEMA CASCADE;"
minio_cmd rm --recursive --force "carrylocal/$MINIO_BUCKET/$MINIO_PREFIX/" >/dev/null 2>&1 || true

printf '\nRestored and verified %s user(s).\n' "$EXPECTED_USERS"
printf 'Password hashes, IDs, profile settings, and avatar objects were preserved.\n'
printf 'The external backup remains at: %s\n' "$INPUT"
