# Deploy from zero

Brings up PressRoom on a fresh server. Run the laptop steps from the repo root and the server steps in an SSM shell (`sudo -i`, then `cd /opt/pressroom/server`).

On the client's own server, skip the laptop steps that touch AWS: copy `server/` and `mcp/` (and `mocks/` only for the demo) to `/opt/pressroom` however their IT moves files, and fill `.env` and `librechat.yaml` from their templates by hand or from their secret store.

## 1. Secrets and settings (laptop, once)

```bash
npm run secrets                 # generates every secret in SSM, asks for the Entra client secret and provider keys
```

It never replaces an existing secret. `CREDS_KEY` and `CREDS_IV` in particular must never change: LibreChat encrypts stored credentials with them.

## 2. Server up (laptop)

```bash
npm run session:up              # NAT + VPN, starts the server
npm run registries -- open      # allows Ubuntu, Docker and image registries
npm run push-server             # copies server/, mcp/ and mocks/ to /opt/pressroom
```

## 3. Install and configure (server)

```bash
bin/bootstrap.sh                # docker, compose, aws cli, certbot
bin/render-env.sh               # .env (600) and librechat.yaml (644) from /pressroom/*
bin/certs.sh                    # Let's Encrypt via Route 53 DNS-01; CERTS_STAGING=1 for a dry run
bin/check-models.sh             # every model in modelSpecs exists for our keys
docker compose pull --ignore-buildable
docker compose build
docker compose up -d
docker compose ps
bin/install-timers.sh           # hourly approved-action export
```

## 4. Close egress (laptop)

```bash
npm run registries -- close
```

## 5. Break-glass admin (server, once, before anyone signs in)

LibreChat makes the first account an admin, so create this one before alice or carol sign in. Email login stays off; the account is only for when Entra is down, through `ALLOW_EMAIL_LOGIN_OVERRIDE=true` (API login only, each use logged), added to `.env` for the duration of the outage.

```bash
docker compose exec api npm run create-user -- breakglass@<domain> "Break Glass" breakglass
```

It prompts for a password. Store it in the client's password vault.

## 6. Admin panel grants

1. carol signs in at `https://admin.pressroom.<domain>` with Microsoft. Her `LibreChat.Admin` app role makes her an admin.
2. To show least privilege, add a second IT user with only `manage:users` and `read:usage` grants instead of the admin role.

## Checks (Phase 1 done when)

| Check | Expected |
| --- | --- |
| alice opens `https://chat.pressroom.<domain>` over the VPN | Only "Sign in with Microsoft", no email form |
| alice signs in | Entra asks for MFA; she lands in LibreChat |
| alice's ID token (jwt.ms) | `amr` contains `mfa`, `roles` contains `LibreChat.User` |
| eve signs in | Refused by Entra (assignment required) |
| carol opens the admin panel | Signs in with SSO and sees users |
| `docker compose ps` | Only `LibreChat-NGINX` publishes ports (80, 443) |
| `grep -c . logs/*.log` after a chat | No prompt text (debug logging off) |
