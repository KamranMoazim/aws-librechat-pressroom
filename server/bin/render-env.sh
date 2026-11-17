#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${PRESSROOM_SSM_PREFIX:-/pressroom}"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_TEMPLATE="${PRESSROOM_ENV_TEMPLATE:-$SERVER_DIR/.env.template}"
ENV_OUT="${1:-$SERVER_DIR/.env}"
YAML_TEMPLATE="${PRESSROOM_YAML_TEMPLATE:-$SERVER_DIR/librechat.template.yaml}"
YAML_OUT="${2:-$SERVER_DIR/librechat.yaml}"

if [[ "$(id -u)" -ne 0 && "${PRESSROOM_ALLOW_NON_ROOT:-}" != "1" ]]
then
  echo "run as root: the .env holds every API key and secret"
  exit 1
fi

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

aws ssm get-parameters-by-path --region "$REGION" --path "$PREFIX" --recursive --with-decryption \
  --query 'Parameters[].{name: Name, value: Value}' --output json >"$work/params.json"

render()
{
  python3 -I - "$work/params.json" "$1" "$2" >"$3" <<'PY'
import json, re, sys

params_path, template_path, mode = sys.argv[1:4]
values = {}
for entry in json.load(open(params_path)):
    if mode == "yaml" and "/config/" not in entry["name"]:
        continue
    key = entry["name"].rsplit("/", 1)[-1].upper().replace("-", "_")
    if re.search(r"[\s\"\x27`$\\#{}]", entry["value"]):
        sys.exit("refusing " + entry["name"] + ": value has whitespace, quotes, $, #, braces or backslash")
    values[key] = entry["value"]

missing = []

def substitute(match):
    name = match.group(1)
    optional = match.group(2) is not None if mode == "env" else False
    if name in values:
        return values[name]
    if not optional:
        missing.append(name)
    return ""

pattern = r"\$\{([A-Z_][A-Z0-9_]*)(:-)?\}" if mode == "env" else r"@@([A-Z_][A-Z0-9_]*)@@()"
with open(template_path) as template:
    rendered = re.sub(pattern, substitute, template.read())
if missing:
    sys.exit("missing SSM parameters for: " + ", ".join(sorted(set(missing))))
sys.stdout.write(rendered)
PY
}

render "$ENV_TEMPLATE" env "$work/env"
render "$YAML_TEMPLATE" yaml "$work/yaml"

chmod 600 "$work/env"
chmod 644 "$work/yaml"
mv "$work/env" "$ENV_OUT"
mv "$work/yaml" "$YAML_OUT"
echo "wrote $ENV_OUT and $YAML_OUT"
