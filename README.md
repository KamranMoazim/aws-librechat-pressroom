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
  librechat.template.yaml      rendered to librechat.yaml; @@NAME@@ filled from /pressroom/config only
  nginx/templates/             chat., admin., bundler. server blocks (TLS from Let's Encrypt)
  mongo/init/                  creates the app user (readWrite on LibreChat only)
  auditdb/init/                approved_actions table, append-only trigger, audit_writer role
  systemd/                     hourly approved-action export timer
  reports/                     spend report and transaction purge (mongosh)
  bin/                         bootstrap, render-env, certs, check-models, spend-report
  test/                        render-env, MongoDB (auth + spend report) and config schema tests
mcp/            MCP servers (TypeScript, streamable HTTP, one image per server)
  src/shared/   token check, on-behalf-of exchange, approved-action recorder, HTTP host
  src/outlook/  Outlook tools: mail_search, mail_get, calendar_view, draft_reply
  src/pace/     Pace tools: job_search, job_get, estimate_get, job_update_prepare, job_update_commit
mocks/pace-api/ FastAPI stand-in for EFI Pace (200 seeded jobs)
tests/pace-permissions/  tool x role matrix, runnable against the client's own connector
docs/           entra-setup.md, decisions.md, runbooks/
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

## Phase 2: models, limits, spend, retention

- Four enforced model specs (Claude everyday, Claude deep, GPT analysis, Grok research) plus shared agents; users cannot pick other models, set parameters or add keys.
- $20 per person per month through LibreChat's balance; refills replace the balance.
- Monthly spend CSV per person and model (`server/reports/spend-report.js`), written to the Object Lock bucket by an EventBridge schedule; transactions older than 13 months are purged.
- Retention: everything expires 90 days after last activity, temporary chats after 24 h; memories, Code Interpreter, web search and agent actions are off. See [docs/decisions.md](docs/decisions.md).
- `npm run config:check` validates `librechat.template.yaml` against LibreChat's own schema and fails on keys it would ignore.

Runbook: [docs/runbooks/models-and-spend.md](docs/runbooks/models-and-spend.md).

## Phase 3: Microsoft connections

- SharePoint file picker, delegated: people see only the sites they can already open.
- `mcp-outlook` validates LibreChat's on-behalf-of token, checks the `Outlook.Assistant` role, then makes its own on-behalf-of exchange to Graph. It can search, read, view the calendar and save reply drafts; it has no `Mail.Send`.
- `draft_reply` needs approval in the chat and writes an approved-action record.

Runbook: [docs/runbooks/microsoft-connections.md](docs/runbooks/microsoft-connections.md).

## Phase 4: Pace connector and approved actions

- `mcp-pace` reads jobs and estimates with redaction by role, and changes them only through `job_update_prepare` then `job_update_commit` (one use, same person, 10 minutes, version-checked, approval in the chat).
- Every committed or failed action goes to an append-only Postgres table, and every hour to the Object Lock bucket for 7 years.
- `tests/pace-permissions/matrix.json` is the tool x role contract; the same file runs in-process and against a deployed connector.

Runbook: [docs/runbooks/pace-and-approved-actions.md](docs/runbooks/pace-and-approved-actions.md).

## Phase 5: Relevance AI, ElevenLabs, egress

- `mcp-relevance` and `mcp-voice` hold the vendor keys and expose a few tools for allowlisted agents only (`server/mcp-config/*.json`, agent to roles). Running a Relevance agent and starting a call need approval and are recorded.
- Read-aloud uses ElevenLabs, dictation uses OpenAI, both through LibreChat's `speech:` settings.
- `npm run egress:check` proves from inside the containers that only approved providers resolve.

Runbook: [docs/runbooks/relevance-voice-egress.md](docs/runbooks/relevance-voice-egress.md).

## Phase 6: inside the in-house web app

- `mocks/portal` stands in for the client's app: its own Entra sign-in, pages that embed LibreChat with deep links.
- A small probe on the chat host tells the portal whether the person has a chat session; if not, one top-level sign-in and nginx sends them back to the portal page they were on.
- Only the portal may frame the chat (nginx `frame-ancestors` on every chat response). Proved in a real browser with `npm run embed:test`.

Runbook and developer handover: [docs/runbooks/portal-embed.md](docs/runbooks/portal-embed.md).

## Phase 7: operations

- Nightly restic backup (Mongo, pgvector, approved actions, files, config, certificates, `.env` encrypted with age) to the Object Lock bucket in us-west-2; `bin/restore.sh` brings it back onto a fresh stack and runs the smoke checks.
- `bin/update.sh`: pre-update backup, pull pinned digests, smoke checks, rollback steps. `npm run image:digest` resolves digests without pulling.
- CloudWatch agent (disk, memory, logs), container health checks and a 5-minute health timer feed seven alarms that email IT.

Runbooks: [backup-and-restore](docs/runbooks/backup-and-restore.md), [update](docs/runbooks/update.md) (with the prepared v0.8.9 exercise), [monitoring](docs/runbooks/monitoring.md), [day-2](docs/runbooks/day-2.md).

## Phase 8: go-live tests and handover

- `tests/golive`: one spec per test in the post (restricted records, chat isolation, offboarding, connector revocation, approved providers, spend, deletion, recovery, approved actions). `npm run golive -- run` writes the test report with evidence; by-hand steps are asked for or listed as MANUAL.
- Server-side checks run through SSM as fixed, argument-checked queries (`server/bin/golive-check.sh`); MCP calls go through an SSM port forward, nothing is published.
- Handover pack: [docs/handover.md](docs/handover.md) (architecture, retention matrix, decisions, runbooks, training guides, sign-off checklist).

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

## License

MIT, see [LICENSE](LICENSE). `server/docker-compose.yml` is LibreChat's MIT-licensed `deploy-compose.yml`; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
