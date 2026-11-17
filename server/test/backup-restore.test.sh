#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$HERE/.." && pwd)"
MONGO_IMAGE="${MONGO_TEST_IMAGE:-mongo:8.0}"
VECTOR_IMAGE="${VECTOR_TEST_IMAGE:-pgvector/pgvector:pg16}"
AUDIT_IMAGE="${POSTGRES_TEST_IMAGE:-postgres:16-alpine}"
RUNNER=pressroom/backup-test-runner:local
# Docker Desktop's file sharing answers EIO to restic's O_NOATIME reads, so the test server lives on a volume.
VOLUME="pressroom-backuptest-$$"
ROOT=/srv
WORK="$ROOT/backuptest$$"
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
  docker run --rm -i -v /var/run/docker.sock:/var/run/docker.sock -v "$VOLUME:$ROOT" \
    -v "$SERVER_DIR:/src:ro" \
    -e PRESSROOM_ALLOW_NON_ROOT=1 -e BACKUP_STAGE="$ROOT/stage" -e RESTORE_BASE="$ROOT/restore" \
    -e LETSENCRYPT_DIR="$ROOT/letsencrypt" -e SMOKE_WAIT=90 -e METRICS_SINK=stdout \
    -e CERT_FILE="$ROOT/letsencrypt/live/pressroom/cert.pem" "$RUNNER" "$@"
}

compose()
{
  in_runner docker compose --project-directory "$WORK" "$@"
}

cleanup()
{
  compose down -v >/dev/null 2>&1
  docker volume rm "$VOLUME" >/dev/null 2>&1
}
trap cleanup EXIT

if ! docker image inspect "$RUNNER" >/dev/null 2>&1
then
  docker rm -f pressroom-runner-build >/dev/null 2>&1
  docker run --name pressroom-runner-build alpine:latest \
    sh -c 'apk add --no-cache bash coreutils python3 openssl restic age docker-cli docker-cli-compose >/dev/null' || exit 1
  docker commit pressroom-runner-build "$RUNNER" >/dev/null
  docker rm pressroom-runner-build >/dev/null
fi

mongo()
{
  compose exec -T mongodb mongosh --quiet -u root -p rootpw --authenticationDatabase admin LibreChat --eval "$1" </dev/null
}

vector()
{
  compose exec -T vectordb psql -U librechat -d librechat_vectors -v ON_ERROR_STOP=1 -tAc "$1" </dev/null
}

audit()
{
  compose exec -T auditdb psql -U audit_admin -d audit -v ON_ERROR_STOP=1 -tAc "$1" </dev/null
}

wait_ready()
{
  for _ in $(seq 1 60)
  do
    if mongo 'db.runCommand({ping: 1}).ok' 2>/dev/null | grep -q 1 &&
      vector 'SELECT 1' >/dev/null 2>&1 && audit 'SELECT count(*) FROM approved_actions' >/dev/null 2>&1
    then
      return 0
    fi
    sleep 1
  done
  return 1
}

docker volume create "$VOLUME" >/dev/null
in_runner sh -c "
  set -e
  mkdir -p $WORK/uploads/user1 $ROOT/repo $ROOT/letsencrypt/live/pressroom
  cp -R /src/bin $WORK/bin
  age-keygen -o $ROOT/identity.txt 2>/dev/null
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=chat.pressroom.example.test \
    -keyout $ROOT/letsencrypt/live/pressroom/privkey.pem -out $ROOT/letsencrypt/live/pressroom/cert.pem 2>/dev/null
  echo 'quote for Acme' >$WORK/uploads/user1/quote.pdf
  printf 'RESTIC_PASSWORD=test-restic-password\nRESTIC_REPOSITORY=$ROOT/repo\nBACKUP_AGE_RECIPIENT=%s\nDOMAIN=example.test\n' \
    \"\$(age-keygen -y $ROOT/identity.txt)\" >$WORK/.env
  cat >$WORK/docker-compose.yml
