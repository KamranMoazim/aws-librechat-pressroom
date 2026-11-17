#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SERVER_DIR"
region=$(sed -n 's/^RELEVANCE_REGION=//p' .env)
if [[ -z "$region" ]]
then
  echo "RELEVANCE_REGION missing from $SERVER_DIR/.env (run as root after bin/render-env.sh)"
  exit 1
fi

ALLOWED=(api.anthropic.com api.openai.com api.x.ai api.elevenlabs.io graph.microsoft.com login.microsoftonline.com
  "api-$region.stack.tryrelevance.com")
BLOCKED=(api.mistral.ai generativelanguage.googleapis.com api.cohere.com api.deepseek.com api.groq.com relevanceai.com example.com)
CONTAINERS=(${EGRESS_CONTAINERS:-api mcp-relevance mcp-voice})

# DNS Firewall answers NXDOMAIN for blocked names, so a failed lookup is the block signal.
PROBE='
const host = process.argv[1];
require("node:dns").promises.lookup(host).then(
  () => fetch("https://" + host + "/", { method: "HEAD", signal: AbortSignal.timeout(10000) })
    .then((response) => console.log("open " + response.status))
    .catch((error) => console.log("error " + (error.cause?.code ?? error.name))),
  (error) => console.log(error.code === "ENOTFOUND" ? "blocked" : "error " + error.code),
);'

failures=0
probe()
{
  local container="$1" host="$2" want="$3" got
  got=$(docker compose exec -T "$container" node -e "$PROBE" "$host" 2>&1 | tail -n 1) || got="error could not exec in $container"
  if [[ "${got%% *}" == "$want" ]]
  then
    echo "PASS $container $host $got"
  else
    echo "FAIL $container $host expected $want, got: $got"
    failures=$((failures + 1))
  fi
}

for container in "${CONTAINERS[@]}"
do
  for host in "${ALLOWED[@]}"
  do
    probe "$container" "$host" open
  done
  for host in "${BLOCKED[@]}"
  do
    probe "$container" "$host" blocked
  done
done

if [[ $failures -gt 0 ]]
then
  echo "$failures egress checks failed"
  exit 1
fi
echo "egress matches the allowlist"
