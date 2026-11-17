# PressRoom

A private LibreChat company AI workspace for a ~100-person print manufacturer: Entra ID SSO with MFA, Claude, OpenAI and Grok behind an approved model list, SharePoint, Outlook and ERP connectors through MCP, reachable only over VPN.

Everything that would go onto the client's own server lives in `server/` (and later `mcp/`) and is portable as-is. AWS only plays the client's building: a private network, a VPN, an egress firewall and an off-site backup target (`infra/`).

## Layout

```
infra/          CDK app (TypeScript): the stand-in for the client's datacenter
  lib/          backup-stack (us-west-2), base-stack, session-stack and their constructs
  scripts/      vpn-cert, registries, session-up, pause, teardown
  test/         template assertions
server/         what goes on the client's server, unchanged
  docker-compose.yml           LibreChat v0.8.8 deploy-compose.yml, verbatim
  docker-compose.override.yml  digest pins, Mongo auth, nginx TLS, admin panel, Sandpack bundler
  .env.template                LibreChat settings; ${NAME} filled from SSM by bin/render-env.sh
  librechat.yaml
  nginx/templates/             chat., admin., bundler. server blocks (TLS from Let's Encrypt)
  mongo/init/                  creates the app user (readWrite on LibreChat only)
  bin/                         bootstrap, render-env, certs
docs/           entra-setup.md, runbooks/
```

## Stacks

| Stack | Region | Lifecycle | Contents |
| --- | --- | --- | --- |
| PressRoomBackup | us-west-2 | kept | Backup bucket: versioned, Object Lock governance 30 days |
| PressRoomBase | us-east-1 | kept | VPC (no NAT), `t4g.large` Ubuntu 24.04 in a private subnet with no public IP, private zone `pressroom.<domain>`, Route 53 Resolver DNS Firewall (allowlist, then block everything with NXDOMAIN), daily EBS snapshots, $25 budget |
| PressRoomSession | us-east-1 | per working session | NAT gateway, AWS Client VPN with Entra SAML, split tunnel |

Without the session stack the server has no egress and nobody can reach it, so a paused build costs about $8/month.

## Phase 0: run it

Prerequisites: AWS CLI, Node.js 22+, CDK bootstrapped in `us-east-1` and `us-west-2`, a public Route 53 zone, the Entra steps in [docs/entra-setup.md](docs/entra-setup.md).

```bash
npm run install:all
cp infra/.env.example infra/.env        # DOMAIN, PUBLIC_ZONE_ID, ALERT_EMAIL
npm run infra:test
npm --prefix infra run deploy:base      # PressRoomBackup + PressRoomBase

npm run vpn:cert                        # put the printed ARN in infra/.env
# save the Entra metadata as infra/vpn/entra-saml-metadata.xml, set VPN_ENTRA_GROUP_ID
npm run session:up                      # starts the server, deploys NAT + VPN
npm run registries -- open
aws ssm start-session --target <instance-id>
#   on the server: copy server/ to /opt/pressroom and run sudo bin/bootstrap.sh
npm run registries -- close
npm run pause                           # removes NAT + VPN, stops the server
```

Done when:

- the VPN connects with Entra sign-in and MFA;
- an SSM shell works (there is no SSH);
- on the server, `dig api.mistral.ai` returns NXDOMAIN and `dig api.anthropic.com` resolves;
- `sudo bin/render-env.sh` writes a root-only `.env` from `/pressroom/*`.

## Phase 1: LibreChat on the server

Follow [docs/runbooks/deploy-from-zero.md](docs/runbooks/deploy-from-zero.md). Done when alice signs in through Entra with MFA, eve is refused, carol reaches the admin panel, and the email login form is gone.

Only nginx publishes a port. MongoDB runs with auth and LibreChat connects as an app user; Meilisearch runs in production mode; debug logging is off so prompts don't land in log files.

## Cost

| Line | Per hour |
| --- | --- |
| EC2 `t4g.large` | ~$0.067 |
| NAT gateway + its public IPv4 | ~$0.05 |
| Client VPN: 1 subnet association | ~$0.10 |
| Client VPN: 1 connected user | ~$0.05 |
| **Session total** | **~$0.27/hour** |

Paused: about $8/month. Left fully running: about $165/month; the budget alert fires at $20 actual and $25 forecast.

`npm run teardown` removes everything except the Object Lock backup bucket and the VPN certificate.
