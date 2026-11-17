#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

id=$(instance_id)
if [[ -z "$id" || "$id" == "None" ]]
then
  echo "pressroom-srv not found; deploy PressRoomBase first (npm --prefix infra run deploy:base)"
  exit 1
fi

aws ec2 start-instances --region "$REGION" --instance-ids "$id" >/dev/null
npm run deploy:session
aws ec2 wait instance-running --region "$REGION" --instance-ids "$id"

endpoint=$(aws cloudformation describe-stacks --region "$REGION" --stack-name PressRoomSession \
  --query "Stacks[0].Outputs[?OutputKey=='VpnEndpointId'].OutputValue | [0]" --output text)
echo "session up: instance $id, VPN endpoint $endpoint"
echo "VPN profile:  aws ec2 export-client-vpn-client-configuration --region $REGION --client-vpn-endpoint-id $endpoint --output text > pressroom.ovpn"
echo "Shell:        aws ssm start-session --region $REGION --target $id"
echo "Pause after:  npm run pause"
