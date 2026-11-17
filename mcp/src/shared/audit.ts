import { createHash } from 'node:crypto';
import { log } from './log.js';

export interface ApprovedAction {
  userOid: string;
  upn: string;
  tool: string;
  target: string;
  summary: string;
  args: unknown;
  before?: unknown;
  after?: unknown;
  conversationId?: string;
  result: string;
}

export interface ActionRecorder {
  record(action: ApprovedAction): Promise<void>;
}

export function sha256Of(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const logRecorder: ActionRecorder = {
  async record(action) {
    const { args, ...rest } = action;
    log.info('approved action', { ...rest, argsSha256: sha256Of(args) });
  },
};
