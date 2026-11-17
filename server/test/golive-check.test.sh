#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$HERE/.." && pwd)"
MONGO_IMAGE="${MONGO_TEST_IMAGE:-mongo:8.0}"
VECTOR_IMAGE="${VECTOR_TEST_IMAGE:-pgvector/pgvector:pg16}"
AUDIT_IMAGE="${POSTGRES_TEST_IMAGE:-postgres:16-alpine}"
RUNNER=pressroom/backup-test-runner:local
VOLUME="pressroom-golivetest-$$"
ROOT=/srv
WORK="$ROOT/golivetest$$"
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
    return 1
  fi
}

in_runner()
{
  docker run --rm -i -v /var/run/docker.sock:/var/run/docker.sock -v "$VOLUME:$ROOT" -v "$SERVER_DIR:/src:ro" \
    -e PRESSROOM_ALLOW_NON_ROOT=1 "$RUNNER" "$@"
}

compose()
{
  in_runner docker compose --project-directory "$WORK" "$@"
}

golive()
{
  in_runner bash "$WORK/bin/golive-check.sh" "$@" </dev/null
}

cleanup()
{
  compose down -v >/dev/null 2>&1 </dev/null
  docker volume rm "$VOLUME" >/dev/null 2>&1
}
trap cleanup EXIT

if ! docker image inspect "$RUNNER" >/dev/null 2>&1
then
  echo "build the runner first: server/test/backup-restore.test.sh does it"
  exit 1
fi

mongo()
{
  compose exec -T mongodb mongosh --quiet -u root -p rootpw --authenticationDatabase admin LibreChat --eval "$1" </dev/null
}

docker volume create "$VOLUME" >/dev/null
in_runner sh -c "mkdir -p $WORK/state && cp -R /src/bin $WORK/bin && echo DOMAIN=example.test >$WORK/.env && cat >$WORK/docker-compose.yml" <<YAML
services:
  mongodb:
    image: $MONGO_IMAGE
    environment:
      - MONGO_INITDB_ROOT_USERNAME=root
      - MONGO_INITDB_ROOT_PASSWORD=rootpw
  vectordb:
    image: $VECTOR_IMAGE
    environment:
      - POSTGRES_DB=librechat_vectors
      - POSTGRES_USER=librechat
      - POSTGRES_PASSWORD=vectorpw
  auditdb:
    image: $AUDIT_IMAGE
    environment:
      - POSTGRES_USER=audit_admin
      - POSTGRES_PASSWORD=adminpw
      - POSTGRES_DB=audit
      - AUDIT_WRITER_PASSWORD=writerpw
    volumes:
      - $SERVER_DIR/auditdb/init:/docker-entrypoint-initdb.d:ro
  mcp-pace:
    image: alpine:latest
    command: ['sh', '-c', 'echo "{\"message\":\"denied\",\"userOid\":\"oid-bob\"}"; echo "{\"message\":\"denied\",\"userOid\":\"oid-bob\"}"; echo "{\"message\":\"denied\",\"userOid\":\"oid-eve\"}"; sleep 3600']
YAML
compose up -d >/dev/null 2>&1 </dev/null
for _ in $(seq 1 60)
do
  if mongo 'db.runCommand({ping: 1}).ok' 2>/dev/null | grep -q 1 &&
    compose exec -T auditdb psql -U audit_admin -d audit -tAc 'SELECT count(*) FROM approved_actions' >/dev/null 2>&1 </dev/null &&
    compose exec -T vectordb psql -U librechat -d librechat_vectors -tAc 'SELECT 1' >/dev/null 2>&1 </dev/null
  then
    break
  fi
  sleep 1
done

mongo 'const u = db.users.insertOne({email: "bob@x.test"}).insertedId; db.balances.insertOne({user: u, tokenCredits: 500});
  db.conversations.insertOne({conversationId: "c-1", user: "u"}); db.messages.insertMany([{conversationId: "c-1", messageId: "m-1"}, {conversationId: "c-1", messageId: "m-2"}]);
  db.files.insertOne({file_id: "f-1"}); db.conversations.createIndex({expiredAt: 1}, {expireAfterSeconds: 0}); db.messages.createIndex({expiredAt: 1}, {expireAfterSeconds: 0})' >/dev/null
