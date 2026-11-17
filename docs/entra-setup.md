# Entra and Microsoft 365 setup

Manual steps in the Microsoft side of the test tenant. Do them before Phase 1; the VPN part is needed for Phase 0's session stack.

## 1. Tenant

1. Create an Entra tenant (or use a Microsoft 365 Developer Program sandbox if you qualify).
2. Entra admin center > Overview > Properties > Manage security defaults: **Enabled**. This gives every user MFA for free. The client will likely use Conditional Access (Entra P1) instead; note both in the runbook.
3. Start a **Microsoft 365 Business Basic** trial for Exchange mailboxes and SharePoint. Cancel it when the build is done.
4. Note the tenant ID (Overview).

## 2. Test users

| User | Purpose |
| --- | --- |
| alice | Estimator: normal use, approved actions |
| bob | Sales: restricted records, chat isolation |
| carol | IT: admin panel, runbooks |
| dave | Leaver: offboarding, connector revocation |
| eve | No role: denied at sign-in |

Give alice, bob, carol and dave a Business Basic licence. eve needs none.

## 3. AWS Client VPN (SAML enterprise app)

1. Enterprise applications > New application > Create your own application > "AWS Client VPN" (non-gallery).
2. Single sign-on > SAML:
   - Identifier (Entity ID): `urn:amazon:webservices:clientvpn`
   - Reply URL: `http://127.0.0.1:35001`
3. Attributes and claims: keep `NameID` (user.userprincipalname), add `FirstName` (user.givenname), `LastName` (user.surname), and a group claim **Groups assigned to the application**, source attribute Group ID, named `memberOf`.
4. Create a security group `PressRoom-VPN`, add alice, bob, carol and dave, and assign the group to the app. Put its object ID in `infra/.env` as `VPN_ENTRA_GROUP_ID`.
5. Download **Federation Metadata XML** and save it as `infra/vpn/entra-saml-metadata.xml` (ignored by git).
6. For the self-service portal, add a second app the same way with Reply URL `https://self-service.clientvpn.amazonaws.com/api/auth/sso/saml`, or skip it and use the exported profile from `session-up.sh`.

## 4. App registrations

### PressRoom-LibreChat

- Platform: Web, redirects `https://chat.pressroom.<domain>/oauth/openid/callback` and `https://chat.pressroom.<domain>/api/admin/oauth/openid/callback` (admin panel SSO), front-channel logout `https://chat.pressroom.<domain>/`.
- Certificates & secrets: new client secret. `infra/scripts/set-secrets.sh` prompts for it and stores it as `/pressroom/secrets/openid-client-secret`.
- Put the tenant ID and this app's client ID in `infra/.env` as `ENTRA_TENANT_ID` and `OPENID_CLIENT_ID`.
- Expose an API: Application ID URI `api://<client-id>`, scope `access_as_user` (admins and users can consent).
- App roles (allowed member types: Users/Groups): `LibreChat.User`, `LibreChat.Admin`.
- API permissions (delegated): Microsoft Graph `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Files.Read.All`; SharePoint `AllSites.Read`; **PressRoom-MCP `Mcp.Tools`** (added after the MCP app exists). Grant admin consent.
- Token configuration: add optional claim `email` to the ID token.

### PressRoom-MCP

The API that LibreChat exchanges the user's token for (on-behalf-of). Each MCP server validates that token and does its own on-behalf-of exchange to Graph.

- No redirect URI (API only).
- Manifest: `"requestedAccessTokenVersion": 2` (Entra admin center: Manifest, `api.requestedAccessTokenVersion`), so tokens carry the v2 issuer and `aud` = the client ID.
- Expose an API: Application ID URI `api://<mcp-client-id>`, scope `Mcp.Tools` (admins and users can consent). Under "Authorized client applications" add the PressRoom-LibreChat client ID for that scope.
- App roles (Users/Groups): `Outlook.Assistant`, `Pace.Estimating`, `Pace.Production`. These are checked by the MCP servers, so they live on this app, not on PressRoom-LibreChat.
- API permissions (delegated): Graph `Mail.ReadWrite`, `Calendars.Read`, `User.Read`. **Do not add `Mail.Send`.** Grant admin consent.
- Client secret: `npm run secrets` stores it as `/pressroom/secrets/mcp-client-secret`. Put the client ID in `infra/.env` as `MCP_CLIENT_ID`.

### PressRoom-Portal

- Platform: Web, redirect `https://portal.pressroom.<domain>/auth/callback`. Sign-in only (`openid profile`), PKCE.
- Delegated Graph `User.Read`.
- Certificates & secrets: new client secret. `npm run secrets` stores it as `/pressroom/secrets/portal-client-secret`; the client id goes to `/pressroom/config/portal-client-id`.
- Enterprise application > Properties: **Assignment required = Yes**, and assign the same people as LibreChat.

## 5. Role assignments

Enterprise applications > PressRoom-LibreChat > Users and groups:

| User | Roles |
| --- | --- |
| alice | LibreChat.User |
| bob | LibreChat.User |
| carol | LibreChat.User, LibreChat.Admin |
| dave | LibreChat.User |
| eve | none |

Enterprise applications > PressRoom-MCP > Users and groups:

| User | Roles |
| --- | --- |
| alice | Pace.Estimating, Pace.Production, Outlook.Assistant |
| dave | Outlook.Assistant |

Set **Assignment required? = Yes** on PressRoom-LibreChat so eve is refused by Entra as well as by LibreChat's role check. Leave it **No** on PressRoom-MCP, so bob can still get an MCP token and receive a clean "not permitted" from the server instead of a sign-in error.

## 6. SharePoint sites for the restricted-records test

Create two team sites, **Estimating** (alice, dave) and **Sales** (bob), and put a few files in each. Put the tenant name (the part before `.sharepoint.com`) in `infra/.env` as `SHAREPOINT_TENANT`.
