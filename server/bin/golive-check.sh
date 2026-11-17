#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
require_root

usage()
{
  cat <<USAGE
usage: $0 CHECK [ARGS]   (prints JSON; read-only unless noted)
  convo CONVERSATION_ID [MESSAGE_ID...]   Mongo and Meilisearch presence
  file FILE_ID                            Mongo file record and pgvector embeddings
  expire CONVERSATION_ID                  WRITES: sets expiredAt in the past (retention test)
  balance EMAIL CREDITS                   WRITES: sets tokenCredits (and lastRefill, so no refill tops it up), prints the previous value
  spend YYYY-MM                           spend report rows and totals per model
  audit DAYS                              approved actions per tool and result
  audit-append-only                       tries UPDATE, DELETE, TRUNCATE inside rolled-back transactions
  denials SERVICE USER_OID MINUTES        denied tool calls in a connector's log
  container-ip SERVICE                    container address for an SSM port forward
  egress                                  runs bin/egress-check.sh
  backup-status | restore-log
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage
for arg in "$@"
do
  if [[ ! "$arg" =~ ^[A-Za-z0-9@._:+-]{1,200}$ ]]
  then
    echo "refusing argument: $arg"
    exit 2
  fi
done
check="$1"
shift

audit_sql()
{
  compose exec -T auditdb sh -c 'psql -U "$POSTGRES_USER" -d audit -v ON_ERROR_STOP=1 -tA' <<<"$1"
}

vector_sql()
{
  compose exec -T vectordb sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tA' <<<"$1"
}

meili_has()
{
  if ! has_service api
  then
    echo null
    return
  fi
  compose exec -T api node -e "
    const [index, ...ids] = process.argv.slice(1);
    Promise.all(ids.map((id) => fetch(process.env.MEILI_HOST + '/indexes/' + index + '/documents/' + encodeURIComponent(id),
      { headers: { Authorization: 'Bearer ' + process.env.MEILI_MASTER_KEY } }).then((r) => r.status === 200)))
      .then((found) => console.log(found.filter(Boolean).length));" "$@"
}

case "$check" in
  convo)
    [[ $# -ge 1 ]] || usage
    id="$1"
    shift
    mongo=$(mongo_eval "const ids = conn.messages.find({ conversationId: '$id' }, { messageId: 1 }).toArray().map((m) => m.messageId);
      print(JSON.stringify({ convos: conn.conversations.countDocuments({ conversationId: '$id' }), messages: ids.length, messageIds: ids }))")
    ids=("$@")
    if [[ ${#ids[@]} -eq 0 ]]
    then
      read -r -a ids <<<"$(python3 -I -c 'import json,sys; print(" ".join(json.loads(sys.argv[1])["messageIds"]))' "$mongo")"
    fi
    meili_convo=$(meili_has convos "$id")
    meili_messages=0
    if [[ ${#ids[@]} -gt 0 ]]
    then
      meili_messages=$(meili_has messages "${ids[@]}")
    fi
    python3 -I -c 'import json,sys
state = json.loads(sys.argv[1])
convo, messages = sys.argv[2], sys.argv[3]
state["meiliConvo"] = None if convo == "null" else convo == "1"
state["meiliMessages"] = None if messages == "null" else int(messages)
print(json.dumps(state))' "$mongo" "$meili_convo" "$meili_messages"
    ;;
  file)
    [[ $# -eq 1 ]] || usage
    files=$(mongo_eval "print(conn.files.countDocuments({ file_id: '$1' }))" | tr -d '[:space:]')
    if [[ "$(vector_sql "SELECT to_regclass('langchain_pg_embedding') IS NOT NULL")" == "t" ]]
    then
      vectors=$(vector_sql "SELECT count(*) FROM langchain_pg_embedding e WHERE e.cmetadata->>'file_id' = '$1' OR to_jsonb(e)->>'custom_id' = '$1'")
      echo "{\"files\": $files, \"vectors\": $vectors}"
    else
      echo "{\"files\": $files, \"vectors\": 0, \"note\": \"no langchain_pg_embedding table yet\"}"
    fi
    ;;
  expire)
    [[ $# -eq 1 ]] || usage
    mongo_eval "const past = new Date(Date.now() - 60000);
      const convos = conn.conversations.updateMany({ conversationId: '$1' }, { \$set: { expiredAt: past } }).modifiedCount;
      const messages = conn.messages.updateMany({ conversationId: '$1' }, { \$set: { expiredAt: past } }).modifiedCount;
      print(JSON.stringify({ updated: convos, messages }))"
    ;;
  balance)
    [[ $# -eq 2 && "$2" =~ ^[0-9]+$ ]] || usage
    mongo_eval "const user = conn.users.findOne({ email: '$1' });
      if (!user) { print(JSON.stringify({ error: 'no such user' })); quit(1); }
      const before = conn.balances.findOne({ user: user._id });
      conn.balances.updateOne({ user: user._id }, { \$set: { tokenCredits: $2, lastRefill: new Date() } }, { upsert: true });
      print(JSON.stringify({ previous: before ? before.tokenCredits : null, now: $2 }))"
    ;;
  spend)
    [[ $# -eq 1 && "$1" =~ ^[0-9]{4}-[0-9]{2}$ ]] || usage
    SKIP_UPLOAD=1 "$SERVER_DIR/bin/spend-report.sh" "$1" >/dev/null
    python3 -I -c 'import csv,json,sys
rows = list(csv.DictReader(open(sys.argv[1])))
totals = {}
for row in rows:
    totals[row["model"]] = round(totals.get(row["model"], 0) + float(row["usd"] or 0), 4)
print(json.dumps({"rows": len(rows), "users": len({r["email"] for r in rows}), "totals": totals}))' \
      "$SERVER_DIR/reports/out/$1.csv"
    ;;
  audit)
    [[ $# -eq 1 && "$1" =~ ^[0-9]+$ ]] || usage
    rows=$(audit_sql "SELECT coalesce(json_agg(t), '[]') FROM (SELECT tool, result, count(*) AS count,
      count(*) FILTER (WHERE user_oid = '' OR upn = '' OR target = '' OR args_sha256 = '') AS missing_fields
      FROM approved_actions WHERE at > now() - interval '$1 days' GROUP BY tool, result ORDER BY tool, result) t")
    echo "{\"days\": $1, \"rows\": $rows}"
    ;;
  audit-append-only)
    results=()
    for operation in "UPDATE approved_actions SET result = result" "DELETE FROM approved_actions" "TRUNCATE approved_actions"
    do
      answer=$(audit_sql "BEGIN; $operation; ROLLBACK;" 2>&1 || true)
      if grep -q "append-only" <<<"$answer"
      then
        results+=("refused")
      else
        results+=("allowed")
      fi
    done
    echo "{\"update\": \"${results[0]}\", \"delete\": \"${results[1]}\", \"truncate\": \"${results[2]}\"}"
    ;;
  denials)
    [[ $# -eq 3 && "$3" =~ ^[0-9]+$ ]] || usage
    count=$(compose logs --no-log-prefix --since "${3}m" "$1" 2>&1 | grep '"message":"denied"' | grep -c "\"userOid\":\"$2\"" || true)
    echo "{\"service\": \"$1\", \"count\": $count}"
    ;;
  container-ip)
    [[ $# -eq 1 ]] || usage
    container=$(compose ps -q "$1")
    if [[ -z "$container" ]]
    then
      echo "no running container for $1"
      exit 1
    fi
    docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$container" | awk '{print $1}'
    ;;
  egress)
    output=$("$SERVER_DIR/bin/egress-check.sh" 2>&1 || true)
    echo "{\"passes\": $(grep -c '^PASS' <<<"$output" || true), \"failures\": $(grep -c '^FAIL' <<<"$output" || true)}"
    ;;
  backup-status)
    last=$(cat "$STATE_DIR/backup.last-success" 2>/dev/null || echo 0)
    echo "{\"lastSuccess\": $last, \"ageHours\": $(( ($(date -u +%s) - last) / 3600 ))}"
    ;;
  restore-log)
    python3 -I -c 'import json,sys; lines=open(sys.argv[1]).read().splitlines() if __import__("os").path.exists(sys.argv[1]) else []; print(json.dumps({"last": lines[-1] if lines else ""}))' \
      "$STATE_DIR/restore.log"
    ;;
  *)
    usage
    ;;
esac
