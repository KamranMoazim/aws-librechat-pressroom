# Pace permission matrix

`matrix.json` lists every Pace tool for every role, with the expected result and the fields that must or must not appear. The same file drives the in-process tests (`npm run mcp:test`) and this runner, which works against any MCP server that implements the same tools, including the client's own Pace connector.

## Run it against a deployed server

1. Get an access token for the MCP API as each test person. With the Azure CLI added as an authorized client application on PressRoom-MCP (Azure CLI app ID `04b07795-8ddb-461a-bbee-02f9e1bf7b46`), sign in as that person and run `az account get-access-token --scope api://<mcp-client-id>/Mcp.Tools --query accessToken -o tsv`. Remove the authorized client afterwards.
2. Pick an open job and a restricted job in Pace.
3. Run from the repo root, over the VPN:

```bash
PACE_MCP_URL=https://<host>/mcp OPEN_JOB=J24017 RESTRICTED_JOB=J24011 \
TOKEN_USER=... TOKEN_ESTIMATOR=... TOKEN_PRODUCTION=... \
npm --prefix mcp run pace:permissions
```

Add `-- --allow-writes` to also prepare and commit a note as the production person. Leave it off against a live Pace.

## Adapting it to the client's connector

Edit `matrix.json` only: tool names, arguments, personas (role lists) and expectations. A result is `deny` when the tool returns an error whose text starts with `Not permitted`; ask their developer to use that prefix, or change `runCase` in `mcp/test/matrix.ts`.