" <<YAML
services:
  mongodb:
    image: $MONGO_IMAGE
    environment:
      - MONGO_INITDB_ROOT_USERNAME=root
      - MONGO_INITDB_ROOT_PASSWORD=rootpw
    volumes:
      - mongodata:/data/db
  vectordb:
    image: $VECTOR_IMAGE
    environment:
      - POSTGRES_DB=librechat_vectors
      - POSTGRES_USER=librechat
      - POSTGRES_PASSWORD=vectorpw
    volumes:
      - vectordata:/var/lib/postgresql/data
  auditdb:
    image: $AUDIT_IMAGE
    environment:
      - POSTGRES_USER=audit_admin
      - POSTGRES_PASSWORD=adminpw
      - POSTGRES_DB=audit
      - AUDIT_WRITER_PASSWORD=writerpw
    volumes:
      - $SERVER_DIR/auditdb/init:/docker-entrypoint-initdb.d:ro
      - auditdata:/var/lib/postgresql/data
volumes:
  mongodata:
  vectordata:
  auditdata:
YAML

compose up -d >/dev/null 2>&1 </dev/null
wait_ready
check "test stack is up" $?

empty=$(in_runner bash "$WORK/bin/backup.sh" 2>&1 </dev/null)
[[ $? -ne 0 ]] && grep -q "refusing: LibreChat has no users" <<<"$empty"
check "backup refuses an empty server (it would become the newest snapshot)" $?

mongo 'db.users.insertOne({email: "alice@x", provider: "openid"})' >/dev/null
mongo 'db.conversations.insertMany([{conversationId: "c1", user: "alice", title: "Banner proof"}, {conversationId: "c2", user: "bob", title: "Invoice"}]); db.messages.insertOne({conversationId: "c1", text: "ships Friday"})' >/dev/null
vector "CREATE EXTENSION IF NOT EXISTS vector; CREATE TABLE embeddings (id int PRIMARY KEY, file_id text, v vector(3)); INSERT INTO embeddings VALUES (1, 'f1', '[1,2,3]'), (2, 'f2', '[4,5,6]')" >/dev/null
audit "INSERT INTO approved_actions (user_oid, upn, tool, target, summary, args_sha256, result) VALUES ('oid-alice', 'alice@x', 'job_update_commit', 'J24017', 'status -> printing', repeat('a', 64), 'committed'), ('oid-alice', 'alice@x', 'draft_reply', 'm1', 'reply', repeat('b', 64), 'drafted')" >/dev/null

