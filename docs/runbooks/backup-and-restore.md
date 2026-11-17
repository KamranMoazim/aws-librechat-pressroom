# Backup and restore

## What is backed up

`bin/backup.sh` runs nightly at 02:30 UTC (`pressroom-backup.timer`) and on demand.

| Item | How |
| --- | --- |
| Mongo `LibreChat` database (chats, messages, agents, files metadata, balances, transactions) | `mongodump --archive --gzip` |
| pgvector (file embeddings) | `pg_dump -Fc` |
| Approved actions (`audit`) | `pg_dump -Fc` |
| Uploaded files and images | `server/uploads`, `server/images` |
| Config | `librechat.yaml`, compose files, `nginx/`, `mcp-config/` |
| TLS certificates | `/etc/letsencrypt` |
| `.env` (every key, including `CREDS_KEY`/`CREDS_IV`) | encrypted with `age` to the IT public key, then in restic |

Not backed up: Meilisearch (LibreChat re-indexes from Mongo when the index is empty), logs, container images (pinned by digest, pulled again).

Everything goes into one restic repository: `s3://pressroom-backup-<account>-us-west-2/restic` (another region, Object Lock 30 days in governance mode). restic encrypts with `RESTIC_PASSWORD`. Kept: 14 daily, 8 weekly, 12 monthly, plus the last 5 pre-update backups. Every Sunday `restic check` reads 5% of the data back. EBS snapshots (daily, 7 kept) are a second, AWS-only layer.

On the client's server: set `RESTIC_REPOSITORY` in `.env` to their target (`s3:` on any S3, `sftp:` to a NAS, `azure:` for Blob); nothing else changes.

## Keys IT must hold outside the server

| Secret | Where it lives | Needed for |
| --- | --- | --- |
| restic password | SSM `/pressroom/secrets/restic-password` + IT password manager | Reading any backup |
| age identity | `infra/backup-key/age-identity.txt` on the IT laptop + password manager, never on the server | Decrypting the backed-up `.env` |

Create the age key once: `npm run backup:key` (needs `brew install age`). It puts the public key in SSM; the private key never leaves the laptop.

`CREDS_KEY` and `CREDS_IV` exist in SSM and in the encrypted `.env`. If both are lost, credentials stored in LibreChat (user API keys, MCP OAuth tokens) cannot be decrypted; there is no migration that fixes that.

## Run a backup now

```bash
sudo /opt/pressroom/server/bin/backup.sh
sudo BACKUP_CHECK=1 /opt/pressroom/server/bin/backup.sh   # also verify 5% of the data
```

List snapshots:

```bash
cd /opt/pressroom/server && sudo bash -c 'source bin/lib.sh && restic_env && restic snapshots'
```

## Restore

Bring the replacement stack up with **no timers and no backup**: deploy-from-zero steps 1 to 3 only as far as `docker compose up -d`. A backup taken on the empty server would be the newest snapshot (`backup.sh` refuses when LibreChat has no users, but do not rely on that).

```bash
sudo bin/restore.sh --list                      # pick the snapshot by its time
sudo bin/restore.sh --yes <snapshot id>
sudo bin/install-timers.sh                      # only after the restore is checked
```

`restore.sh`:

1. Refuses if `approved_actions` already has rows: the table is append-only, so a full restore goes onto a fresh audit database. `--keep-audit` skips the audit table instead (rollback on the same server).
2. Stops every writer (api, rag_api, MCP servers, portal, admin panel).
3. Restores Mongo (`--drop`, LibreChat database only), pgvector (`--clean`), approved actions (data only, ids kept, sequence moved past them), uploads and images.
4. Wipes the Meilisearch data so LibreChat re-indexes from Mongo on start.
5. Puts `/etc/letsencrypt` back from the snapshot if this server has no certificate yet.
6. Starts everything and runs `bin/smoke.sh`.
7. Writes data age (RPO) and duration to `state/restore.log`, and deletes its plaintext working copy.

`--env-identity FILE` also decrypts the backed-up `.env` to `.env.from-backup` for comparison. Use it only when SSM is gone; normally `bin/render-env.sh` writes `.env` from SSM.

## Restore drill (RTO under 1 hour)

```bash
# laptop
npx cdk deploy PressRoomBase -c restore=true           # adds pressroom-restore (no snapshots, not in DNS)
PRESSROOM_INSTANCE=pressroom-restore npm run push-server
# on pressroom-restore (aws ssm start-session --target <RestoreInstanceId>)
cd /opt/pressroom/server
sudo bin/bootstrap.sh && sudo bin/render-env.sh
sudo docker compose pull --ignore-buildable && sudo docker compose build
sudo bin/restore.sh --list && sudo bin/restore.sh --yes <newest nightly snapshot id>
# laptop, when done
npx cdk deploy PressRoomBase                            # removes the drill instance
```

`restore.sh` starts the stack itself, after putting the certificates back (nginx cannot start without them). Open the registries for the bootstrap and pull, as in a normal deploy. Do not run `bin/install-timers.sh` on the drill instance: it would publish metrics and take backups as a second server.

Record in the go-live pack: instance created at, `restore.sh` finished at, the `restore.log` line, and the smoke output. RTO = from `cdk deploy` to smoke passed.

## Tests

`server/test/backup-restore.test.sh` runs the real scripts in a Linux container against real Mongo and Postgres: seed, back up twice, wipe every volume, restore, then check chats, vectors, approved actions (ids, append-only, sequence), files, the decrypted `.env`, and that a second restore over live audit data is refused.
