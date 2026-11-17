# Day-2 tasks

Each change below ends the same way unless it says otherwise: commit, `npm run push-server`, on the server `sudo bin/render-env.sh && sudo docker compose up -d`, then `sudo bin/smoke.sh`.

## Add a model

See [models-and-spend.md](models-and-spend.md): model id in `ANTHROPIC_MODELS` / `OPENAI_MODELS` (or `tokenConfig` for a custom endpoint, with real prices), a `modelSpecs` entry, `npm run config:check`, then `bin/check-models.sh` on the server.

## Add an MCP server

1. Code in `mcp/src/<name>/` (copy the closest of outlook, pace, relevance, voice): validate the token with `createVerifier`, check roles per tool, record write actions with the recorder.
2. A service in `docker-compose.override.yml` with the same hardening and a health check, on a new port.
3. `librechat.template.yaml`: add `<name>:<port>` to `mcpSettings.allowedAddresses`, an `mcpServers.<name>` entry with `obo.scopes`, and `toolApproval` rules (`mcp:<name>:<tool>` in `allow` for reads, `ask` for writes). `npm run config:check`.
4. New roles go on the PressRoom-MCP app registration (docs/entra-setup.md), then assign them.

## Offboard a person

1. Entra: block sign-in, then **Revoke sessions** (user > Revoke sessions).
2. Admin panel (`https://admin.pressroom.<domain>`): ban the user. This takes effect on the next request; Entra blocking alone waits for the next token refresh (measure it in Phase 8 and write the number here).
3. Remove their app role assignments (PressRoom-LibreChat, PressRoom-MCP). MCP servers check roles on every call, from the token LibreChat gets through on-behalf-of.
4. Their chats stay until retention removes them, or delete the account in the admin panel if the records policy says so.

## Revoke a connector

| Scope | How | Effect |
| --- | --- | --- |
| One person, one connector | Remove the role (`Outlook.Assistant`, `Pace.*`) on PressRoom-MCP | Next token exchange carries no role; tools answer "not permitted" |
| One Relevance or voice agent | Remove it from `server/mcp-config/*.json`, `docker compose up -d mcp-relevance mcp-voice` | Agent disappears from the list and is refused by id |
| A whole connector | Remove its `mcpServers` entry from the yaml | Tools vanish from LibreChat |
| A vendor key | Delete or rotate the key at the vendor | Gateway answers "refused the server's API key", fails closed |

## Rotate keys

| Key | How | Side effects |
| --- | --- | --- |
| Provider keys (Anthropic, OpenAI, xAI, Relevance, ElevenLabs) | `ROTATE_PROVIDER_KEYS=1 npm run secrets` | None |
| Entra client secrets | `ROTATE_OPENID_SECRET=1 npm run secrets` (LibreChat); MCP and portal secrets via `ROTATE_PROVIDER_KEYS=1` | None |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, session secrets | Delete the SSM parameter, `npm run secrets` regenerates it | Everyone signs in again |
| Database passwords | Change in the database first, then in SSM | Plan a short outage |
| `CREDS_KEY`, `CREDS_IV` | **Never.** Stored credentials become unreadable | |
| restic password | On the server: `sudo bash -c 'source bin/lib.sh && restic_env && restic key add'` (asks for the new one), put it in SSM `/pressroom/secrets/restic-password` and the password manager, `bin/render-env.sh`, then `restic key remove <old key id>` | Both steps or none: with only SSM changed, `backup.sh` cannot open the repository |
| age key | New key with `npm run backup:key` after moving the old identity aside; keep the old identity for old backups | |

## Change retention

`librechat.yaml` under `interface`: `retentionMode`, `generalChatRetention` (hours), `temporaryChatRetention` (hours), `retainAgentFiles`. Record the decision in `docs/decisions.md` (#1). Transactions: `KEEP_MONTHS` for the monthly purge (`bin/spend-report.sh`). Logs: `retention_in_days` in `server/cloudwatch/agent.json`, then `sudo bin/bootstrap.sh` to reload the agent. Approved actions: `AUDIT_RETENTION_YEARS` for the Object Lock exports.