first=$(in_runner bash "$WORK/bin/backup.sh" 2>&1 </dev/null)
grep -q "^backup [0-9a-f]* (nightly) done" <<<"$first"
check "backup.sh dumps three databases, encrypts .env and writes a restic snapshot" $? || sed 's/^/    /' <<<"$first" | tail -8
in_runner test -s "$WORK/state/backup.last-success" </dev/null
check "backup records its success time" $?
second=$(in_runner env BACKUP_TAG=pre-update bash "$WORK/bin/backup.sh" 2>&1 </dev/null)
grep -q "(pre-update) done" <<<"$second"
check "pre-update backup is tagged separately" $? || sed 's/^/    /' <<<"$second" | tail -8
snapshot_count=$(in_runner sh -c "RESTIC_PASSWORD=test-restic-password restic -r $ROOT/repo snapshots --json" </dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
[[ "$snapshot_count" == "2" ]]
check "repository holds both snapshots" $?
listing=$(in_runner sh -c "RESTIC_PASSWORD=test-restic-password restic -r $ROOT/repo ls latest" </dev/null)
grep -q "env.age$" <<<"$listing" && ! grep -q "/\.env$" <<<"$listing" &&
  grep -q "letsencrypt/live/pressroom/privkey.pem" <<<"$listing" && grep -q "uploads/user1/quote.pdf" <<<"$listing"
check "snapshot has the encrypted .env (not the plain one), certificates and uploads" $?

metrics=$(in_runner bash "$WORK/bin/health-metrics.sh" 2>&1 </dev/null)
grep -q "BackupAgeHours=0 CertDaysLeft=29 UnhealthyContainers=0 ApiRestarts=0" <<<"$metrics"
check "health metrics: fresh backup, cert days, no unhealthy containers" $? || echo "    $metrics"
compose stop vectordb >/dev/null 2>&1 </dev/null
stopped=$(in_runner bash "$WORK/bin/health-metrics.sh" 2>&1 </dev/null)
grep -q "UnhealthyContainers=1 " <<<"$stopped"
check "a stopped service counts as unhealthy" $? || echo "    $stopped"

nightly_id=$(in_runner sh -c "RESTIC_PASSWORD=test-restic-password restic -r $ROOT/repo snapshots --tag nightly --json" </dev/null |
  python3 -c 'import json,sys; print(json.load(sys.stdin)[-1]["short_id"])')
compose down -v >/dev/null 2>&1 </dev/null
in_runner rm -rf "$WORK/uploads" "$ROOT/letsencrypt" </dev/null
compose up -d >/dev/null 2>&1 </dev/null
wait_ready
[[ "$(mongo 'db.conversations.countDocuments()')" == "0" ]]
check "fresh databases are empty before restore" $?

listed=$(in_runner bash "$WORK/bin/restore.sh" --list 2>&1 </dev/null)
grep -q "$nightly_id" <<<"$listed"
check "restore --list shows the snapshots" $?
no_id=$(in_runner bash "$WORK/bin/restore.sh" --yes 2>&1 </dev/null)
[[ $? -ne 0 ]] && grep -q "Pick the snapshot by its time" <<<"$no_id"
check "restore needs an explicit snapshot" $?

restore=$(in_runner bash "$WORK/bin/restore.sh" --yes --env-identity "$ROOT/identity.txt" "$nightly_id" 2>&1 </dev/null)
restore_status=$?
[[ $restore_status -eq 0 ]]
check "restore.sh finishes and its smoke checks pass" $? || sed 's/^/    /' <<<"$restore" | tail -12
[[ "$(mongo 'db.conversations.countDocuments()')" == "2" && "$(mongo 'db.messages.findOne({conversationId: "c1"}).text')" == "ships Friday" ]]
check "conversations and messages are back" $?
[[ "$(vector "SELECT string_agg(file_id || ':' || v::text, ',' ORDER BY id) FROM embeddings")" == "f1:[1,2,3],f2:[4,5,6]" ]]
check "vectors are back" $?
[[ "$(audit "SELECT string_agg(id || ':' || target, ',' ORDER BY id) FROM approved_actions")" == "1:J24017,2:m1" ]]
check "approved actions are back with their ids" $?
audit "UPDATE approved_actions SET result = 'x'" >/dev/null 2>&1
[[ $? -ne 0 ]]
check "restored approved actions are still append-only" $?
[[ "$(audit "INSERT INTO approved_actions (user_oid, upn, tool, target, summary, args_sha256, result) VALUES ('o', 'u', 't', 'x', 's', repeat('c', 64), 'r') RETURNING id")" =~ ^3 ]]
check "new approved actions continue after the restored ids" $?
[[ "$(in_runner cat "$WORK/uploads/user1/quote.pdf" 2>/dev/null </dev/null)" == "quote for Acme" ]]
check "uploaded files are back" $?
in_runner cmp -s "$WORK/.env" "$WORK/.env.from-backup" </dev/null
check "backed-up .env decrypts with the age identity and matches" $?
in_runner grep -q "restore of [0-9a-f]* .*smoke passed" "$WORK/state/restore.log" </dev/null
check "restore writes data age and duration to restore.log" $?
in_runner test -s "$ROOT/letsencrypt/live/pressroom/privkey.pem" </dev/null
check "missing certificates come back from the snapshot" $?
leftovers=$(in_runner sh -c "ls -d $ROOT/restore/restore.* 2>/dev/null | wc -l" </dev/null | tr -d ' ')
[[ "$leftovers" == "0" ]]
check "restore removes its plaintext working copy" $?

again=$(in_runner bash "$WORK/bin/restore.sh" --yes "$nightly_id" 2>&1 </dev/null)
again_status=$?
[[ $again_status -ne 0 ]] && grep -q "append-only: restore onto a fresh audit database" <<<"$again"
check "restore refuses to run over existing approved actions" $?
mongo 'db.conversations.insertOne({conversationId: "c3", user: "alice", title: "made after the backup"})' >/dev/null
rollback=$(in_runner bash "$WORK/bin/restore.sh" --yes --keep-audit "$nightly_id" 2>&1 </dev/null)
rollback_status=$?
[[ $rollback_status -eq 0 && "$(mongo 'db.conversations.countDocuments()')" == "2" &&
  "$(audit "SELECT count(*) FROM approved_actions")" == "3" ]]
check "--keep-audit rolls chats back and leaves approved actions untouched" $? || sed 's/^/    /' <<<"$rollback" | tail -8
unconfirmed=$(in_runner bash "$WORK/bin/restore.sh" 2>&1 </dev/null)
[[ $? -ne 0 ]] && grep -q "usage" <<<"$unconfirmed"
check "restore needs --yes" $?

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
