#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
require_root

snapshot="(none: --no-backup)"
if [[ "${1:-}" != "--no-backup" ]]
then
  backup_output=$(BACKUP_TAG=pre-update "$SERVER_DIR/bin/backup.sh")
  echo "$backup_output"
  snapshot=$(sed -n 's/^backup \([0-9a-f]*\) (pre-update).*/\1/p' <<<"$backup_output")
fi

compose config --quiet
stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$STATE_DIR"
compose images --format json >"$STATE_DIR/images-before-$stamp.json"

if ! compose pull --ignore-buildable
then
  echo "pull failed: open the registries from the laptop (npm run registries -- open) and run again"
  exit 1
fi
compose build
compose up -d --remove-orphans

if "$SERVER_DIR/bin/smoke.sh"
then
  echo "update done; pre-update backup $snapshot; images before the update in $STATE_DIR/images-before-$stamp.json"
  exit 0
fi

cat <<MSG
UPDATE FAILED THE SMOKE CHECKS. Roll back:
  1. Laptop: git revert the digest change, npm run push-server
  2. Server: bin/update.sh --no-backup
  3. If the release migrated data (release notes, or LibreChat logs say "migration"):
     bin/restore.sh --yes --keep-audit $snapshot
Images before the update: $STATE_DIR/images-before-$stamp.json
MSG
exit 1
