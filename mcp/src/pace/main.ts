import { createVerifier } from '../shared/auth.js';
import { createRecorder } from '../shared/recorder.js';
import { createMcpApp } from '../shared/http.js';
import { log } from '../shared/log.js';
import { createPaceClient } from './client.js';
import { PendingChanges } from './pending.js';
import { buildPaceServer } from './tools.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const tenantId = required('ENTRA_TENANT_ID');
const clientId = required('MCP_CLIENT_ID');
const pace = createPaceClient(required('PACE_API_URL'), required('PACE_API_KEY'));
const pending = new PendingChanges();
const recorder = createRecorder(process.env.AUDIT_DATABASE_URL);

const app = createMcpApp({
  name: 'pace',
  verify: createVerifier({
    tenantId,
    audiences: [clientId, `api://${clientId}`],
    requiredScope: 'Mcp.Tools',
  }),
  buildServer: (caller, context) => buildPaceServer({ caller, context, pace, pending, recorder }),
});

const port = Number(process.env.PORT ?? 8102);
app.listen(port, () => {
  log.info('listening', { server: 'pace', port });
});
