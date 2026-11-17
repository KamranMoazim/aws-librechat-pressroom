#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

CERT_FILE="${CERT_FILE:-/etc/letsencrypt/live/pressroom/cert.pem}"
now=$(date -u +%s)
install -d -m 0700 "$STATE_DIR"

last_backup=$(cat "$STATE_DIR/backup.last-success" 2>/dev/null || echo 0)
backup_age_hours=$(( (now - last_backup) / 3600 ))

cert_days_left=-1
if [[ -r "$CERT_FILE" ]]
then
  expires=$(date -u -d "$(openssl x509 -enddate -noout -in "$CERT_FILE" | cut -d= -f2)" +%s)
  cert_days_left=$(( (expires - now) / 86400 ))
fi

unhealthy=99
if expected=$(compose config --services 2>/dev/null) &&
  states=$(compose ps --all --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)
then
  healthy=$(awk '$2 == "running" && ($3 == "" || $3 == "healthy") { print $1 }' <<<"$states" | sort -u | grep -cxF -f <(sort -u <<<"$expected") || true)
  unhealthy=$(($(grep -c . <<<"$expected") - healthy))
fi

api_restarts=0
api_container=$(compose ps -q api 2>/dev/null || true)
if [[ -n "$api_container" ]]
then
  count=$(docker inspect -f '{{.RestartCount}}' "$api_container")
  previous=$(cat "$STATE_DIR/api.restart-count" 2>/dev/null || echo "$count")
  previous_container=$(cat "$STATE_DIR/api.container" 2>/dev/null || echo "$api_container")
  if [[ "$previous_container" == "$api_container" && "$count" -ge "$previous" ]]
  then
    api_restarts=$((count - previous))
  fi
  echo "$count" >"$STATE_DIR/api.restart-count"
  echo "$api_container" >"$STATE_DIR/api.container"
fi

if [[ "${METRICS_SINK:-cloudwatch}" == "stdout" ]]
then
  echo "BackupAgeHours=$backup_age_hours CertDaysLeft=$cert_days_left UnhealthyContainers=$unhealthy ApiRestarts=$api_restarts"
  exit 0
fi

instance_id="${INSTANCE_ID:-}"
if [[ -z "$instance_id" ]]
then
  token=$(curl -s -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)
  instance_id=$(curl -s -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id)
fi
data=$(python3 -I -c '
import json, sys
instance, *pairs = sys.argv[1:]
units = {"BackupAgeHours": "None", "CertDaysLeft": "None", "UnhealthyContainers": "Count", "ApiRestarts": "Count"}
print(json.dumps([
    {"MetricName": name, "Value": float(value), "Unit": units[name],
     "Dimensions": [{"Name": "InstanceId", "Value": instance}]}
    for name, value in (pair.split("=") for pair in pairs)
]))' "$instance_id" "BackupAgeHours=$backup_age_hours" "CertDaysLeft=$cert_days_left" \
  "UnhealthyContainers=$unhealthy" "ApiRestarts=$api_restarts")
aws cloudwatch put-metric-data --region "${AWS_REGION:-us-east-1}" --namespace PressRoom --metric-data "$data"
