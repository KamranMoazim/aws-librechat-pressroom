#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

id=$(instance_id)
if [[ -z "$id" || "$id" == "None" ]]
then
  echo "pressroom-srv not found"
  exit 1
fi

command_id=$(aws ssm send-command --region "$REGION" --instance-ids "$id" \
  --document-name AWS-RunShellScript --comment "pressroom egress check" \
  --parameters 'commands=["/opt/pressroom/server/bin/egress-check.sh"]' \
  --query Command.CommandId --output text)
status=Pending
for _ in $(seq 1 120)
do
  status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
    --instance-id "$id" --query Status --output text 2>/dev/null || echo Pending)
  if [[ "$status" != "Pending" && "$status" != "InProgress" && "$status" != "Delayed" ]]
  then
    break
  fi
  sleep 5
done
aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" --instance-id "$id" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text
echo "status: $status"
[[ "$status" == "Success" ]]
