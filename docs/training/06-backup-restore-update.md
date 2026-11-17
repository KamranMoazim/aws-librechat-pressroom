# Backup, restore, update

Pairs with Phase 7. 90 to 120 minutes, hands on.

**Goal:** Restore onto a fresh instance and upgrade by the runbook.

## Exercise

1. Run `sudo bin/backup.sh`, then list snapshots with `sudo bin/restore.sh --list`.
2. Do the restore drill in `runbooks/backup-and-restore.md`; time it.
3. Follow `runbooks/update.md` for the prepared v0.8.9 upgrade.

## Expected result

Restore log line says smoke passed; upgrade passes smoke checks; you know the rollback steps.

## If it breaks, look here

- `journalctl -u pressroom-backup`
- restic needs `RESTIC_PASSWORD`; the age identity stays on the IT laptop
- Never restore onto a server whose timers already backed up an empty stack: pick the snapshot by time
