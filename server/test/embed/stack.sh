#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$HERE/../.." && pwd)"
NGINX_IMAGE="${NGINX_IMAGE:-$(sed -n 's/^ *image: \(nginx:.*\)$/\1/p' "$SERVER_DIR/docker-compose.override.yml")}"
NETWORK=pressroom-embed-test
STATE="${EMBED_STATE:-$HERE/.state}"

down()
{
  docker rm -f embed-client embed-api embed-portal >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf "$STATE"
}

relay()
{
  local name="$1" alias="$2" listen="$3" target="$4"
  cat >"$STATE/$name.conf" <<CONF
server {
    listen $listen;
    location / {
        proxy_pass http://host.docker.internal:$target;
        proxy_set_header Host \$host;
    }
}
CONF
  docker run -d --name "embed-$name" --network "$NETWORK" --network-alias "$alias" --add-host host.docker.internal:host-gateway \
    -v "$STATE/$name.conf:/etc/nginx/conf.d/default.conf:ro" "$NGINX_IMAGE" >/dev/null
}

up()
{
  : "${API_PORT:?}" "${PORTAL_PORT:?}" "${HTTPS_PORT:?}"
  down
  mkdir -p "$STATE/letsencrypt/live/pressroom"
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=pressroom.example.test" \
    -addext "subjectAltName=DNS:*.pressroom.example.test" \
    -keyout "$STATE/letsencrypt/live/pressroom/privkey.pem" \
    -out "$STATE/letsencrypt/live/pressroom/fullchain.pem" >/dev/null 2>&1
  docker network create "$NETWORK" >/dev/null
  relay api api 3080 "$API_PORT"
  relay portal portal 3000 "$PORTAL_PORT"
  docker run -d --name embed-client --network "$NETWORK" -e DOMAIN=example.test \
    -p "127.0.0.1:$HTTPS_PORT:443" \
    -v "$SERVER_DIR/nginx/templates:/etc/nginx/templates:ro" \
    -v "$SERVER_DIR/nginx/pressroom:/usr/share/nginx/pressroom:ro" \
    -v "$STATE/letsencrypt:/etc/letsencrypt:ro" "$NGINX_IMAGE" >/dev/null
  for _ in $(seq 1 50)
  do
    if curl -sk -o /dev/null --resolve "chat.pressroom.example.test:$HTTPS_PORT:127.0.0.1" \
      "https://chat.pressroom.example.test:$HTTPS_PORT/pressroom/session.html"
    then
      return 0
    fi
    sleep 0.2
  done
  docker logs embed-client
  return 1
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down"; exit 1 ;;
esac
