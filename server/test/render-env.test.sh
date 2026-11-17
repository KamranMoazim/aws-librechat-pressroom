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
    "$SCRIPT" "$WORK/out.env" >"$WORK/log" 2>&1
}

printf 'DOMAIN=${DOMAIN}\nURL=https://chat.${DOMAIN}/x\nKEY=${CREDS_KEY}\nOPT=${OPENAI_API_KEY:-}\nSCOPE="a b"\n' >"$WORK/template"

stub '[{"name": "/pressroom/config/domain", "value": "example.com"}, {"name": "/pressroom/secrets/creds-key", "value": "abc123"}]'
render
check "renders with optional value missing" $?
expected=$(printf 'DOMAIN=example.com\nURL=https://chat.example.com/x\nKEY=abc123\nOPT=\nSCOPE="a b"')
[[ "$(cat "$WORK/out.env")" == "$expected" ]]
check "substitutes required and optional names" $?
[[ "$(stat -f '%Lp' "$WORK/out.env" 2>/dev/null || stat -c '%a' "$WORK/out.env")" == "600" ]]
check "output is mode 600" $?

rm -f "$WORK/out.env"
stub '[{"name": "/pressroom/config/domain", "value": "example.com"}]'
render
[[ $? -ne 0 ]] && grep -q 'CREDS_KEY' "$WORK/log" && [[ ! -e "$WORK/out.env" ]]
check "fails and names a missing required parameter" $?

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
