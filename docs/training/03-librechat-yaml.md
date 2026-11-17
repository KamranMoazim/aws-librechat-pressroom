# librechat.yaml in depth

Pairs with Phase 2. 90 to 120 minutes, hands on.

**Goal:** Change models, specs and limits without breaking the server.

## Exercise

1. Add a model to a spec in `server/librechat.template.yaml`.
2. Change the monthly balance.
3. Run `npm run config:check` before pushing; render and restart.

## Expected result

The check says every key is recognised; the new spec appears; `bin/check-models.sh` passes.

## If it breaks, look here

- `npm run config:check` output (a typo shows as an ignored key)
- `runbooks/models-and-spend.md`
- api start-up log: config errors are printed in the first lines
