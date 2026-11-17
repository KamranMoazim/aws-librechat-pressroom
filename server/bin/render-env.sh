#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${PRESSROOM_SSM_PREFIX:-/pressroom}"
OUT="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env}"

if [[ "$(id -u)" -ne 0 && "${PRESSROOM_ALLOW_NON_ROOT:-}" != "1" ]]
then
  echo "run as root: the .env holds every API key and secret"
  exit 1
fi

umask 077
tmp=$(mktemp "$OUT.XXXXXX")
trap 'rm -f "$tmp"' EXIT

aws ssm get-parameters-by-path --region "$REGION" --path "$PREFIX" --recursive --with-decryption \
  --query 'Parameters[].{name: Name, value: Value}' --output json |
  python3 -I -c '
import json, re, sys

entries = json.load(sys.stdin)
if not entries:
    sys.exit("no parameters found under the prefix")
for entry in sorted(entries, key=lambda item: item["name"]):
    key = entry["name"].rsplit("/", 1)[-1].upper().replace("-", "_")
    if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key):
        sys.exit("unusable parameter name: " + entry["name"])
    value = (
        entry["value"]
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("$", "$$")
        .replace("\n", "\\n")
    )
    print(key + "=\"" + value + "\"")
' >"$tmp"

chmod 600 "$tmp"
mv "$tmp" "$OUT"
trap - EXIT
echo "wrote $(wc -l <"$OUT" | tr -d ' ') keys to $OUT"
