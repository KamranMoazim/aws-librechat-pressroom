import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import { buildOutlookServer } from '../src/outlook/tools.js';
import { createVerifier } from '../src/shared/auth.js';
import { createMcpApp } from '../src/shared/http.js';
import {
  check,
  createIssuer,
  finish,
  MCP_CLIENT_ID,
  memoryRecorder,
  resultText,
  TENANT_ID,
} from './helpers.js';

const { keys, sign } = await createIssuer();
const recorder = memoryRecorder();
const graphTokens: string[] = [];
const app = createMcpApp({
  name: 'outlook',
  verify: createVerifier({
    tenantId: TENANT_ID,
    audiences: [MCP_CLIENT_ID],
    requiredScope: 'Mcp.Tools',
    keys,
  }),
  buildServer: (caller, context) =>
    buildOutlookServer({
      caller,
      context,
      recorder,
      graph: async (path) => {
        graphTokens.push(caller.oid);
        if (path.endsWith('/createReply')) {
          return { id: 'draft-9', webLink: 'https://outlook.office.com/mail/draft-9' };
        }
        return { value: [] };
      },
    }),
});
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

const health = await fetch(url.replace('/mcp', '/healthz'));
check('health check answers', health.status === 200);

const anonymous = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
check('request without a token gets 401', anonymous.status === 401, anonymous.status);
const getMethod = await fetch(url, { headers: { Authorization: `Bearer ${await sign({})}` } });
check('GET /mcp is not allowed', getMethod.status === 405, getMethod.status);

async function clientFor(token: string, conversationId?: string): Promise<Client> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (conversationId) {
    headers['X-Conversation-Id'] = conversationId;
  }
  const client = new Client({ name: 'librechat-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }),
  );
  return client;
}

const alice = await clientFor(await sign({ roles: ['Outlook.Assistant'] }), 'conv-http');
const listed = await alice.listTools();
check(
  'authenticated client lists tools over streamable HTTP',
  listed.tools.length === 4,
  listed.tools.length,
);
const draft = await alice.callTool({
  name: 'draft_reply',
  arguments: { messageId: 'm1', comment: 'Ships Friday' },
});
check('tool call works end to end', resultText(draft).includes('draft-9'), draft);
check(
  'conversation id header reaches the audit record',
  recorder.actions[0]?.conversationId === 'conv-http' &&
    recorder.actions[0]?.upn === 'alice@example.com',
  recorder.actions,
);

const bob = await clientFor(await sign({ oid: 'oid-bob', roles: [] }));
const bobResult = await bob.callTool({ name: 'mail_search', arguments: { query: 'x' } });
check(
  'user without the role connects but gets not permitted',
  bobResult.isError === true && resultText(bobResult).startsWith('Not permitted'),
  bobResult,
);
check(
  'only alice ever reached Graph',
  graphTokens.every((oid) => oid === 'oid-alice'),
  graphTokens,
);

const forged = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${await (await createIssuer()).sign({ roles: ['Outlook.Assistant'] })}`,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
check('token signed by an unknown key gets 401', forged.status === 401, forged.status);

await alice.close();
await bob.close();
server.close();
finish();
