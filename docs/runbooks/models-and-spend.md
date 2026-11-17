# Models, limits and spend

## Where things are set

| What | Where |
| --- | --- |
| Provider keys | SSM `/pressroom/secrets/{anthropic,openai,xai}-api-key`, rendered into `.env` |
| Anthropic and OpenAI model lists | `.env.template`: `ANTHROPIC_MODELS`, `OPENAI_MODELS` |
| xAI (custom endpoint) models and rates | `librechat.yaml`: `endpoints.custom[xAI]`, `models.default` and `tokenConfig` |
| What users can pick | `librechat.yaml`: `modelSpecs.list` (`enforce: true`) plus the agents endpoint |
| Per-person limit | `librechat.yaml`: `balance` (1,000,000 credits = $1) |
| Chat retention | `librechat.yaml`: `interface.retentionMode`, `generalChatRetention`, `temporaryChatRetention` |

Built-in endpoints (`anthropic`, `openAI`) take their model list from env, not from yaml; a `models` block under them is rejected by the config schema.

## Validate before every restart

```bash
npm run config:check                      # laptop: schema check, also fails on keys LibreChat would ignore
bin/check-models.sh                       # server: every model in modelSpecs exists for our keys
docker compose up -d --force-recreate api
docker compose logs --since 2m api | grep -iE 'error|invalid' || echo "clean start"
```

## Add a model

1. Built-in provider: add the ID to `ANTHROPIC_MODELS` or `OPENAI_MODELS` in `.env.template`. Check that LibreChat knows its price: if it doesn't, spend is charged at the default rate (6 credits per token) and the balance is wrong. In v0.8.8, `claude-haiku-5-5` is in that state, so it is left out.
2. xAI or any custom endpoint: add the ID to `models.default` and a `tokenConfig` entry with `prompt`, `completion` (USD per 1M tokens) and `context`.
3. Add a `modelSpecs.list` entry with a plain-language label.
4. `npm run push-server`, then on the server `bin/render-env.sh` and the validate steps above.

## Spend report

- Runs on the 1st of each month at 06:00 UTC (EventBridge Scheduler to SSM Run Command) if the server is running. Otherwise run it by hand: `npm run spend:report -- 2026-10`.
- Output: `reports/out/YYYY-MM.csv` on the server and `s3://pressroom-backup-<account>-us-west-2/reports/YYYY-MM.csv` (Object Lock).
- Columns: month, email, name, model, prompt_tokens, completion_tokens, usd. USD is LibreChat's own accounting (`-tokenValue / 1,000,000`), so it includes the rates in `tokenConfig`.
- Reconcile against the Anthropic, OpenAI and xAI usage consoles for the same month. Go-live bar: within 5%. Prompt caching and long-context surcharges are the usual reasons for a gap.
- The scheduled run also deletes transactions older than 13 months (`PURGE=1`).

## Higher limits for some people

Admin panel: create a `PowerUsers` group, add the people, and give the group a configuration override with a higher `balance.refillAmount`. If the panel does not allow a `balance` override for a group, top them up with `docker compose exec api npm run add-balance -- <email> <credits>` instead.

## Retention changes

Changing `retentionMode` or the retention hours only affects records written afterwards. Existing chats get a new deadline the next time they are written to. Before switching from `all` back to `temporary`, clear deadlines on non-temporary data:

```js
db.conversations.updateMany({ isTemporary: false, expiredAt: { $ne: null } }, { $unset: { expiredAt: 1 } })
db.messages.updateMany({ isTemporary: false, expiredAt: { $ne: null } }, { $unset: { expiredAt: 1 } })
```

## Shared agents (built in the UI)

As carol, build three agents and share them with everyone (viewer):

| Agent | Model | Instructions in one line |
| --- | --- | --- |
| Estimate triage | Claude everyday | Read the request, list missing specs, size and material, then hand off |
| Spreadsheet analyst | GPT | Work with uploaded sheets; tables and totals only |
| Market research | Grok | Current events and competitor research, cite sources |

Wire Estimate triage with **Handoffs** to the other two, and turn on **Subagents** for one of them. Both are beta in v0.8.8; say so in training.
