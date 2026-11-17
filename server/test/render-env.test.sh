#!/usr/bin/env bash
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/bin/render-env.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
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

stub()
{
  printf '#!/usr/bin/env bash\ncat <<%sJSON%s\n%s\nJSON\n' "'" "'" "$1" >"$WORK/bin/aws"
  chmod +x "$WORK/bin/aws"
}

render()
{
  PATH="$WORK/bin:$PATH" PRESSROOM_ALLOW_NON_ROOT=1 PRESSROOM_ENV_TEMPLATE="$WORK/template" \
    PRESSROOM_YAML_TEMPLATE="$WORK/yaml-template" "$SCRIPT" "$WORK/out.env" "$WORK/out.yaml" >"$WORK/log" 2>&1
}

printf "scopes: 'api://@@MCP_CLIENT_ID@@/Mcp.Tools'\nkey: '\${XAI_API_KEY}'\n" >"$WORK/yaml-template"
printf 'DOMAIN=${DOMAIN}\nURL=https://chat.${DOMAIN}/x\nKEY=${CREDS_KEY}\nOPT=${OPENAI_API_KEY:-}\nSCOPE="a b"\n' >"$WORK/template"

stub '[{"name": "/pressroom/config/domain", "value": "example.com"}, {"name": "/pressroom/config/acme-email", "value": "it@example.com"}, {"name": "/pressroom/config/mcp-client-id", "value": "app-guid"}, {"name": "/pressroom/secrets/creds-key", "value": "abc123"}, {"name": "/pressroom/secrets/xai-api-key", "value": "xai-secret"}]'
render
check "renders with optional value missing and an email address" $?
[[ "$(cat "$WORK/out.yaml")" == "$(printf "scopes: 'api://app-guid/Mcp.Tools'\nkey: '\${XAI_API_KEY}'")" ]]
check "yaml gets config values and leaves LibreChat placeholders alone" $?
! grep -q 'xai-secret\|abc123' "$WORK/out.yaml"
check "yaml never receives secrets" $?
[[ "$(stat -f '%Lp' "$WORK/out.yaml" 2>/dev/null || stat -c '%a' "$WORK/out.yaml")" == "644" ]]
check "yaml is world-readable for the container (644)" $?
expected=$(printf 'DOMAIN=example.com\nURL=https://chat.example.com/x\nKEY=abc123\nOPT=\nSCOPE="a b"')
[[ "$(cat "$WORK/out.env")" == "$expected" ]]
check "substitutes required and optional names" $?
[[ "$(stat -f '%Lp' "$WORK/out.env" 2>/dev/null || stat -c '%a' "$WORK/out.env")" == "600" ]]
check "output is mode 600" $?

rm -f "$WORK/out.env" "$WORK/out.yaml"
stub '[{"name": "/pressroom/config/domain", "value": "example.com"}, {"name": "/pressroom/config/mcp-client-id", "value": "x"}]'
render
[[ $? -ne 0 ]] && grep -q 'CREDS_KEY' "$WORK/log" && [[ ! -e "$WORK/out.env" ]] && [[ ! -e "$WORK/out.yaml" ]]
check "fails and names a missing required parameter, writes nothing" $?

stub '[{"name": "/pressroom/config/domain", "value": "example.com"}, {"name": "/pressroom/secrets/creds-key", "value": "x"}, {"name": "/pressroom/secrets/mcp-client-id", "value": "secret-path"}]'
render
[[ $? -ne 0 ]] && grep -q 'MCP_CLIENT_ID' "$WORK/log"
check "yaml placeholders only resolve from /config/, not /secrets/" $?

stub '[{"name": "/pressroom/config/domain", "value": "exa mple"}, {"name": "/pressroom/secrets/creds-key", "value": "x"}]'
render
[[ $? -ne 0 ]] && [[ ! -e "$WORK/out.env" ]]
check "refuses values with whitespace" $?

stub '[{"name": "/pressroom/config/domain", "value": "a$b"}, {"name": "/pressroom/secrets/creds-key", "value": "x"}]'
render
[[ $? -ne 0 ]]
check "refuses values with a dollar sign" $?

echo
echo "$passed passed, $failed failed"
[[ "$failed" -eq 0 ]]
