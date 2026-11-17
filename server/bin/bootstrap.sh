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
apt-get install -y ca-certificates curl unzip python3 bzip2 certbot python3-certbot-dns-route53 age

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

RESTIC_VERSION=0.18.1
declare -A RESTIC_SHA256=(
  [arm64]=87f53fddde38764095e9c058a3b31834052c37e5826d2acf34e18923c006bd45
  [amd64]=680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d
)
if [[ "$(restic version 2>/dev/null | cut -d' ' -f2)" != "$RESTIC_VERSION" ]]
then
  arch=$(dpkg --print-architecture)
  archive=$(mktemp --suffix=.bz2)
  curl -fsSL "https://github.com/restic/restic/releases/download/v$RESTIC_VERSION/restic_${RESTIC_VERSION}_linux_$arch.bz2" -o "$archive"
  echo "${RESTIC_SHA256[$arch]}  $archive" | sha256sum -c -
  bunzip2 -c "$archive" >/usr/local/bin/restic
  chmod 0755 /usr/local/bin/restic
  rm -f "$archive"
fi

if ! command -v /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl >/dev/null
then
  agent_deb=$(mktemp --suffix=.deb)
  curl -fsSL "https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/$(dpkg --print-architecture)/latest/amazon-cloudwatch-agent.deb" -o "$agent_deb"
  dpkg -i "$agent_deb"
  rm -f "$agent_deb"
fi

install -m 0750 -d /opt/pressroom /opt/pressroom/server /opt/pressroom/mcp /opt/pressroom/mocks
if [[ -f /opt/pressroom/server/cloudwatch/agent.json ]]
then
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s \
    -c file:/opt/pressroom/server/cloudwatch/agent.json
fi
docker --version
docker compose version
aws --version
certbot --version
restic version
age --version
echo "bootstrap complete; close the registries from your laptop now"
