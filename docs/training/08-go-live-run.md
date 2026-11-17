# Go-live run

Pairs with Phase 8. 90 to 120 minutes, hands on.

**Goal:** Run the go-live suite yourselves, read the report, sign off.

## Exercise

1. Sign in the test people (`npm run golive -- login alice`, bob, dave).
2. `npm run golive -- run` and do the by-hand steps it asks for.
3. Read the report; attach screenshots for MANUAL rows.

## Expected result

No FAIL rows; the sign-off checklist in `docs/handover.md` complete.

## If it breaks, look here

- `tests/golive/README.md`
- A FAIL row carries its evidence (status codes, query output) in the report
- `server/bin/golive-check.sh` is what the server-side checks run
