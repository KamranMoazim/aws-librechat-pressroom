#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

npm run destroy:session
id=$(instance_id)
if [[ -n "$id" && "$id" != "None" ]]
then
  aws ec2 stop-instances --region "$REGION" --instance-ids "$id" >/dev/null
  echo "stopping $id"
fi
echo "paused: NAT and Client VPN removed, server stopping"
