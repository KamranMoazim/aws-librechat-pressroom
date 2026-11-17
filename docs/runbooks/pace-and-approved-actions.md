# Pace connector and approved actions

## Pieces

| Container | What it is | Talks to |
| --- | --- | --- |
| `pace-api` | Mock of EFI Pace: 200 seeded jobs, estimates, customers, notes. Needs `X-Api-Key`. | nothing |
| `mcp-pace` | Our stand-in for the client's Pace connector | `pace-api`, `auditdb` |
| `auditdb` | Postgres 17, database `audit`, table `approved_actions` | nothing |

On the client's server, `pace-api` goes away and `mcp-pace` (or their own connector) points at their real Pace.

## Tools and roles (roles on PressRoom-MCP)

| Tool | Needs | Approval | Notes |
| --- | --- | --- | --- |
| `job_search` | any signed-in user | allowed | Summaries only; restricted customers hidden unless `Pace.Estimating` |
| `job_get` | any signed-in user | allowed | Cost, quoted price and margin removed unless `Pace.Estimating` |
| `estimate_get` | `Pace.Estimating` | allowed | |
| `job_update_prepare` | `Pace.Production` | allowed | Changes nothing; returns the difference and a `change_id` |
| `job_update_commit` | `Pace.Production` | **ask** | Once, same person, within 10 minutes, and only if the job is unchanged in Pace since prepare |

Every denial is logged (`docker compose logs mcp-pace | grep denied`) with the user and the missing role.

## Why prepare and commit

The model can only ask for a change. The person sees the exact difference in the chat, LibreChat's approval card asks them again before commit, and the commit carries the job version read at prepare (`If-Match`), so a change someone else made in Pace in the meantime is never overwritten. A `change_id` from another user, a second commit or a late commit are refused.

## Approved-action records

- Table `approved_actions`: `id, at, user_oid, upn, tool, target, summary, args_sha256, before, after, conversation_id, result`. Failed attempts are recorded too (`result = failed: 412`).
- Roles: `audit_writer` (used by the MCP servers) has `INSERT` and `SELECT` only. A trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` for everyone, including the admin role.
- `bin/audit-export.sh` runs hourly (systemd timer `pressroom-audit-export.timer`): new rows go to `s3://pressroom-backup-<account>-us-west-2/audit/YYYY/MM/DD/HHMMSS-<first>-<last>.jsonl` with Object Lock until now + 7 years (`AUDIT_RETENTION_YEARS`). On-prem, point the upload at their backup target.

Look at the last records:

```bash
docker exec -it auditdb psql -U audit_admin -d audit \
  -c "SELECT at, upn, tool, target, summary, result FROM approved_actions ORDER BY id DESC LIMIT 20"
```

## Permission matrix for the client's connector

See [tests/pace-permissions/README.md](../../tests/pace-permissions/README.md). The same `matrix.json` runs in our tests and against any deployed connector.

## Checks (Phase 4 done when)

| Check | Expected |
| --- | --- |
| alice: "move J24017 to printing and note that the proof was approved" | A difference (status from, to; the note), then an approval card for `job_update_commit` |
| alice approves | Job shows `printing` and the note in Pace; one `committed` row with before and after |
| bob: "what's the margin on J24017?" | Job without cost, price or margin; `estimate_get` says not permitted, and the denial is logged |
| A `change_id` prepared by alice, committed as dave | "prepared by someone else" |
| `UPDATE approved_actions ...` as `audit_admin` | `approved_actions is append-only (UPDATE refused)` |
| After an hour | A new `.jsonl` under `audit/` with a retain-until date 7 years out |
