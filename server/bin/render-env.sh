#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${PRESSROOM_SSM_PREFIX:-/pressroom}"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="${PRESSROOM_ENV_TEMPLATE:-$SERVER_DIR/.env.template}"
OUT="${1:-$SERVER_DIR/.env}"

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

template_path = sys.argv[1]
values = {}
for entry in json.load(sys.stdin):
    key = entry["name"].rsplit("/", 1)[-1].upper().replace("-", "_")
    if re.search(r"[\s\"\x27`$\\#]", entry["value"]):
        sys.exit("refusing " + entry["name"] + ": value has whitespace, quotes, $, # or backslash")
    values[key] = entry["value"]

missing = []

def substitute(match):
    name, optional = match.group(1), match.group(2) is not None
    if name in values:
        return values[name]
    if not optional:
        missing.append(name)
    return ""

with open(template_path) as template:
    rendered = re.sub(r"\$\{([A-Z_][A-Z0-9_]*)(:-)?\}", substitute, template.read())
if missing:
    sys.exit("missing SSM parameters for: " + ", ".join(sorted(set(missing))))
sys.stdout.write(rendered)
' "$TEMPLATE" >"$tmp"

chmod 600 "$tmp"
mv "$tmp" "$OUT"
trap - EXIT
echo "wrote $OUT from $(basename "$TEMPLATE")"
