import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import type { ActionRecorder, ApprovedAction } from '../src/shared/audit.js';
import type { Caller } from '../src/shared/auth.js';

let passed = 0;
let failed = 0;

export function check(name: string, ok: boolean, extra?: unknown): void {
  if (ok) {
    passed++;
  } else {
    failed++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(extra)}`);
}

export function finish(): void {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

export const TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const MCP_CLIENT_ID = '22222222-2222-2222-2222-222222222222';

export async function createIssuer() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: JWTPayload, options: { expiresIn?: string; issuer?: string } = {}) =>
    new SignJWT({
      tid: TENANT_ID,
      oid: 'oid-alice',
      preferred_username: 'alice@example.com',
      scp: 'Mcp.Tools',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(options.issuer ?? `https://login.microsoftonline.com/${TENANT_ID}/v2.0`)
      .setAudience(MCP_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '10m')
      .sign(privateKey);
  return { keys, sign };
}

export function caller(roles: string[], oid = 'oid-alice'): Caller {
  return { oid, upn: `${oid}@example.com`, tenantId: TENANT_ID, roles, token: 'token' };
}

export function memoryRecorder(): ActionRecorder & { actions: ApprovedAction[] } {
  const actions: ApprovedAction[] = [];
  return {
    actions,
    async record(action) {
      actions.push(action);
    },
  };
}

export async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export function resultText(result: any): string {
  return (result?.content ?? []).map((part: any) => part.text ?? '').join('');
}
