#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
DOMAINS=(
  ports.ubuntu.com '*.ports.ubuntu.com' '*.archive.ubuntu.com' security.ubuntu.com
  download.docker.com registry-1.docker.io auth.docker.io '*.docker.io' production.cloudflare.docker.com
  registry.librechat.ai ghcr.io pkg-containers.githubusercontent.com
  awscli.amazonaws.com amazoncloudwatch-agent.s3.amazonaws.com
  github.com release-assets.githubusercontent.com objects.githubusercontent.com
  pypi.org files.pythonhosted.org registry.npmjs.org
)

usage()
{
  echo "usage: $0 open|close|status"
  exit 1
}

[[ $# -eq 1 ]] || usage
list_id=$(aws route53resolver list-firewall-domain-lists --region "$REGION" \
  --query "FirewallDomainLists[?Name=='pressroom-updates'].Id | [0]" --output text)
if [[ -z "$list_id" || "$list_id" == "None" ]]
then
  echo "pressroom-updates domain list not found; deploy PressRoomBase first"
  exit 1
fi

case "$1" in
  open)
    aws route53resolver update-firewall-domains --region "$REGION" \
      --firewall-domain-list-id "$list_id" --operation REPLACE --domains "${DOMAINS[@]}" >/dev/null
    echo "registries open; run '$0 close' when the update is done"
    ;;
  close)
    current=$(aws route53resolver list-firewall-domains --region "$REGION" \
      --firewall-domain-list-id "$list_id" --query 'Domains' --output text)
    if [[ -n "$current" && "$current" != "None" ]]
    then
      read -r -a current_domains <<<"$current"
      aws route53resolver update-firewall-domains --region "$REGION" \
        --firewall-domain-list-id "$list_id" --operation REMOVE --domains "${current_domains[@]}" >/dev/null
    fi
    echo "registries closed"
    ;;
  status)
    aws route53resolver list-firewall-domains --region "$REGION" \
      --firewall-domain-list-id "$list_id" --query 'Domains' --output text
    ;;
  *)
    usage
    ;;
esac
