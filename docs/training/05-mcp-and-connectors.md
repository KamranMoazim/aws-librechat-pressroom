# MCP and connectors

Pairs with Phases 3 to 5. 90 to 120 minutes, hands on.

**Goal:** Add, check and withdraw connectors.

## Exercise

1. Read one on-behalf-of call end to end: LibreChat token, MCP token check, Graph token (`mcp/src/shared/auth.ts`, `obo.ts`).
2. Add a Relevance agent to `server/mcp-config/relevance-agents.json` and restart the gateway.
3. Remove dave's `Outlook.Assistant` role and watch his next call fail.

## Expected result

The agent shows in `agents_list` for the right role only; dave gets "Not permitted".

## If it breaks, look here

- `runbooks/day-2.md` (add an MCP server, revoke a connector)
- `docker compose logs mcp-<name> | grep denied`
- `mcpSettings.allowedAddresses` must list every internal MCP host
