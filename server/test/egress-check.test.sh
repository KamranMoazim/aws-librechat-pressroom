#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
passed=0
failed=0

check()
{
  if [[ "$2" == "0" ]]
  then
    echo "PASS $1"
    passed=$((passed + 1))
  else
    echo "FAIL $1"
    failed=$((failed + 1))
  fi
}

mkdir -p "$work/server/bin" "$work/fakebin"
cp "$ROOT/bin/egress-check.sh" "$work/server/bin/"
echo "RELEVANCE_REGION=f1db6c" >"$work/server/.env"
cat >"$work/fakebin/docker" <<'SH'
#!/usr/bin/env bash
host="${!#}"
echo "$host" >>"$FAKE_LOG"
if [[ -n "${FAKE_EXEC_FAIL:-}" && " $* " == *" $FAKE_EXEC_FAIL "* ]]
then
  echo "service \"$FAKE_EXEC_FAIL\" is not running" >&2
  exit 1
fi
case "$host" in
  api.mistral.ai|generativelanguage.googleapis.com|api.cohere.com|api.deepseek.com|api.groq.com|relevanceai.com|example.com)
    [[ "${LEAK:-}" == "$host" ]] && echo "open 200" || echo "blocked" ;;
  *) echo "open 404" ;;
esac
SH
chmod +x "$work/fakebin/docker"
set +e

export FAKE_LOG="$work/log"
output=$(PATH="$work/fakebin:$PATH" EGRESS_CONTAINERS=api "$work/server/bin/egress-check.sh")
check "all allowed open and all others blocked passes" $?
grep -q "api-f1db6c.stack.tryrelevance.com" "$FAKE_LOG"
check "relevance regional host comes from .env" $?
[[ "$(grep -c '^PASS' <<<"$output")" == "14" ]]
check "probes 7 allowed and 7 blocked hosts" $?

PATH="$work/fakebin:$PATH" EGRESS_CONTAINERS=api LEAK=api.mistral.ai "$work/server/bin/egress-check.sh" >"$work/leak" 2>&1
status=$?
[[ $status -ne 0 ]] && grep -q "FAIL api api.mistral.ai expected blocked" "$work/leak"
check "a reachable unapproved provider fails the check" $?

PATH="$work/fakebin:$PATH" EGRESS_CONTAINERS="api broken" FAKE_EXEC_FAIL=broken "$work/server/bin/egress-check.sh" >"$work/broken" 2>&1
status=$?
[[ $status -ne 0 ]] && grep -q "FAIL broken api.mistral.ai expected blocked, got: error could not exec" "$work/broken" &&
  grep -q "egress checks failed" "$work/broken"
check "a container that cannot exec fails its probes but the run completes" $?

echo "OTHER=1" >"$work/server/.env"
PATH="$work/fakebin:$PATH" EGRESS_CONTAINERS=api "$work/server/bin/egress-check.sh" >"$work/noregion" 2>&1
status=$?
[[ $status -ne 0 ]] && grep -q "RELEVANCE_REGION missing" "$work/noregion"
check "missing relevance region fails instead of skipping the host" $?

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
