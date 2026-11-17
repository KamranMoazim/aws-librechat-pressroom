# shellcheck shell=bash
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${PRESSROOM_STATE_DIR:-$SERVER_DIR/state}"
RESTIC_HOST=pressroom

env_value()
{
  sed -n "s/^$1=//p" "$SERVER_DIR/.env" | tail -n 1
}

compose()
{
  docker compose --project-directory "$SERVER_DIR" "$@"
}

has_service()
{
  compose config --services | grep -x "$1" >/dev/null
}

mongo_eval()
{
  compose exec -T mongodb mongosh --quiet --nodb --eval \
    "const conn = connect('mongodb://root:' + encodeURIComponent(process.env.MONGO_INITDB_ROOT_PASSWORD) + '@localhost:27017/LibreChat?authSource=admin'); $1"
}

mongo_tool()
{
  compose exec -T mongodb sh -c 'umask 077; config=$(mktemp); printf "password: \"%s\"\n" "$MONGO_INITDB_ROOT_PASSWORD" >"$config"; "$@" --config "$config" --username root --authenticationDatabase admin; status=$?; rm -f "$config"; exit $status' sh "$@"
}

require_root()
{
  if [[ "$(id -u)" -ne 0 && "${PRESSROOM_ALLOW_NON_ROOT:-}" != "1" ]]
  then
    echo "run as root"
    exit 1
  fi
}

restic_env()
{
  RESTIC_PASSWORD="$(env_value RESTIC_PASSWORD)"
  if [[ -z "$RESTIC_PASSWORD" ]]
  then
    echo "RESTIC_PASSWORD missing from $SERVER_DIR/.env"
    exit 1
  fi
  if [[ -z "${RESTIC_REPOSITORY:-}" ]]
  then
    RESTIC_REPOSITORY="$(env_value RESTIC_REPOSITORY)"
  fi
  if [[ -z "$RESTIC_REPOSITORY" ]]
  then
    local account
    account=$(aws sts get-caller-identity --query Account --output text)
    RESTIC_REPOSITORY="s3:s3.us-west-2.amazonaws.com/pressroom-backup-$account-us-west-2/restic"
  fi
  export RESTIC_PASSWORD RESTIC_REPOSITORY AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-west-2}"
}
