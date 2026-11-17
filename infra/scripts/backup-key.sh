#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-us-east-1}"
KEY_DIR=backup-key
IDENTITY="$KEY_DIR/age-identity.txt"

if ! command -v age-keygen >/dev/null
then
  echo "install age first (brew install age)"
  exit 1
fi
if [[ -e "$IDENTITY" ]]
then
  echo "$IDENTITY already exists; it decrypts every backup made with it, so it is never replaced"
else
  install -m 0700 -d "$KEY_DIR"
  (umask 077 && age-keygen -o "$IDENTITY")
fi
recipient=$(age-keygen -y "$IDENTITY")
aws ssm put-parameter --region "$REGION" --name /pressroom/config/backup-age-recipient \
  --type String --value "$recipient" --overwrite >/dev/null
echo "set /pressroom/config/backup-age-recipient = $recipient"
echo "Store $IDENTITY and the restic password (/pressroom/secrets/restic-password) in the IT password manager now."
