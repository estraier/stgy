#! /bin/bash

set -euo pipefail

set -a
[ -f .env ] && source .env
set +a

SCRIPT_NAME="$(basename "$0")"

log() {
  echo "[backup-full-site] $*" >&2
}

die() {
  echo "[backup-full-site] ERROR: $*" >&2
  exit 1
}

usage() {
  cat >&2 <<__EOF__
Usage:
  $SCRIPT_NAME backup  [--root DIR] [--name NAME] [--db|--no-db] [--objects|--no-objects]
  $SCRIPT_NAME restore [--root DIR] [--db|--no-db] [--objects|--no-objects] NAME
  $SCRIPT_NAME prune   [--root DIR] [--retain-generations N]
  $SCRIPT_NAME list    [--root DIR]

Environment (DB):
  STGY_DATABASE_HOST        (default: postgres; fallback: 127.0.0.1 if not resolvable)
  STGY_DATABASE_PORT        (default: 5432)
  STGY_DATABASE_USER        (default: admin)
  STGY_DATABASE_PASSWORD    (default: stgystgy)
  STGY_DATABASE_NAME        (default: stgy)

Environment (S3/MinIO):
  STGY_STORAGE_S3_ENDPOINT              (default: http://minio:9000 ; fallback host->127.0.0.1 if not resolvable)
  STGY_STORAGE_S3_REGION                (optional: used when creating buckets on restore)
  STGY_STORAGE_S3_ACCESS_KEY            (fallback: STGY_MINIO_ROOT_USER, then "admin")
  STGY_STORAGE_S3_SECRET_ACCESS_KEY     (fallback: STGY_MINIO_ROOT_PASSWORD, then "stgystgy")
  STGY_STORAGE_S3_BUCKETS               (optional: comma-separated explicit bucket names)
  STGY_STORAGE_S3_ANON_DOWNLOAD_BUCKETS (optional: comma-separated bucket names to set 'download' policy)

Backup layout:
  DIR/full-site-YYYY-MM-DD/db/stgy.dump
  DIR/full-site-YYYY-MM-DD/objects/<bucket>/...

Examples:
  $SCRIPT_NAME backup
  $SCRIPT_NAME restore full-site-2026-01-12
  $SCRIPT_NAME prune --retain-generations 7
__EOF__
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "command not found: $1"
}

is_resolvable_host() {
  local host="$1"
  [ -n "$host" ] || return 1
  getent hosts "$host" >/dev/null 2>&1
}

resolve_host_or_localhost() {
  local host="$1"
  local fallback="${2:-127.0.0.1}"
  if is_resolvable_host "$host"; then
    echo "$host"
    return 0
  fi
  log "warning: host '$host' is not resolvable; falling back to $fallback"
  echo "$fallback"
}

fix_endpoint_if_unresolvable() {
  local url="$1"

  if [[ "$url" =~ ^([a-zA-Z][a-zA-Z0-9+.-]*)://([^/:]+)(:([0-9]+))?(/.*)?$ ]]; then
    local scheme="${BASH_REMATCH[1]}"
    local host="${BASH_REMATCH[2]}"
    local port_part="${BASH_REMATCH[3]:-}"
    local rest="${BASH_REMATCH[5]:-}"

    if is_resolvable_host "$host"; then
      echo "$url"
      return 0
    fi

    log "warning: endpoint host '$host' is not resolvable; falling back to 127.0.0.1"
    echo "${scheme}://127.0.0.1${port_part}${rest}"
    return 0
  fi

  echo "$url"
}

today_yyyy_mm_dd() {
  date -u +"%Y-%m-%d"
}

split_csv() {
  local s="${1:-}"
  [ -n "$s" ] || return 0
  echo "$s" | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | sed '/^$/d'
}

join_path() {
  local a="$1"
  local b="$2"
  if [[ "$a" == */ ]]; then
    echo "${a}${b}"
  else
    echo "${a}/${b}"
  fi
}

list_generations() {
  local root="$1"
  [ -d "$root" ] || return 0
  (cd "$root" && ls -1d full-site-* 2>/dev/null || true) | sort
}

BACKUP_ROOT_DEFAULT="/var/backups/stgy"
RETAIN_DEFAULT="7"

DB_ENABLED="1"
OBJECTS_ENABLED="1"

BACKUP_ROOT="$BACKUP_ROOT_DEFAULT"
BACKUP_NAME=""

RETAIN_GENERATIONS="$RETAIN_DEFAULT"

HARDLINK_BASE=""

if [ $# -lt 1 ]; then
  usage
  exit 2
fi

COMMAND="$1"
shift

case "$COMMAND" in
  backup)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --root)
          [[ $# -ge 2 ]] || die "--root requires a value"
          BACKUP_ROOT="$2"
          shift 2
          ;;
        --root=*)
          BACKUP_ROOT="${1#*=}"
          shift
          ;;
        --name)
          [[ $# -ge 2 ]] || die "--name requires a value"
          BACKUP_NAME="$2"
          shift 2
          ;;
        --name=*)
          BACKUP_NAME="${1#*=}"
          shift
          ;;
        --db) DB_ENABLED="1"; shift ;;
        --no-db) DB_ENABLED="0"; shift ;;
        --objects) OBJECTS_ENABLED="1"; shift ;;
        --no-objects) OBJECTS_ENABLED="0"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
      esac
    done
    ;;
  restore)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --root)
          [[ $# -ge 2 ]] || die "--root requires a value"
          BACKUP_ROOT="$2"
          shift 2
          ;;
        --root=*)
          BACKUP_ROOT="${1#*=}"
          shift
          ;;
        --db) DB_ENABLED="1"; shift ;;
        --no-db) DB_ENABLED="0"; shift ;;
        --objects) OBJECTS_ENABLED="1"; shift ;;
        --no-objects) OBJECTS_ENABLED="0"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) break ;;
      esac
    done

    [[ $# -ge 1 ]] || die "restore requires NAME argument (e.g., full-site-2026-01-12)"
    BACKUP_NAME="$1"
    shift
    [[ $# -eq 0 ]] || die "unexpected extra args: $*"
    ;;
  prune)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --root)
          [[ $# -ge 2 ]] || die "--root requires a value"
          BACKUP_ROOT="$2"
          shift 2
          ;;
        --root=*)
          BACKUP_ROOT="${1#*=}"
          shift
          ;;
        --retain-generations)
          [[ $# -ge 2 ]] || die "--retain-generations requires a value"
          RETAIN_GENERATIONS="$2"
          shift 2
          ;;
        --retain-generations=*)
          RETAIN_GENERATIONS="${1#*=}"
          shift
          ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
      esac
    done
    ;;
  list)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --root)
          [[ $# -ge 2 ]] || die "--root requires a value"
          BACKUP_ROOT="$2"
          shift 2
          ;;
        --root=*)
          BACKUP_ROOT="${1#*=}"
          shift
          ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
      esac
    done
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    die "unknown command: $COMMAND"
    ;;
esac

need_cmd date
need_cmd mkdir
need_cmd rm
need_cmd ls
need_cmd sort
need_cmd tail
need_cmd sed
need_cmd tr
need_cmd getent
need_cmd wc
need_cmd head
need_cmd awk
need_cmd grep
need_cmd cp

DB_HOST_RAW="${STGY_DATABASE_HOST:-postgres}"
DB_HOST="$(resolve_host_or_localhost "$DB_HOST_RAW" "127.0.0.1")"
DB_PORT="${STGY_DATABASE_PORT:-5432}"
DB_USER="${STGY_DATABASE_USER:-admin}"
DB_PASSWORD="${STGY_DATABASE_PASSWORD:-stgystgy}"
DB_NAME="${STGY_DATABASE_NAME:-stgy}"

S3_ENDPOINT_RAW="${STGY_STORAGE_S3_ENDPOINT:-http://minio:9000}"
S3_ENDPOINT="$(fix_endpoint_if_unresolvable "$S3_ENDPOINT_RAW")"
S3_REGION="${STGY_STORAGE_S3_REGION:-}"
S3_ACCESS_KEY="${STGY_STORAGE_S3_ACCESS_KEY:-${STGY_MINIO_ROOT_USER:-admin}}"
S3_SECRET_KEY="${STGY_STORAGE_S3_SECRET_ACCESS_KEY:-${STGY_MINIO_ROOT_PASSWORD:-stgystgy}}"

if [ -z "$BACKUP_NAME" ] && [ "$COMMAND" = "backup" ]; then
  BACKUP_NAME="full-site-$(today_yyyy_mm_dd)"
fi

compute_hardlink_base() {
  local root="$1"
  local current="$2"
  local base
  base="$( { list_generations "$root" | grep -Fxv "$current" || true; } | tail -n 1 )"
  [ -n "$base" ] || return 0
  [ -d "$(join_path "$root" "$base")" ] || return 0
  echo "$base"
}

do_backup_db() {
  need_cmd pg_dump

  local outdir="$1"
  local dumpfile
  dumpfile="$(join_path "$outdir" "stgy.dump")"

  log "dumping db..."
  PGPASSWORD="$DB_PASSWORD" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -F c \
    --no-owner \
    --no-privileges \
    -f "$dumpfile"
}

do_restore_db() {
  need_cmd psql
  need_cmd pg_restore

  local indir="$1"
  local dumpfile
  dumpfile="$(join_path "$indir" "stgy.dump")"
  [ -f "$dumpfile" ] || die "db dump not found: $dumpfile"

  log "restoring db..."

  PGPASSWORD="$DB_PASSWORD" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

  PGPASSWORD="$DB_PASSWORD" pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-privileges \
    "$dumpfile"
}

detect_buckets() {
  need_cmd mc

  if [ -n "${STGY_STORAGE_S3_BUCKETS:-}" ]; then
    split_csv "${STGY_STORAGE_S3_BUCKETS}"
    return 0
  fi

  mc ls "stgys3" 2>/dev/null | awk '{print $NF}' | sed 's:/*$::' | sed '/^$/d' || true
}

do_backup_objects() {
  need_cmd mc

  local outdir="$1"
  mkdir -p "$outdir"

  log "dumping objects..."

  mc alias set stgys3 "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null

  local base_objects_dir=""
  if [ -n "$HARDLINK_BASE" ]; then
    base_objects_dir="$(join_path "$(join_path "$BACKUP_ROOT" "$HARDLINK_BASE")" "objects")"
    if [ -d "$base_objects_dir" ]; then
      log "  hardlink-base=$HARDLINK_BASE"
    else
      base_objects_dir=""
    fi
  fi

  local bucket
  while read -r bucket; do
    [ -n "$bucket" ] || continue
    log "  bucket=$bucket"

    local dest_bucket
    dest_bucket="$(join_path "$outdir" "$bucket")"

    if [ -n "$base_objects_dir" ] && [ -d "$(join_path "$base_objects_dir" "$bucket")" ]; then
      rm -rf "$dest_bucket"
      mkdir -p "$dest_bucket"

      if ! cp -al "$(join_path "$base_objects_dir" "$bucket")/." "$dest_bucket" 2>/dev/null; then
        log "  warning: hardlink seed failed for bucket=$bucket (cross-device?); falling back to empty seed"
        rm -rf "$dest_bucket"
        mkdir -p "$dest_bucket"
      fi
    else
      mkdir -p "$dest_bucket"
    fi

    mc mirror --overwrite --remove --preserve "stgys3/${bucket}" "$dest_bucket"
  done < <(detect_buckets)
}

do_restore_objects() {
  need_cmd mc

  local indir="$1"
  [ -d "$indir" ] || die "objects dir not found: $indir"

  log "restoring objects..."

  mc alias set stgys3 "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null

  local bucket
  while read -r bucket; do
    [ -n "$bucket" ] || continue
    [ -d "$(join_path "$indir" "$bucket")" ] || continue

    log "  bucket=$bucket"

    mc rb --force "stgys3/${bucket}" >/dev/null 2>&1 || true

    if [ -n "$S3_REGION" ]; then
      mc mb --region "$S3_REGION" "stgys3/${bucket}" >/dev/null
    else
      mc mb "stgys3/${bucket}" >/dev/null
    fi

    mc mirror --overwrite --remove "$(join_path "$indir" "$bucket")" "stgys3/${bucket}"

    if [ -n "${STGY_STORAGE_S3_ANON_DOWNLOAD_BUCKETS:-}" ]; then
      if split_csv "${STGY_STORAGE_S3_ANON_DOWNLOAD_BUCKETS}" | grep -Fxq "$bucket"; then
        mc anonymous set download "stgys3/${bucket}" >/dev/null 2>&1 || true
      fi
    else
      if [ "$bucket" = "stgy-images" ] || [ "$bucket" = "stgy-profiles" ]; then
        mc anonymous set download "stgys3/${bucket}" >/dev/null 2>&1 || true
      fi
    fi
  done < <(ls -1 "$indir" 2>/dev/null || true)
}

do_backup() {
  mkdir -p "$BACKUP_ROOT"
  local dest
  dest="$(join_path "$BACKUP_ROOT" "$BACKUP_NAME")"

  log "backup-root=$BACKUP_ROOT"
  log "name=$BACKUP_NAME"
  log "db=$DB_ENABLED objects=$OBJECTS_ENABLED"

  if [ -e "$dest" ]; then
    die "backup destination already exists: $dest"
  fi

  mkdir -p "$dest"

  if [ "$DB_ENABLED" = "1" ]; then
    mkdir -p "$(join_path "$dest" "db")"
    do_backup_db "$(join_path "$dest" "db")"
  fi

  if [ "$OBJECTS_ENABLED" = "1" ]; then
    HARDLINK_BASE="$(compute_hardlink_base "$BACKUP_ROOT" "$BACKUP_NAME" || true)"
    mkdir -p "$(join_path "$dest" "objects")"
    do_backup_objects "$(join_path "$dest" "objects")"
  fi

  log "backup done: $dest"
}

do_restore() {
  local src
  src="$(join_path "$BACKUP_ROOT" "$BACKUP_NAME")"
  [ -d "$src" ] || die "backup not found: $src"

  log "restore-root=$BACKUP_ROOT"
  log "name=$BACKUP_NAME"
  log "db=$DB_ENABLED objects=$OBJECTS_ENABLED"

  if [ "$DB_ENABLED" = "1" ]; then
    do_restore_db "$(join_path "$src" "db")"
  fi

  if [ "$OBJECTS_ENABLED" = "1" ]; then
    do_restore_objects "$(join_path "$src" "objects")"
  fi

  log "restore done: $src"
}

do_prune() {
  [[ "$RETAIN_GENERATIONS" =~ ^[0-9]+$ ]] || die "invalid --retain-generations: $RETAIN_GENERATIONS"
  log "backup-root=$BACKUP_ROOT"
  log "retain-generations=$RETAIN_GENERATIONS"

  local gens
  gens="$(list_generations "$BACKUP_ROOT" || true)"
  if [ -z "$gens" ]; then
    log "no generations"
    return 0
  fi

  local count
  count="$(echo "$gens" | wc -l | tr -d ' ')"
  if [ "$count" -le "$RETAIN_GENERATIONS" ]; then
    log "nothing to prune (count=$count)"
    return 0
  fi

  local to_delete
  to_delete="$(echo "$gens" | head -n $((count - RETAIN_GENERATIONS)))"

  local name
  while read -r name; do
    [ -n "$name" ] || continue
    local path
    path="$(join_path "$BACKUP_ROOT" "$name")"
    log "prune: $path"
    rm -rf "$path"
  done <<<"$to_delete"

  log "prune done"
}

do_list() {
  log "backup-root=$BACKUP_ROOT"
  list_generations "$BACKUP_ROOT" || true
}

case "$COMMAND" in
  backup) do_backup ;;
  restore) do_restore ;;
  prune) do_prune ;;
  list) do_list ;;
  *) die "internal: unreachable command: $COMMAND" ;;
esac
