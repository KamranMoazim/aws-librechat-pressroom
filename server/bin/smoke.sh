#!/usr/bin/env bash
set -uo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

WAIT_SECONDS="${SMOKE_WAIT:-300}"
failures=0

pass()
{
  echo "PASS $1"
}

fail()
{
  echo "FAIL $1"
  failures=$((failures + 1))
}

node_get()
{
  compose exec -T "$1" node -e "fetch('$2').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1
}

deadline=$(($(date -u +%s) + WAIT_SECONDS))
while true
do
  states=$(compose ps --all --format '{{.Service}} {{.State}} {{.Health}}')
  waiting=$(awk '$2 != "running" || ($3 != "" && $3 != "healthy")' <<<"$states")
  if [[ -z "$waiting" || $(date -u +%s) -ge $deadline ]]
  then
    break
  fi
  sleep 5
done
if [[ -z "$waiting" ]]
then
  pass "all $(wc -l <<<"$states" | tr -d ' ') containers running and healthy"
else
  fail "not running or not healthy: $(tr '\n' ';' <<<"$waiting")"
fi

if has_service mongodb
then
  if mongo_eval 'print(conn.runCommand({ping: 1}).ok)' | grep -q '^1$'
  then
    pass "mongodb answers"
  else
    fail "mongodb does not answer"
  fi
fi
if has_service auditdb
then
  if compose exec -T auditdb sh -c 'psql -U "$POSTGRES_USER" -d audit -tAc "SELECT count(*) FROM approved_actions"' >/dev/null 2>&1
  then
    pass "audit database answers"
  else
    fail "audit database does not answer"
  fi
fi
if has_service vectordb
then
  if compose exec -T vectordb sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1
  then
    pass "vector database answers"
  else
    fail "vector database does not answer"
  fi
fi
if has_service api
then
  if node_get api http://localhost:3080/health
  then
    pass "LibreChat /health"
  else
    fail "LibreChat /health"
  fi
fi
for server in mcp-outlook:8101 mcp-pace:8102 mcp-relevance:8103 mcp-voice:8104 portal:3000
do
  if has_service "${server%%:*}"
  then
    if node_get "${server%%:*}" "http://localhost:${server##*:}/healthz"
    then
      pass "${server%%:*} /healthz"
    else
      fail "${server%%:*} /healthz"
    fi
  fi
done
if has_service client
then
  domain=$(env_value DOMAIN)
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "chat.pressroom.$domain:443:127.0.0.1" "https://chat.pressroom.$domain/api/config")
  if [[ "$status" == "200" ]]
  then
    pass "https://chat.pressroom.$domain/api/config through nginx"
  else
    fail "https://chat.pressroom.$domain/api/config through nginx answered $status"
  fi
fi

if [[ $failures -gt 0 ]]
then
  echo "$failures smoke checks failed"
  exit 1
fi
echo "smoke checks passed"
