#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-us-east-1}"
try_env()
{
  sed -n "s/^$1=//p" .env 2>/dev/null || true
}

exists()
{
  aws ssm get-parameter --region "$REGION" --name "$1" >/dev/null 2>&1
}

put()
{
  aws ssm put-parameter --region "$REGION" --name "$1" --type "$2" --value "$3" --overwrite >/dev/null
  echo "set $1"
}

generate()
{
  local name="/pressroom/secrets/$1"
  if exists "$name"
  then
    echo "kept $name"
  else
    put "$name" SecureString "$(openssl rand -hex "$2")"
  fi
}

config()
{
  local name="/pressroom/config/$1" value="$2"
  if [[ -z "$value" ]]
  then
    if exists "$name"
    then
      echo "kept $name"
      return
    fi
    read -r -p "$1: " value
  fi
  put "$name" String "$value"
}

provider_key()
{
  local name="/pressroom/secrets/$1" value
  if exists "$name" && [[ "${ROTATE_PROVIDER_KEYS:-}" != "1" ]]
  then
    echo "kept $name"
    return
  fi
  read -r -s -p "$2 (empty to skip): " value
  echo
  if [[ -n "$value" ]]
  then
    put "$name" SecureString "$value"
  fi
}

# CREDS_KEY and CREDS_IV are never regenerated: stored credentials become unreadable without them.
generate creds-key 32
generate creds-iv 16
generate jwt-secret 32
generate jwt-refresh-secret 32
generate meili-master-key 32
generate mongo-root-password 24
generate mongo-app-password 24
generate postgres-password 24
generate admin-panel-session-secret 32
generate openid-session-secret 32

config domain "$(try_env DOMAIN)"
config acme-email "$(try_env ALERT_EMAIL)"
config entra-tenant-id "$(try_env ENTRA_TENANT_ID)"
config openid-client-id "$(try_env OPENID_CLIENT_ID)"

if exists /pressroom/secrets/openid-client-secret && [[ "${ROTATE_OPENID_SECRET:-}" != "1" ]]
then
  echo "kept /pressroom/secrets/openid-client-secret (ROTATE_OPENID_SECRET=1 to replace)"
else
  read -r -s -p "PressRoom-LibreChat client secret: " secret
  echo
  put /pressroom/secrets/openid-client-secret SecureString "$secret"
fi

provider_key anthropic-api-key "Anthropic API key"
provider_key openai-api-key "OpenAI API key"
provider_key xai-api-key "xAI API key"
