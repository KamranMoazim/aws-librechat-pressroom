import { fileURLToPath } from 'node:url';
import { createPortalApp } from './app.js';
import { createMsalAuthenticator } from './auth.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function log(message: string, fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), message, ...fields })}\n`);
}

const domain = required('DOMAIN');
const app = createPortalApp({
  auth: createMsalAuthenticator({
    tenantId: required('ENTRA_TENANT_ID'),
    clientId: required('PORTAL_CLIENT_ID'),
    clientSecret: required('PORTAL_CLIENT_SECRET'),
    redirectUri: `https://portal.pressroom.${domain}/auth/callback`,
  }),
  chatOrigin: `https://chat.pressroom.${domain}`,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  log,
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  log('listening', { server: 'portal', port });
});
