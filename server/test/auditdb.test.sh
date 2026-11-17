#!/usr/bin/env bash
set -uo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${POSTGRES_TEST_IMAGE:-$(sed -n 's/^    image: \(postgres:.*\)$/\1/p' "$SERVER_DIR/docker-compose.override.yml")}"
NAME="pressroom-auditdb-test-$$"
passed=0
failed=0

check()
{
  if [[ "$2" == "0" ]]
  then
    passed=$((passed + 1))
    echo "PASS $1"
  else
    failed=$((failed + 1))
    echo "FAIL $1"
  fi
}

as_writer()
{
  docker exec -e PGPASSWORD=writerpw "$NAME" psql -h 127.0.0.1 -U audit_writer -d audit -v ON_ERROR_STOP=1 -tAc "$1"
}

as_admin()
{
  docker exec "$NAME" psql -U audit_admin -d audit -v ON_ERROR_STOP=1 -tAc "$1"
}

docker run -d --rm --name "$NAME" -p 127.0.0.1::5432 -e POSTGRES_USER=audit_admin -e POSTGRES_PASSWORD=adminpw -e POSTGRES_DB=audit \
  -e AUDIT_WRITER_PASSWORD=writerpw -v "$SERVER_DIR/auditdb/init:/docker-entrypoint-initdb.d:ro" "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT

ready=1
for _ in $(seq 1 60)
do
  if as_writer 'SELECT 1' >/dev/null 2>&1
  then
    ready=0
    break
  fi
  sleep 1
done
check "audit_writer can log in" "$ready"

as_writer "INSERT INTO approved_actions (user_oid, upn, tool, target, summary, args_sha256, before, after, conversation_id, result)
  VALUES ('oid-alice', 'alice@example.com', 'job_update_commit', 'J24000', 'status -> printing', repeat('a', 64),
  '{\"status\": \"proofing\"}', '{\"status\": \"printing\"}', 'conv-1', 'committed')" >/dev/null 2>&1
check "writer can insert" $?
[[ "$(as_writer 'SELECT count(*) FROM approved_actions')" == "1" ]]
check "writer can read" $?

as_writer "UPDATE approved_actions SET result = 'edited'" >/dev/null 2>&1
[[ $? -ne 0 ]]
check "writer cannot UPDATE" $?
as_writer "DELETE FROM approved_actions" >/dev/null 2>&1
[[ $? -ne 0 ]]
check "writer cannot DELETE" $?
as_writer "TRUNCATE approved_actions" >/dev/null 2>&1
[[ $? -ne 0 ]]
check "writer cannot TRUNCATE" $?

error=$(as_admin "UPDATE approved_actions SET result = 'edited'" 2>&1)
[[ "$error" == *"append-only (UPDATE refused)"* ]]
check "even the admin's UPDATE is refused by the trigger" $?
error=$(as_admin "DELETE FROM approved_actions" 2>&1)
[[ "$error" == *"append-only (DELETE refused)"* ]]
check "even the admin's DELETE is refused by the trigger" $?
[[ "$(as_admin 'SELECT result FROM approved_actions')" == "committed" ]]
check "the record is unchanged" $?

as_writer "CREATE TABLE sneaky (id int)" >/dev/null 2>&1
[[ $? -ne 0 ]]
check "writer cannot create tables" $?

check "init script is idempotent (rerun)" "$(docker exec -e AUDIT_WRITER_PASSWORD=writerpw -e POSTGRES_USER=audit_admin -e POSTGRES_DB=audit "$NAME" bash /docker-entrypoint-initdb.d/01-approved-actions.sh >/dev/null 2>&1; echo $?)"

port=$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')
AUDIT_DATABASE_URL="postgres://audit_writer:writerpw@127.0.0.1:$port/audit" \
  npm --prefix "$SERVER_DIR/../mcp" run --silent check:recorder >/dev/null 2>&1
check "MCP Postgres recorder writes a full row" $?
[[ "$(as_admin "SELECT tool || '|' || target || '|' || (after->>'status') || '|' || length(args_sha256) || '|' || conversation_id FROM approved_actions ORDER BY id DESC LIMIT 1")" == "job_update_commit|J24001|printing|64|conv-recorder" ]]
check "recorded row has tool, target, after, hash and conversation" $?

WORK=$(mktemp -d)
mkdir -p "$WORK/bin" "$WORK/server/bin"
cp "$SERVER_DIR/bin/audit-export.sh" "$WORK/server/bin/"
echo 'AUDIT_WRITER_PASSWORD=writerpw' >"$WORK/server/.env"
cat >"$WORK/bin/aws" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "sts" ]]
then
  echo 111111111111
  exit 0
fi
echo "$*" >>"$AWS_LOG"
while [[ $# -gt 0 ]]
do
  if [[ "$1" == "--body" ]]
  then
    cp "$2" "$AWS_LOG.$(wc -l <"$AWS_LOG" | tr -d ' ').jsonl"
  fi
  shift
done
STUB
chmod +x "$WORK/bin/aws"
export_run()
{
  PATH="$WORK/bin:$PATH" AWS_LOG="$WORK/aws.log" AUDIT_CONTAINER="$NAME" "$WORK/server/bin/audit-export.sh"
}
first=$(export_run)
[[ "$first" == "exported 2 approved actions (1..2) to audit/"*"-1-2.jsonl, locked until $(($(date -u +%Y) + 7))-"* ]] &&
  grep -q -- '--bucket pressroom-backup-111111111111-us-west-2 --key audit/' "$WORK/aws.log" &&
  grep -q -- '--object-lock-mode GOVERNANCE' "$WORK/aws.log" &&
  [[ "$(wc -l <"$WORK/aws.log.1.jsonl" | tr -d ' ')" == "2" ]]
check "export uploads every row once, locked for 7 years" $?
second=$(export_run)
[[ "$second" == "no new approved actions after id 2" ]] && [[ "$(wc -l <"$WORK/aws.log" | tr -d ' ')" == "1" ]]
check "a second run with nothing new uploads nothing" $?
as_writer "INSERT INTO approved_actions (user_oid, upn, tool, target, summary, args_sha256, result)
  VALUES ('oid-dave', 'dave@example.com', 'draft_reply', 'AAMk', 'createReply', repeat('b', 64), 'draft created')" >/dev/null
third=$(export_run)
[[ "$third" == *"(3..3)"* ]] && grep -q '"upn":"dave@example.com"' "$WORK/aws.log.2.jsonl"
check "the next run exports only the new row" $?
rm -rf "$WORK"

echo
echo "$passed passed, $failed failed"
[[ "$failed" -eq 0 ]]