compose exec -T vectordb psql -U librechat -d librechat_vectors -v ON_ERROR_STOP=1 -q </dev/null -c "CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE langchain_pg_embedding (id serial PRIMARY KEY, custom_id text, cmetadata jsonb, embedding vector(3));
  INSERT INTO langchain_pg_embedding (custom_id, cmetadata, embedding) VALUES ('f-1', '{}', '[1,2,3]'), (NULL, '{\"file_id\": \"f-1\"}', '[1,2,3]'), ('f-2', '{}', '[1,2,3]')"
compose exec -T auditdb psql -U audit_admin -d audit -v ON_ERROR_STOP=1 -q </dev/null -c "INSERT INTO approved_actions (user_oid, upn, tool, target, summary, args_sha256, result) VALUES
  ('oid-alice', 'alice@x', 'draft_reply', 'm1', 's', repeat('a', 64), 'drafted'),
  ('oid-alice', 'alice@x', 'job_update_commit', 'J1', 's', repeat('b', 64), 'committed'),
  ('oid-alice', 'alice@x', 'job_update_commit', 'J2', 's', repeat('c', 64), 'committed')"
in_runner sh -c "echo $(($(date +%s) - 7200)) >$WORK/state/backup.last-success && echo '2026-11-17T10:00:00Z restore of ab12 (x): data age at restore 30 min, restore took 21 min 4 s, smoke passed' >$WORK/state/restore.log" </dev/null

unsafe=$(golive convo 'c-1;rm' 2>&1)
[[ $? -ne 0 ]] && grep -q "refusing argument" <<<"$unsafe"
check "refuses arguments outside the safe character set" $?
[[ "$(golive convo c-1)" == '{"convos": 1, "messages": 2, "messageIds": ["m-1", "m-2"], "meiliConvo": null, "meiliMessages": null}' ]]
check "convo: conversation and its messages, search index skipped without the api" $? || golive convo c-1
[[ "$(golive file f-1)" == '{"files": 1, "vectors": 2}' ]]
check "file: record and embeddings matched by file_id metadata or custom_id" $? || golive file f-1
[[ "$(golive balance bob@x.test 0)" == '{"previous":500,"now":0}' ]]
check "balance: sets credits and returns the previous value" $? || golive balance bob@x.test 0
golive balance nobody@x.test 0 >/dev/null 2>&1
[[ $? -ne 0 ]]
check "balance: unknown user fails" $?
audit=$(golive audit 30)
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); r={(x["tool"],x["result"]):(x["count"],x["missing_fields"]) for x in d["rows"]}; sys.exit(0 if r=={("draft_reply","drafted"):(1,0),("job_update_commit","committed"):(2,0)} else 1)' "$audit"
check "audit: counts per tool and result, no missing fields" $? || echo "    $audit"
[[ "$(golive audit-append-only)" == '{"update": "refused", "delete": "refused", "truncate": "refused"}' ]]
check "audit-append-only: all three changes refused" $?
[[ "$(golive denials mcp-pace oid-bob 60)" == '{"service": "mcp-pace", "count": 2}' ]]
check "denials: counts one user's denied calls in a connector log" $? || golive denials mcp-pace oid-bob 60
[[ "$(golive container-ip mongodb)" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
check "container-ip: address of a service container" $?
grep -q '"ageHours": 2}' <<<"$(golive backup-status)"
check "backup-status: hours since the last good backup" $?
grep -q "smoke passed" <<<"$(golive restore-log)"
check "restore-log: last drill line" $?

[[ "$(golive expire c-1)" == '{"updated":1,"messages":2}' ]]
check "expire: moves the chat and its messages past retention" $?
removed=1
for _ in $(seq 1 30)
do
  if [[ "$(golive convo c-1)" == '{"convos": 0, "messages": 0, "messageIds": [], "meiliConvo": null, "meiliMessages": 0}' ]]
  then
    removed=0
    break
  fi
  sleep 5
done
[[ $removed -eq 0 ]]
check "expired chat is removed by the Mongo TTL monitor" $?

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
