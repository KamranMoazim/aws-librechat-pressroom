#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export API_PORT="${API_PORT:-18301}" PORTAL_PORT="${PORTAL_PORT:-18302}" HTTPS_PORT="${HTTPS_PORT:-18443}"
CHAT=chat.pressroom.example.test
PORTAL=portal.pressroom.example.test
passed=0
failed=0
pids=()

cleanup()
{
  "$HERE/embed/stack.sh" down
  for pid in "${pids[@]}"
  do
    kill "$pid" 2>/dev/null
  done
}
trap cleanup EXIT

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

request()
{
  local host="$1"
  shift
  curl -sk -o /dev/null -D - --resolve "$host:$HTTPS_PORT:127.0.0.1" "$@" | tr -d '\r'
}

url()
{
  echo "https://$1:$HTTPS_PORT$2"
}

node "$HERE/embed/stub-librechat.mjs" "$API_PORT" &
pids+=($!)
node -e "require('node:http').createServer((q, s) => s.end('portal stub')).listen($PORTAL_PORT, '0.0.0.0')" &
pids+=($!)
"$HERE/embed/stack.sh" up || exit 1

home=$(request "$CHAT" "$(url $CHAT /c/new)")
grep -qi "^content-security-policy: frame-ancestors 'self' https://$PORTAL$" <<<"$home"
check "every chat response says only the portal may frame it" $?
grep -qi "^strict-transport-security:" <<<"$home"
check "chat responses keep HSTS" $?

probe=$(request "$CHAT" "$(url $CHAT /pressroom/session.html)")
grep -q "^HTTP/[0-9.]* 200" <<<"$probe" &&
  grep -qi "^content-security-policy: default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors https://$PORTAL$" <<<"$probe" &&
  grep -qi "^cache-control: no-store" <<<"$probe" && grep -qi "^strict-transport-security:" <<<"$probe"
check "session probe is served with a strict policy, framable only by the portal" $?
probe_count=$(grep -ci "^content-security-policy:" <<<"$probe")
[[ "$probe_count" == "1" ]]
check "session probe has exactly one CSP header" $?
script=$(request "$CHAT" "$(url $CHAT /pressroom/session.js)")
grep -qi "^content-type: application/javascript" <<<"$script"
check "session probe script is javascript" $?
leaked=0
for path in '/pressroom/..%2f..%2f..%2fetc/passwd' '/pressroom../etc/passwd' '/pressroom/../../../etc/passwd'
do
  body=$(curl -sk --path-as-is --resolve "$CHAT:$HTTPS_PORT:127.0.0.1" "$(url $CHAT "$path")")
  if grep -q "root:" <<<"$body"
  then
    leaked=1
  fi
done
[[ $leaked -eq 0 ]]
check "pressroom folder cannot be walked out of" $?

signin=$(request "$CHAT" "$(url $CHAT /pressroom/signin)")
grep -q "^HTTP/[0-9.]* 302" <<<"$signin" && grep -qi "^location: .*/oauth/openid$" <<<"$signin" &&
  grep -qi "^set-cookie: pressroom_return=portal; Path=/oauth; Max-Age=120; Secure; HttpOnly; SameSite=Lax" <<<"$signin"
check "sign-in starter sets the return cookie and goes to LibreChat sign-in" $?

plain=$(request "$CHAT" "$(url $CHAT /oauth/openid/callback?code=stub)")
grep -qi "^location: https://$CHAT$" <<<"$plain" && grep -qi "^set-cookie: refreshToken=valid" <<<"$plain"
check "callback without the cookie still lands in the chat" $?
grep -qi "^content-security-policy: frame-ancestors" <<<"$plain" && grep -qi "^strict-transport-security:" <<<"$plain"
check "callback keeps HSTS and framing headers" $?

back=$(request "$CHAT" "$(url $CHAT /oauth/openid/callback?code=stub)" -H "Cookie: pressroom_return=portal")
grep -qi "^location: https://$PORTAL/$" <<<"$back"
check "callback with the cookie goes back to the portal" $?
grep -qi "^set-cookie: refreshToken=valid" <<<"$back" && grep -qi "^set-cookie: pressroom_return=; Path=/oauth; Max-Age=0" <<<"$back"
check "LibreChat's session cookie is kept and the return cookie is cleared" $?

failure=$(request "$CHAT" "$(url $CHAT '/oauth/openid/callback?fail=1')" -H "Cookie: pressroom_return=portal")
grep -qi "^location: https://$CHAT/login?redirect=false&error=auth_failed$" <<<"$failure"
check "a failed sign-in is not sent to the portal" $?

other=$(request "$CHAT" "$(url $CHAT /oauth/openid/callback?code=stub)" -H "Cookie: pressroom_return=https://evil.example")
grep -qi "^location: https://$CHAT$" <<<"$other"
check "only the fixed portal address can be a return target" $?

portal=$(curl -sk --resolve "$PORTAL:$HTTPS_PORT:127.0.0.1" "$(url $PORTAL /)")
[[ "$portal" == "portal stub" ]]
check "portal host is proxied to the portal container" $?

curl -sk -o /dev/null --resolve "evil.example.test:$HTTPS_PORT:127.0.0.1" "$(url evil.example.test /)"
[[ $? -ne 0 ]]
check "unknown host is still refused at TLS" $?

docker exec embed-client nginx -t >/dev/null 2>&1
check "nginx -t passes in the pinned image" $?

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
