#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK=/etc/letsencrypt/renewal-hooks/deploy/pressroom-nginx.sh

if [[ "$(id -u)" -ne 0 ]]
then
  echo "run as root"
  exit 1
fi

domain=$(sed -n 's/^DOMAIN=//p' "$SERVER_DIR/.env")
email=$(sed -n 's/^ACME_EMAIL=//p' "$SERVER_DIR/.env")
if [[ -z "$domain" || -z "$email" ]]
then
  echo "DOMAIN and ACME_EMAIL must be in $SERVER_DIR/.env; run bin/render-env.sh first"
  exit 1
fi

staging=()
if [[ "${CERTS_STAGING:-}" == "1" ]]
then
  staging=(--staging)
fi

names=()
for host in chat admin bundler portal
do
  names+=(-d "$host.pressroom.$domain")
done

certbot certonly --dns-route53 --non-interactive --agree-tos --email "$email" \
  --cert-name pressroom --keep-until-expiring "${staging[@]}" "${names[@]}"

install -d /etc/letsencrypt/renewal-hooks/deploy
cat >"$HOOK" <<'HOOK'
#!/usr/bin/env bash
if docker ps --format '{{.Names}}' | grep -qx LibreChat-NGINX
then
  docker exec LibreChat-NGINX nginx -s reload
fi
HOOK
chmod 755 "$HOOK"
systemctl enable --now certbot.timer
certbot certificates --cert-name pressroom
