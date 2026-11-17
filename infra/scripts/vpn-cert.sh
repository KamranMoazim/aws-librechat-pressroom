#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-us-east-1}"
DIR=vpn
mkdir -p "$DIR"
chmod 700 "$DIR"

if [[ -f "$DIR/server.crt" ]]
then
  echo "$DIR/server.crt already exists; delete $DIR/ca.* and $DIR/server.* to make a new one"
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=pressroom-vpn-ca" \
  -keyout "$DIR/ca.key" -out "$DIR/ca.crt"
openssl req -newkey rsa:2048 -nodes -subj "/CN=server.pressroom.vpn" \
  -keyout "$DIR/server.key" -out "$DIR/server.csr"
openssl x509 -req -in "$DIR/server.csr" -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial \
  -days 825 -out "$DIR/server.crt" \
  -extfile <(printf 'subjectAltName=DNS:server.pressroom.vpn\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n')
chmod 600 "$DIR"/*.key

arn=$(aws acm import-certificate --region "$REGION" \
  --certificate "fileb://$DIR/server.crt" \
  --private-key "fileb://$DIR/server.key" \
  --certificate-chain "fileb://$DIR/ca.crt" \
  --tags Key=project,Value=pressroom \
  --query CertificateArn --output text)
echo "Put this in infra/.env:"
echo "VPN_SERVER_CERT_ARN=$arn"
