import { AgentAllowlist } from '../shared/allowlist.js';
import { createVerifier } from '../shared/auth.js';
import { createMcpApp } from '../shared/http.js';
import { log } from '../shared/log.js';
import { createRecorder } from '../shared/recorder.js';
import { createRelevanceClient } from './client.js';
import { AgentRuns } from './runs.js';
import { buildRelevanceServer } from './tools.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const tenantId = required('ENTRA_TENANT_ID');
const clientId = required('MCP_CLIENT_ID');
const relevance = createRelevanceClient({
  region: required('RELEVANCE_REGION'),
  projectId: required('RELEVANCE_PROJECT_ID'),
  apiKey: required('RELEVANCE_API_KEY'),
});
const allowlist = AgentAllowlist.load(process.env.AGENTS_FILE ?? '/config/relevance-agents.json');
const runs = new AgentRuns();
const recorder = createRecorder(process.env.AUDIT_DATABASE_URL);

const app = createMcpApp({
  name: 'relevance',
  verify: createVerifier({
    tenantId,
    audiences: [clientId, `api://${clientId}`],
    requiredScope: 'Mcp.Tools',
  }),
  buildServer: (caller, context) =>
    buildRelevanceServer({ caller, context, relevance, allowlist, runs, recorder }),
});

const port = Number(process.env.PORT ?? 8103);
app.listen(port, () => {
  log.info('listening', { server: 'relevance', port });
});
