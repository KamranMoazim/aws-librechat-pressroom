# Day-2 operations

Pairs with Phases 2 and 7. 90 to 120 minutes, hands on.

**Goal:** Handle the routine requests without help.

## Exercise

1. Pull last month's spend report (`npm run spend:report`).
2. Offboard dave (Entra block, revoke sessions, ban, remove roles).
3. Change chat retention to 60 days and record the decision.
4. Find the last api error in CloudWatch and say which alarm would fire for a full disk.

## Expected result

CSV in `reports/`; dave cut off; `decisions.md` updated.

## If it breaks, look here

- `runbooks/day-2.md`, `runbooks/monitoring.md`
- Alarms: `pressroom-*` in CloudWatch; emails go to `ALERT_EMAIL`
