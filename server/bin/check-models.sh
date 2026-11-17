#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
key()
{
  sed -n "s/^$1=//p" "$SERVER_DIR/.env"
}

failures=0
while read -r endpoint model
do
  case "$endpoint" in
    anthropic)
      code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $(key ANTHROPIC_API_KEY)" \
        -H 'anthropic-version: 2023-06-01' "https://api.anthropic.com/v1/models/$model")
      ;;
    openAI)
      code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(key OPENAI_API_KEY)" \
        "https://api.openai.com/v1/models/$model")
      ;;
    xAI)
      code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(key XAI_API_KEY)" \
        "https://api.x.ai/v1/models/$model")
      ;;
    *)
      code=unknown-endpoint
      ;;
  esac
  if [[ "$code" == "200" ]]
  then
    echo "ok   $endpoint $model"
  else
    echo "FAIL $endpoint $model ($code)"
    failures=$((failures + 1))
  fi
done < <(sed -n -E "s/.*preset: \{ endpoint: ([A-Za-z]+), model: '?([A-Za-z0-9._-]+)'? \}.*/\1 \2/p" \
  "$SERVER_DIR/librechat.yaml")

[[ "$failures" -eq 0 ]]
