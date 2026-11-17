# How it fits together

Pairs with Phases 0 and 1. 90 to 120 minutes, hands on.

**Goal:** Know every container, what it talks to, and where its data lives.

## Exercise

1. On a scratch box, follow `runbooks/deploy-from-zero.md` to `docker compose up -d`.
2. Open `server/docker-compose.override.yml` and name, for each service, its image digest, its data volume and who may reach it.
3. Run `sudo bin/smoke.sh` and read each line.

## Expected result

All containers healthy; `/api/config` answers through nginx; you can say why only nginx publishes a port.

## If it breaks, look here

- `docker compose ps` (state and health), `docker compose logs <service>`
- nginx will not start: certificates (`bin/certs.sh`, `/etc/letsencrypt/live/pressroom`)
- `.env` missing values: `bin/render-env.sh` names the missing SSM parameters
