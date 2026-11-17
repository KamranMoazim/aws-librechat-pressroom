#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

id=$(instance_id)
bucket=$(aws cloudformation describe-stacks --region "$REGION" --stack-name PressRoomBase \
  --query "Stacks[0].Outputs[?OutputKey=='DeployBucket'].OutputValue | [0]" --output text)
if [[ -z "$id" || "$id" == "None" || -z "$bucket" || "$bucket" == "None" ]]
then
  echo "PressRoomBase not deployed"
  exit 1
fi

archive=$(mktemp -t pressroom-server).tgz
COPYFILE_DISABLE=1 tar -czf "$archive" -C .. \
  --exclude 'server/.env' --exclude 'server/librechat.yaml' --exclude 'server/data-node' \
  --exclude 'server/meili_data_*' --exclude 'server/images' --exclude 'server/uploads' \
  --exclude 'server/logs' --exclude 'server/skill' --exclude 'server/reports/out' \
  --exclude 'node_modules' --exclude 'mcp/dist' --exclude 'mocks/portal/dist' --exclude '.venv' --exclude '__pycache__' \
  --exclude 'server/state' --exclude '.DS_Store' server mcp mocks
key="server/$(date -u +%Y%m%dT%H%M%SZ).tgz"
aws s3 cp --region "$REGION" "$archive" "s3://$bucket/$key" >/dev/null
rm -f "$archive"
url=$(aws s3 presign --region "$REGION" "s3://$bucket/$key" --expires-in 300)

command_id=$(aws ssm send-command --region "$REGION" --instance-ids "$id" \
  --document-name AWS-RunShellScript --comment "pressroom push-server" \
  --parameters "commands=[\"set -e\",\"curl -fsSL '$url' -o /tmp/pressroom-server.tgz\",\"install -m 0750 -d /opt/pressroom\",\"tar -xzf /tmp/pressroom-server.tgz -C /opt/pressroom\",\"rm -f /tmp/pressroom-server.tgz\",\"ls /opt/pressroom\"]" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --region "$REGION" --command-id "$command_id" --instance-id "$id" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" --instance-id "$id" \
  --query '[Status, StandardOutputContent, StandardErrorContent]' --output text
