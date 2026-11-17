import { AgentAllowlist } from '../shared/allowlist.js';
import { createVerifier } from '../shared/auth.js';
import { createMcpApp } from '../shared/http.js';
import { log } from '../shared/log.js';
import { createRecorder } from '../shared/recorder.js';
import { createVoiceClient } from './client.js';
import { buildVoiceServer } from './tools.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const tenantId = required('ENTRA_TENANT_ID');
const clientId = required('MCP_CLIENT_ID');
const voice = createVoiceClient(required('ELEVENLABS_API_KEY'));
const allowlist = AgentAllowlist.load(process.env.AGENTS_FILE ?? '/config/voice-agents.json');
const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID || undefined;
const recorder = createRecorder(process.env.AUDIT_DATABASE_URL);

const app = createMcpApp({
  name: 'voice',
  verify: createVerifier({
    tenantId,
    audiences: [clientId, `api://${clientId}`],
    requiredScope: 'Mcp.Tools',
  }),
  buildServer: (caller, context) =>
    buildVoiceServer({ caller, context, voice, allowlist, recorder, phoneNumberId }),
});

const port = Number(process.env.PORT ?? 8104);
app.listen(port, () => {
  log.info('listening', { server: 'voice', port, startCall: Boolean(phoneNumberId) });
});
