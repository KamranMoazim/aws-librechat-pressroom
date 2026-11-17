#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
MONTH="${1:-$(date -u -d "$(date -u +%Y-%m-01) -1 day" +%Y-%m)}"
OUT_DIR="$SERVER_DIR/reports/out"
OUT="$OUT_DIR/$MONTH.csv"

password=$(sed -n 's/^MONGO_APP_PASSWORD=//p' "$SERVER_DIR/.env")
mongo_shell()
{
  docker exec -e REPORT_MONTH="$MONTH" -e KEEP_MONTHS="${KEEP_MONTHS:-13}" chat-mongodb mongosh --quiet \
    "mongodb://librechat:$password@localhost:27017/LibreChat?authSource=LibreChat" --file "$1"
}

install -m 0700 -d "$OUT_DIR"
mongo_shell /reports/spend-report.js >"$OUT"
echo "wrote $OUT ($(($(wc -l <"$OUT") - 1)) rows)"

if [[ "${SKIP_UPLOAD:-}" != "1" ]]
then
  account=$(aws sts get-caller-identity --query Account --output text)
  aws s3 cp --region us-west-2 "$OUT" "s3://pressroom-backup-$account-us-west-2/reports/$MONTH.csv"
fi

if [[ "${PURGE:-}" == "1" ]]
then
  mongo_shell /reports/purge-transactions.js
fi
