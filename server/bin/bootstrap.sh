#!/usr/bin/env bash
set -euo pipefail

# Needs the session stack up and infra/scripts/registries.sh open on the operator side.
if [[ "$(id -u)" -ne 0 ]]
then
  echo "run as root"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl unzip python3 certbot python3-certbot-dns-route53

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  >/etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

if ! command -v aws >/dev/null
then
  workdir=$(mktemp -d)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "$workdir/awscli.zip"
  unzip -q "$workdir/awscli.zip" -d "$workdir"
  "$workdir/aws/install"
  rm -rf "$workdir"
fi

install -m 0750 -d /opt/pressroom /opt/pressroom/server /opt/pressroom/mcp /opt/pressroom/mocks
docker --version
docker compose version
aws --version
certbot --version
echo "bootstrap complete; close the registries from your laptop now"
