#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(id -u)" -ne 0 ]]
then
  echo "run as root"
  exit 1
fi

for unit in "$SERVER_DIR"/systemd/*.service "$SERVER_DIR"/systemd/*.timer
do
  install -m 0644 "$unit" /etc/systemd/system/
done
systemctl daemon-reload
for timer in "$SERVER_DIR"/systemd/*.timer
do
  systemctl enable --now "$(basename "$timer")"
done
systemctl list-timers 'pressroom-*'
