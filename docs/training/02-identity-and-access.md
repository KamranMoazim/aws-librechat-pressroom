# Identity and access

Pairs with Phase 1. 90 to 120 minutes, hands on.

**Goal:** Give and take access with Entra app roles; use the admin panel safely.

## Exercise

1. Assign `LibreChat.User` to a test person; sign in as them.
2. Sign in as eve (no role) and read the refusal.
3. In the admin panel, add an admin with the smallest grant that lets them read spend.

## Expected result

eve is refused at sign-in; the new admin sees only what the grant allows.

## If it breaks, look here

- `docs/entra-setup.md` (roles live on two app registrations: LibreChat and PressRoom-MCP)
- `OPENID_REQUIRED_ROLE` and `OPENID_ADMIN_ROLE` in `.env`
- api logs: `docker compose logs api | grep -i openid`
