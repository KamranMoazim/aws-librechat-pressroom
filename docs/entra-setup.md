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

- Platform: Web, redirect `https://chat.pressroom.<domain>/oauth/openid/callback`, front-channel logout `https://chat.pressroom.<domain>/`.
- Certificates & secrets: new client secret (store as `/pressroom/openid-client-secret` in SSM).
- Expose an API: Application ID URI `api://<client-id>`, scope `access_as_user` (admins and users can consent).
- App roles (allowed member types: Users/Groups): `LibreChat.User`, `LibreChat.Admin`, `Pace.Estimating`, `Pace.Production`, `Outlook.Assistant`.
- API permissions (delegated): Microsoft Graph `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Files.Read.All`; SharePoint `AllSites.Read`. Grant admin consent.
- Token configuration: add optional claim `email` to the ID token.

### PressRoom-MCP

- No redirect URI (API only).
- Expose an API: `api://pressroom-mcp`, scope `Mcp.Tools`. Add PressRoom-LibreChat as an authorized client application for it.
- API permissions (delegated): Graph `Mail.ReadWrite`, `Calendars.Read`, `User.Read`. **Do not add `Mail.Send`.** Grant admin consent.
- Client secret for its own on-behalf-of exchange to Graph.

### PressRoom-Portal

- Platform: Web, redirect `https://portal.pressroom.<domain>/auth/callback`.
- Delegated Graph `User.Read`.

## 5. Role assignments

Enterprise applications > PressRoom-LibreChat > Users and groups:

| User | Roles |
| --- | --- |
| alice | LibreChat.User, Pace.Estimating, Outlook.Assistant |
| bob | LibreChat.User |
| carol | LibreChat.User, LibreChat.Admin |
| dave | LibreChat.User, Outlook.Assistant |
| eve | none |

Set **Assignment required? = Yes** on the enterprise app so eve is refused by Entra as well as by LibreChat's role check.
