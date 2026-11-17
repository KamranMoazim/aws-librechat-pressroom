#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

read -r -p "Delete all PressRoom stacks, the server and its /pressroom/* parameters? Type yes: " answer
if [[ "$answer" != "yes" ]]
then
  echo "cancelled"
  exit 1
fi

npm run destroy

for name in $(aws ssm get-parameters-by-path --region "$REGION" --path /pressroom --recursive \
  --query 'Parameters[].Name' --output text)
do
  aws ssm delete-parameter --region "$REGION" --name "$name" && echo "deleted $name"
done

# CDK-managed custom resources can leave log groups behind after the stack is gone.
for prefix in /aws/lambda/PressRoom PressRoom
do
  for group in $(aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$prefix" \
    --query 'logGroups[].logGroupName' --output text)
  do
    aws logs delete-log-group --region "$REGION" --log-group-name "$group" && echo "deleted $group"
  done
done

rm -f cdk-outputs.json
echo "teardown complete"
echo "Kept on purpose: the Object Lock backup bucket pressroom-backup-<account>-us-west-2 (empty it once retention expires, then delete it) and the VPN certificate in ACM."
