import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Caller } from './auth.js';
import { log } from './log.js';

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function notPermitted(
  server: string,
  tool: string,
  caller: Caller,
  role: string,
): CallToolResult {
  log.warn('denied', { server, tool, userOid: caller.oid, upn: caller.upn, missingRole: role });
  return errorResult(
    `Not permitted: your account does not have the ${role} role. Ask IT if you need it.`,
  );
}
