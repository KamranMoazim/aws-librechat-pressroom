import { createVerifier } from '../shared/auth.js';
import { createMcpApp } from '../shared/http.js';
import { log } from '../shared/log.js';
import { createOboExchanger } from '../shared/obo.js';
import { createRecorder } from '../shared/recorder.js';
import { createGraphFetch } from './graph.js';
import { buildOutlookServer } from './tools.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const tenantId = required('ENTRA_TENANT_ID');
const clientId = required('MCP_CLIENT_ID');
const exchange = createOboExchanger({
  tenantId,
  clientId,
  clientSecret: required('MCP_CLIENT_SECRET'),
});
const verify = createVerifier({
  tenantId,
  audiences: [clientId, `api://${clientId}`],
  requiredScope: 'Mcp.Tools',
});

const recorder = createRecorder(process.env.AUDIT_DATABASE_URL);

const app = createMcpApp({
  name: 'outlook',
  verify,
  buildServer: (caller, context) =>
    buildOutlookServer({
      caller,
      context,
      recorder,
      graph: createGraphFetch(() => exchange(caller, ['https://graph.microsoft.com/.default'])),
    }),
});

const port = Number(process.env.PORT ?? 8101);
app.listen(port, () => {
  log.info('listening', { server: 'outlook', port });
});
