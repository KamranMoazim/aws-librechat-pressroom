#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
require_root

usage()
{
  echo "usage: $0 --list"
  echo "       $0 --yes [--keep-audit] [--env-identity FILE] SNAPSHOT"
  exit 1
}

confirmed=0
keep_audit=0
identity=""
snapshot=""
while [[ $# -gt 0 ]]
do
  case "$1" in
    --list)
      restic_env
      restic snapshots --host "$RESTIC_HOST"
      exit 0
      ;;
    --yes) confirmed=1 ;;
    --keep-audit) keep_audit=1 ;;
    --env-identity) identity="${2:-}"; shift ;;
    -*) usage ;;
    *) snapshot="$1" ;;
  esac
  shift
done
if [[ $confirmed -ne 1 || -z "$snapshot" ]]
then
  echo "This replaces every chat, file, vector and the search index on this server with the backup."
  echo "Pick the snapshot by its time with --list; a new, empty server may have made a newer one."
  usage
fi
umask 077

started=$(date -u +%s)
restic_env
WRITERS=(api rag_api portal mcp-outlook mcp-pace mcp-relevance mcp-voice admin-panel)
running_writers=()
for service in "${WRITERS[@]}"
do
  if has_service "$service"
  then
    running_writers+=("$service")
  fi
done

if [[ $keep_audit -eq 0 ]]
then
  audit_rows=$(compose exec -T auditdb sh -c 'psql -U "$POSTGRES_USER" -d audit -tAc "SELECT count(*) FROM approved_actions"' | tr -d '[:space:]')
  if [[ "$audit_rows" != "0" ]]
  then
    echo "approved_actions already has $audit_rows rows and is append-only: restore onto a fresh audit database, or pass --keep-audit to leave it as it is"
    exit 1
  fi
fi

install -d -m 0700 "${RESTORE_BASE:-/var/lib/pressroom}"
target=$(mktemp -d "${RESTORE_BASE:-/var/lib/pressroom}/restore.XXXXXX")
trap 'rm -rf "$target"' EXIT
info=$(restic snapshots --host "$RESTIC_HOST" --json "$snapshot")
read -r snapshot_id snapshot_time <<<"$(python3 -I -c 'import json,sys; s=json.load(sys.stdin)[-1]; print(s["short_id"], s["time"])' <<<"$info")"
restic restore --quiet "$snapshot_id" --target "$target"
echo "restoring snapshot $snapshot_id taken $snapshot_time"

locate()
{
  local found
  found=$(find "$target" -name "$1" -not -path "$target$SERVER_DIR/uploads/*" -not -path "$target$SERVER_DIR/images/*" | head -n 1)
  if [[ -z "$found" ]]
  then
    echo "snapshot $snapshot_id has no $1"
    exit 1
  fi
  echo "$found"
}
mongo_archive=$(locate mongo-librechat.archive.gz)
vector_dump=$(locate vectordb.dump)
audit_dump=$(locate audit.dump)
env_age=$(locate env.age)

if [[ ${#running_writers[@]} -gt 0 ]]
then
  compose stop "${running_writers[@]}"
fi
compose up -d mongodb vectordb auditdb

mongo_tool mongorestore --quiet --archive --gzip --drop --nsInclude 'LibreChat.*' <"$mongo_archive"
compose exec -T vectordb sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  <"$vector_dump"
if [[ $keep_audit -eq 0 ]]
then
  compose exec -T auditdb sh -c 'pg_restore -U "$POSTGRES_USER" -d audit --data-only --table=approved_actions' \
    <"$audit_dump"
  compose exec -T auditdb sh -c "psql -U \"\$POSTGRES_USER\" -d audit -v ON_ERROR_STOP=1 -tAc \"SELECT setval(pg_get_serial_sequence('approved_actions', 'id'), coalesce(max(id), 1)) FROM approved_actions\"" >/dev/null
fi

for dir in uploads images
do
  source_dir="$target$SERVER_DIR/$dir"
  if [[ -d "$source_dir" ]]
  then
    rm -rf "${SERVER_DIR:?}/$dir"
    cp -a "$source_dir" "$SERVER_DIR/$dir"
  fi
done

# A fresh Meilisearch index makes LibreChat re-index everything from Mongo at start.
if has_service meilisearch
then
  compose stop meilisearch
  rm -rf "$SERVER_DIR"/meili_data_*
fi

letsencrypt_dir="${LETSENCRYPT_DIR:-/etc/letsencrypt}"
if [[ ! -d "$letsencrypt_dir/live/pressroom" && -d "$target$letsencrypt_dir/live/pressroom" ]]
then
  rm -rf "$letsencrypt_dir"
  cp -a "$target$letsencrypt_dir" "$letsencrypt_dir"
  echo "certificates restored to $letsencrypt_dir"
fi

install -m 0600 "$env_age" "$STATE_DIR/env.age"
if [[ -n "$identity" ]]
then
  age -d -i "$identity" -o "$SERVER_DIR/.env.from-backup" "$env_age"
  chmod 600 "$SERVER_DIR/.env.from-backup"
  echo "decrypted the backed-up .env to $SERVER_DIR/.env.from-backup; compare it with .env before using it"
fi

compose up -d
smoke_status=0
"$SERVER_DIR/bin/smoke.sh" || smoke_status=$?

finished=$(date -u +%s)
snapshot_epoch=$(python3 -I -c 'import datetime,sys; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")).timestamp()))' "$snapshot_time")
summary="restore of $snapshot_id ($snapshot_time): data age at restore $(( (started - snapshot_epoch) / 60 )) min, restore took $(( (finished - started) / 60 )) min $(( (finished - started) % 60 )) s, smoke $([[ $smoke_status -eq 0 ]] && echo passed || echo FAILED)"
echo "$(date -u +%FT%TZ) $summary" >>"$STATE_DIR/restore.log"
echo "$summary"
exit "$smoke_status"
