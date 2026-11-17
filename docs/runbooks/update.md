# Update LibreChat (and any other image)

Every image is pinned by digest, so nothing changes until someone changes a digest in `server/docker-compose.override.yml` (or a Dockerfile `FROM`).

## Procedure

1. **Read before touching anything.** The release notes, `UPGRADING.md` in the release tag, and the Config changelog (`https://www.librechat.ai/changelog/config_v<version>`). Note every migration step and every changed default.
2. **Prepare the change on the laptop.**
   - Resolve digests: `npm run image:digest -- registry.librechat.ai/librechat-ai/librechat-api:v<version>` (prints `image:tag@sha256:...`; works for Docker Hub, ghcr.io and registry.librechat.ai without pulling).
   - Put the new `image:` lines in `server/docker-compose.override.yml`.
   - Bump `version:` in `server/librechat.template.yaml` and `librechat-data-provider` in `server/test/config/package.json` to the release's version (its `packages/data-provider/package.json`), then `npm --prefix server/test/config install && npm run config:check`. It must say every key is recognised.
   - Commit.
3. **Open the registries:** `npm run registries -- open`.
4. **Ship:** `npm run push-server`, then on the server `sudo bin/render-env.sh` (the yaml may have changed).
5. **Update:** `sudo bin/update.sh`. It takes a `pre-update` backup, saves the running image list, pulls, builds, starts, and runs `bin/smoke.sh`.
6. **Close the registries:** `npm run registries -- close`.
7. **Run the release's migration steps**, if any (below for v0.8.9).
8. **Check by hand:** sign in as alice, one chat per model spec, one approval card, the portal frame.

## Rollback

`update.sh` prints these steps when the smoke checks fail:

1. Laptop: `git revert` the digest commit, `npm run push-server`.
2. Server: `sudo bin/update.sh --no-backup`.
3. If the release migrated data: `sudo bin/restore.sh --yes --keep-audit <pre-update snapshot>` (the id is printed at the start of the update). `--keep-audit` leaves the append-only approved-actions table as it is; nothing in it is lost by a rollback.

## Exercise: v0.8.8 to v0.8.9 (Config 1.3.17 to 1.3.19)

Prepared on 2026-11-17, the day v0.8.9 was published. Wait a week for a patch release before doing it.

| Item | v0.8.8 (now) | v0.8.9 |
| --- | --- | --- |
| `api` | `librechat-api:v0.8.8@sha256:9cde97da...c21` | `registry.librechat.ai/librechat-ai/librechat-api:v0.8.9@sha256:10cffffb4925a28b7554240558da571382cd1f8922b8d7346aab5b5f5acf9739` |
| `admin-panel` | `registry.librechat.ai/clickhouse/librechat-admin-panel` | moved to `registry.librechat.ai/librechat-ai/librechat-admin-panel:latest@sha256:685969b1bfbe307f84a750a8c0602cf87380d2573120757739a54be2d05beed9` |
| Config `version:` | 1.3.17 | 1.3.19 |
| `librechat-data-provider` (config check) | 0.8.530 | 0.8.531 |
| `deploy-compose.yml` | | Only the admin panel repository and `docker.io/` prefixes changed; nothing to merge |

Checked already: our `librechat.template.yaml` with only `version: 1.3.19` passes the 0.8.531 schema with every key recognised.

What v0.8.9 changes for us:

- **Approval rules start matching.** v0.8.9 fixes `mcp:<server>:<tool>` patterns not matching MCP tool keys (#17902). On v0.8.8 our `allow` list may not apply, so read tools may ask for approval too (the fallthrough is "ask", so writes are never let through). After the upgrade, check that `mail_search` runs without a card and `draft_reply` still asks.
- **Per-agent approval modes.** After the upgrade is healthy, add `agentModes: true` under `endpoints.agents.toolApproval` (validated against 1.3.19), render, restart the api, and check that an agent's own mode shows in the agent builder.
- **MCP name reservation index** (UPGRADING.md, "MCP name reservations"). Users cannot create MCP servers here (`interface.mcpServers.create: false`), but run it anyway; with one api container the targeted migration is short:

  ```bash
  sudo docker compose run --rm --no-deps api npm run migrate:mcp-reservations:dry-run
  sudo docker compose run --rm --no-deps api npm run migrate:mcp-reservations -- --writers-upgraded
  sudo bash -c 'source bin/lib.sh && mongo_eval "printjson(conn.mcpnames.getIndexes())"'
  ```

  Expect `name_1_tenantId_1` and no `name_1`. Account deletion should not be used during the few minutes this takes.
- **Web search permissions** (UPGRADING.md, first section): we keep `interface.webSearch: false` and no `web_search` capability, so nothing changes.
