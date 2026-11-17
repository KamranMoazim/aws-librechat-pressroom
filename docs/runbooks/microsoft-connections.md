# Microsoft connections: SharePoint picker and Outlook

## How the tokens flow

```
alice signs in to LibreChat (Entra, MFA)        token A: aud PressRoom-LibreChat
LibreChat, on an Outlook tool call: OBO A -> B  token B: aud PressRoom-MCP, scp Mcp.Tools, roles
mcp-outlook: checks B (signature, iss, aud, tid, scp), then roles has Outlook.Assistant
mcp-outlook: OBO B -> C                         token C: Graph, Mail.ReadWrite + Calendars.Read
```

Nobody else sees token C. LibreChat never holds a Graph mail token, and the MCP server never receives the user's LibreChat token.

The shortcut, `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` in a server's `headers` with `GRAPH_API_SCOPES`, hands a Graph token straight to the MCP server. It is simpler, but the server then holds a token it did not ask for, and the scopes are one global setting for every server. We don't use it here.

## SharePoint file picker

Built into LibreChat (`ENABLE_SHAREPOINT_FILEPICKER=true` in `.env.template`). Delegated permissions mean the picker shows only what the signed-in user can already open.

## Outlook tools

| Tool | Graph call | Approval |
| --- | --- | --- |
| `mail_search` | `GET /me/messages?$search=` | allowed |
| `mail_get` | `GET /me/messages/{id}` (text body, 20,000 characters max) | allowed |
| `calendar_view` | `GET /me/calendarView` (31 days max, UTC) | allowed |
| `draft_reply` | `POST /me/messages/{id}/createReply` with the reply as `comment` | **ask** |

- The draft keeps the quoted original. The tool returns its `webLink`; the person opens it in Outlook, checks it and sends it. The app has no `Mail.Send`, so the server cannot send even if a prompt tells it to.
- Every `draft_reply`, created or failed, writes an approved-action record. Until Phase 4 the record is a JSON line in `docker compose logs mcp-outlook`.
- Approval rules live in `librechat.template.yaml` under `endpoints.agents.toolApproval` (`mcp:<server>:<tool>` patterns).

## Revoke a connector for one person

| Action | Effect | When |
| --- | --- | --- |
| Remove `Outlook.Assistant` on PressRoom-MCP | Tools answer "not permitted" | Next MCP token (LibreChat re-exchanges per session, at most about an hour) |
| Remove the `outlook` block from the yaml and restart `api` | Tools disappear for everyone | Immediately |
| Revoke sessions in Entra | Next token refresh fails | Up to about an hour; ban in the admin panel for immediate effect |

## Checks (Phase 3 done when)

| Check | Expected |
| --- | --- |
| alice: "draft a polite reply to the latest email from Acme saying the banner proof ships Friday" | Searches, reads, then shows an approval card for `draft_reply` |
| alice approves, opens the link | Draft in Outlook Drafts, quoted original below; nothing in Sent Items |
| `docker compose logs mcp-outlook \| grep 'approved action'` | One record with alice's oid and the conversation id |
| bob asks the same | "Not permitted: your account does not have the Outlook.Assistant role" |
| bob's SharePoint picker | No Estimating site |
| bob's token on an Estimating file: `GET /drives/{drive-id}/items/{item-id}/content` | 403 |
| `curl http://mcp-outlook:8101/mcp` from the `api` container without a token | 401 |
