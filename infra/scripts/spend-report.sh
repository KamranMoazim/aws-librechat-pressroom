#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

month="${1:-}"
if [[ -n "$month" && ! "$month" =~ ^[0-9]{4}-[0-9]{2}$ ]]
then
  echo "usage: $0 [YYYY-MM]"
  exit 1
fi
id=$(instance_id)
if [[ -z "$id" || "$id" == "None" ]]
then
  echo "pressroom-srv not found"
  exit 1
fi

command_id=$(aws ssm send-command --region "$REGION" --instance-ids "$id" \
  --document-name AWS-RunShellScript --comment "pressroom spend report" \
  --parameters "commands=[\"/opt/pressroom/server/bin/spend-report.sh $month\"]" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --region "$REGION" --command-id "$command_id" --instance-id "$id" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" --instance-id "$id" \
  --query '[Status, StandardOutputContent, StandardErrorContent]' --output text
