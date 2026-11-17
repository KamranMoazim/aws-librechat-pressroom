# LibreChat inside the in-house web app

## How it works

```
portal.pressroom.<domain>/production
  1. hidden frame: chat.pressroom.<domain>/pressroom/session.html
       calls POST /api/auth/refresh (same origin) and posts only {signedIn: true|false} to the portal origin
  2a. signed in  -> frame chat.pressroom.<domain>/c/new?spec=claude-everyday&prompt=...
  2b. not signed in -> "Sign in to chat" link, top level:
       chat/pressroom/signin  (nginx: cookie pressroom_return=portal, 2 min, Path=/oauth)
       -> /oauth/openid -> Microsoft -> /oauth/openid/callback
       nginx rewrites LibreChat's redirect to https://portal.pressroom.<domain>/ (only that address)
       -> portal returns to /production (sessionStorage) -> step 1 again, now signed in
```

Microsoft's sign-in page refuses to load in a frame, so the one sign-in has to happen at top level. After that the frame works, because `portal.` and `chat.` are the same site: LibreChat's `SameSite=Strict` cookies are sent to the frame and are not partitioned.

## Pieces

| Where | What |
| --- | --- |
| `mocks/portal` | Express + MSAL Node (auth code + PKCE), 8 h in-memory sessions, CSP `frame-src https://chat...`, `frame-ancestors 'none'`, no inline script |
| `server/nginx/pressroom/` | `session.html` + `session.js`, served by nginx on the chat host, framable only by the portal |
| `server/nginx/templates/default.conf.template` | `frame-ancestors 'self' https://portal...` on every chat response; `/pressroom/signin`; callback redirect rewrite; portal host |
| `server/.env.template` | `CSP_ENABLED=true`, `CSP_REPORT_ONLY=true`, `CSP_FRAME_ANCESTORS`, `X_FRAME_OPTIONS=off` |

LibreChat (v0.8.8) sends its CSP only on the app page, and `X_FRAME_OPTIONS=off` removes the old header from everything. nginx's `frame-ancestors` covers every response, so framing stays locked even while LibreChat's own CSP is in report-only mode (decisions.md #16).

## Tests

```bash
npm run portal:test     # portal routes, sign-in state, cookies, CSP (28)
npm run embed:test      # pinned nginx with stubs (16), then a real Chromium run (9)
```

The browser test needs Playwright's Chromium. If the cached build does not match, either `npx playwright-core install chromium-headless-shell` or point `CHROMIUM_PATH` at a Chromium binary. It proves: one top-level sign-in, return to the same page, no second sign-in on the next page, the chat cookie reaches the frame, a page on another origin cannot frame the chat or hear from the probe.

## Handover note for the client's app developer

1. **Same registrable domain.** Your app must be served from a sibling of the chat host (for example `intranet.<company-domain>` next to `chat.<company-domain>`). On another domain, browsers treat the frame as third party and drop LibreChat's cookies; there is no setting that fixes that.
2. **Tell us your exact origin.** We add it to `frame-ancestors` in nginx and to `CSP_FRAME_ANCESTORS` in `.env`. Nothing else may frame the chat.
3. **Your page's CSP** needs `frame-src https://chat.<company-domain>`. If you send `X-Frame-Options` or `frame-ancestors` on your own pages, that does not affect the chat.
4. **Sign-in pattern.** Frame `https://chat.<company-domain>/pressroom/session.html` (hidden), listen for `message` events where `event.origin` is the chat origin and `event.data.type === 'pressroom-session'`. If `signedIn` is false, send the person (top level, not in the frame) to `https://chat.<company-domain>/pressroom/signin`; they come back to your home page. Remember which page they were on yourself. See `mocks/portal/public/portal.js`, about 60 lines.
5. **Deep links.** `/c/new?spec=<model spec name>` picks a model spec, `agent_id=<id>` opens an agent, `prompt=<text>` fills the box. Never add `submit=true` from anything a user or a link can influence: it sends the prompt immediately (tool approvals still apply).
6. **Frame attributes.** `allow="microphone; clipboard-read; clipboard-write"` so dictation and copy buttons work.
7. **Sign-out.** Signing out of your app does not sign out of the chat. Link to the chat's own sign-out if you need both.

## Checks (Phase 6 done when)

| Check | Expected |
| --- | --- |
| alice opens the portal with no chat session | "Sign in to chat"; one Microsoft prompt (or none, if already signed in to Microsoft); back on the same portal page with the chat in the frame |
| alice moves to another portal page | Chat appears, no sign-in |
| A page on any other origin frames `https://chat...` | Blocked, console shows a `frame-ancestors` violation |
| Browser console on the chat for a week | No `Content-Security-Policy-Report-Only` violations, then set `CSP_REPORT_ONLY=false` |
