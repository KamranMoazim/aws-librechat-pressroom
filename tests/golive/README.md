# Go-live tests

One spec per test in the client's post. Each run writes `reports/golive-<time>.md` (and `.json`): every check with PASS, FAIL, MANUAL or SKIPPED and its evidence. That file is the test report in the handover pack.

| Spec | Proves | How |
| --- | --- | --- |
| `restricted-records` | bob cannot reach estimating data | SharePoint site refused in bob's browser; Graph download of an Estimating file id 403/404 with bob's token; Pace job without cost fields, restricted job and `estimate_get` refused, denials in the connector log; picker check by hand |
| `chat-isolation` | People only see their own data | alice makes a chat, a file and a private agent; bob calls the conversation, message, file, share and agent endpoints with alice's ids; bob tries to attach alice's file to his own agent |
| `offboarding` (runs last) | A leaver is cut off | Ban in the admin panel takes effect at once; Entra block + revoke sessions measured in minutes (interactive) |
| `connector-revocation` | Connectors can be withdrawn | Role removal makes the Outlook connector refuse dave (minutes measured); a server removed from the yaml has no tools; a revoked Relevance key fails closed |
| `approved-providers` | Only approved models | Four model specs, enforced; no other endpoint, no user keys; crafted requests for another provider refused before any model call; users cannot add MCP servers; DNS firewall egress check |
| `spend` | Per-person limits work | bob with zero balance cannot chat (balance restored afterwards); spend CSV produced; comparison with provider consoles by hand |
| `deletion` | Deleting means deleted | Chat gone from Mongo and Meilisearch; file gone with its pgvector embeddings; an aged chat removed by the retention TTL |
| `recovery` | Backups restore | Last backup under 26 h; restore drill log on `pressroom-restore` shows smoke passed in under 60 min |
| `approved-actions` | Every approved action is recorded | Drafts and Pace commits in `approved_actions`, no missing fields; UPDATE, DELETE, TRUNCATE refused |

## Before the run

1. VPN connected; AWS credentials for the account on the laptop; `session-manager-plugin` installed (MCP calls go through an SSM port forward to the container, nothing is published).
2. `cp .env.example .env` and fill it. The PressRoom-GoLive app registration is in `docs/entra-setup.md`.
3. Chromium for Playwright: `npx playwright-core install chromium-headless-shell` (or set `CHROMIUM_PATH`).
4. Sign in once per person (browser sign-in with MFA, then a device code in the same window):

```bash
npm run golive -- login alice     # then bob, dave
```

Sign-ins are stored in `tests/golive/.auth/` (git-ignored, mode 600). Delete the folder after sign-off.

## Run

```bash
npm run golive -- list
npm run golive -- run                        # all specs; asks you to do the by-hand steps
npm run golive -- run chat-isolation spend   # some
npm run golive -- run --non-interactive      # by-hand steps become MANUAL rows
```

Specs that change things put them back, also when they fail: bob's balance is restored, test chats, files, agents and shares are deleted. Connector revocation and offboarding ask you to undo the Entra changes; offboarding runs last because it revokes dave's sessions.

Server-side checks go through SSM to `server/bin/golive-check.sh`, which only runs fixed queries with checked ids.

## Tests of the tests

`npm run golive:test` runs chat-isolation, approved-providers and deletion against a fake LibreChat, first correct (every check passes) and then with one weakness at a time (a readable conversation, a shareable chat, a stray endpoint, search index not cleaned, and so on): each weakness must fail exactly its check. `server/test/golive-check.test.sh` runs the server checks against real Mongo, pgvector and Postgres.
