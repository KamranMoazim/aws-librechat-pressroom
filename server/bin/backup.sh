#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
require_root

STAGE="${BACKUP_STAGE:-/var/lib/pressroom/backup-stage}"
TAG="${BACKUP_TAG:-nightly}"
started=$(date -u +%s)
restic_env
recipient=$(env_value BACKUP_AGE_RECIPIENT)
if [[ ! "$recipient" =~ ^age1[a-z0-9]+$ ]]
then
  echo "BACKUP_AGE_RECIPIENT missing or not an age public key"
  exit 1
fi

users=$(mongo_eval 'print(conn.users.countDocuments())' | tr -d '[:space:]')
if [[ "$users" == "0" && "${BACKUP_EMPTY_OK:-}" != "1" ]]
then
  echo "refusing: LibreChat has no users yet. A backup of an empty server would become the newest snapshot (set BACKUP_EMPTY_OK=1 if this is intended)"
  exit 1
fi

umask 077
rm -rf "$STAGE"
install -d -m 0700 "$STAGE" "$STATE_DIR"
trap 'rm -rf "$STAGE"' EXIT

mongo_tool mongodump --quiet --db LibreChat --archive --gzip >"$STAGE/mongo-librechat.archive.gz"
compose exec -T vectordb sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$STAGE/vectordb.dump"
compose exec -T auditdb sh -c 'pg_dump -U "$POSTGRES_USER" -d audit -Fc' >"$STAGE/audit.dump"
age -r "$recipient" -o "$STAGE/env.age" "$SERVER_DIR/.env"
for file in mongo-librechat.archive.gz vectordb.dump audit.dump env.age
do
  if [[ ! -s "$STAGE/$file" ]]
  then
    echo "empty dump: $file"
    exit 1
  fi
done

paths=("$STAGE")
for path in uploads images librechat.yaml docker-compose.yml docker-compose.override.yml nginx mcp-config
do
  if [[ -e "$SERVER_DIR/$path" ]]
  then
    paths+=("$SERVER_DIR/$path")
  fi
done
if [[ -d "${LETSENCRYPT_DIR:-/etc/letsencrypt}" ]]
then
  paths+=("${LETSENCRYPT_DIR:-/etc/letsencrypt}")
fi

if ! restic cat config >/dev/null 2>&1
then
  restic init
fi
restic backup --quiet --host "$RESTIC_HOST" --tag "$TAG" "${paths[@]}"
restic forget --quiet --host "$RESTIC_HOST" --tag nightly --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
restic forget --quiet --host "$RESTIC_HOST" --tag pre-update --keep-last 5 --prune
if [[ "$(date -u +%u)" == "7" || "${BACKUP_CHECK:-}" == "1" ]]
then
  restic check --read-data-subset=5%
fi

date -u +%s >"$STATE_DIR/backup.last-success"
snapshot=$(restic snapshots --host "$RESTIC_HOST" --tag "$TAG" --latest 1 --json | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[-1]["short_id"])')
echo "backup $snapshot ($TAG) done in $(($(date -u +%s) - started))s"
