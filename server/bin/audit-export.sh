#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${AUDIT_STATE_DIR:-$SERVER_DIR/state}"
CONTAINER="${AUDIT_CONTAINER:-auditdb}"
STATE="$STATE_DIR/audit-export.last-id"

password=$(sed -n 's/^AUDIT_WRITER_PASSWORD=//p' "$SERVER_DIR/.env")
install -m 0700 -d "$STATE_DIR"
last=$(cat "$STATE" 2>/dev/null || echo 0)
if [[ ! "$last" =~ ^[0-9]+$ ]]
then
  echo "corrupt state file $STATE"
  exit 1
fi

umask 077
batch=$(mktemp)
trap 'rm -f "$batch"' EXIT
docker exec -e PGPASSWORD="$password" "$CONTAINER" psql -h 127.0.0.1 -U audit_writer -d audit \
  -v ON_ERROR_STOP=1 -tAc "SELECT row_to_json(a) FROM approved_actions a WHERE id > $last ORDER BY id" >"$batch"

if [[ ! -s "$batch" ]]
then
  echo "no new approved actions after id $last"
  exit 0
fi

ids=$(python3 -I -c 'import json,sys; rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; print(rows[0]["id"], rows[-1]["id"], len(rows))' "$batch")
read -r first newest count <<<"$ids"
account=$(aws sts get-caller-identity --query Account --output text)
key="audit/$(date -u +%Y/%m/%d/%H%M%S)-$first-$newest.jsonl"
retain_until=$(python3 -I -c 'import datetime,sys; now=datetime.datetime.now(datetime.timezone.utc); print(now.replace(year=now.year+int(sys.argv[1]), day=min(now.day,28)).strftime("%Y-%m-%dT%H:%M:%SZ"))' "${AUDIT_RETENTION_YEARS:-7}")
aws s3api put-object --region us-west-2 --bucket "pressroom-backup-$account-us-west-2" --key "$key" \
  --body "$batch" --checksum-algorithm SHA256 \
  --object-lock-mode GOVERNANCE --object-lock-retain-until-date "$retain_until" >/dev/null
echo "$newest" >"$STATE.tmp"
mv "$STATE.tmp" "$STATE"
echo "exported $count approved actions ($first..$newest) to $key, locked until $retain_until"
