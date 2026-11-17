#!/usr/bin/env bash
set -uo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${MONGO_TEST_IMAGE:-$(sed -n 's/^    image: \(mongo:.*\)$/\1/p' "$SERVER_DIR/docker-compose.override.yml")}"
NAME="pressroom-mongo-test-$$"
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

shell()
{
  local uri="$1"
  shift
  docker exec "${EXEC_ENV[@]}" "$NAME" mongosh --quiet "$uri" "$@"
}
EXEC_ENV=()

APP_URI='mongodb://librechat:apppw@localhost:27017/LibreChat?authSource=LibreChat'
docker run -d --rm --name "$NAME" \
  -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=rootpw -e MONGO_APP_PASSWORD=apppw \
  -v "$SERVER_DIR/mongo/init:/docker-entrypoint-initdb.d:ro" -v "$SERVER_DIR/reports:/reports:ro" \
  "$IMAGE" mongod >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT

ready=1
for _ in $(seq 1 60)
do
  if shell "$APP_URI" --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1
  then
    ready=0
    break
  fi
  sleep 1
done
check "app user can connect with its password" "$ready"

shell "$APP_URI" --eval 'db.probe.insertOne({ ok: 1 })' >/dev/null 2>&1
check "app user can write LibreChat" $?

shell 'mongodb://localhost:27017/LibreChat' --eval 'db.probe.countDocuments()' >/dev/null 2>&1
[[ $? -ne 0 ]]
check "unauthenticated reads are refused" $?
shell "$APP_URI" --eval 'db.probe.countDocuments()' >/dev/null 2>&1
check "same read works with the app user (control)" $?

shell 'mongodb://librechat:apppw@localhost:27017/admin?authSource=LibreChat' \
  --eval 'db.getSiblingDB("other").x.insertOne({ a: 1 })' >/dev/null 2>&1
[[ $? -ne 0 ]]
check "app user cannot write other databases" $?

shell "$APP_URI" --eval '
const lib = db.getSiblingDB("LibreChat");
const alice = ObjectId(), bob = ObjectId(), gone = ObjectId();
lib.users.insertMany([
  { _id: alice, email: "alice@example.com", name: "Alice" },
  { _id: bob, email: "bob@example.com", name: "Bob, Sales" },
]);
const at = (d) => new Date(d);
lib.transactions.insertMany([
  { user: alice, model: "claude-sonnet-5-5", tokenType: "prompt", rawAmount: -1000, tokenValue: -2000000, createdAt: at("2026-10-03") },
  { user: alice, model: "claude-sonnet-5-5", tokenType: "completion", rawAmount: -200, tokenValue: -2000000, createdAt: at("2026-10-03") },
  { user: alice, model: "gpt-6-sol", tokenType: "prompt", rawAmount: -500, tokenValue: -1000000, createdAt: at("2026-10-31T23:59:59Z") },
  { user: alice, tokenType: "credits", rawAmount: 20000000, tokenValue: 20000000, createdAt: at("2026-10-01") },
  { user: bob, model: "grok-4.7", tokenType: "prompt", rawAmount: -100, tokenValue: -200000, createdAt: at("2026-10-15") },
  { user: bob, model: "grok-4.7", tokenType: "prompt", rawAmount: -100, tokenValue: -200000, createdAt: at("2026-11-01") },
  { user: gone, model: "claude-opus-5-5", tokenType: "completion", rawAmount: -10, tokenValue: -200, createdAt: at("2026-10-20") },
  { user: alice, model: "claude-sonnet-5-5", tokenType: "prompt", rawAmount: -1, tokenValue: -2, createdAt: at("2024-01-01") },
]);
' >/dev/null 2>&1
check "seeded users and transactions" $?

EXEC_ENV=(-e REPORT_MONTH=2026-10)
csv=$(shell "$APP_URI" --file /reports/spend-report.js 2>&1)
expected="2026-10,alice@example.com,Alice,claude-sonnet-5-5,1000,200,4.000000
2026-10,alice@example.com,Alice,gpt-6-sol,500,0,1.000000
2026-10,bob@example.com,\"Bob, Sales\",grok-4.7,100,0,0.200000"
[[ "$(head -1 <<<"$csv")" == month,email,name,model,prompt_tokens,completion_tokens,usd ]] &&
  [[ "$(sed -n 3,5p <<<"$csv")" == "$expected" ]]
check "spend report groups by user and model, skips credits and other months" $?
[[ "$(sed -n 2p <<<"$csv")" == 2026-10,deleted:*,,claude-opus-5-5,0,10,0.000200 ]] && [[ $(wc -l <<<"$csv") -eq 5 ]]
check "spend report keeps spend of deleted users" $?
if [[ $failed -gt 0 ]]
then
  echo "$csv"
fi

EXEC_ENV=(-e REPORT_MONTH=bad)
shell "$APP_URI" --file /reports/spend-report.js >/dev/null 2>&1
[[ $? -ne 0 ]]
check "spend report rejects a bad month" $?

EXEC_ENV=(-e KEEP_MONTHS=13)
purge=$(shell "$APP_URI" --file /reports/purge-transactions.js 2>&1)
[[ "$purge" == "deleted 1 transactions before "* ]]
check "purge removes only transactions older than 13 months" $?

echo
echo "$passed passed, $failed failed"
[[ "$failed" -eq 0 ]]
