import { randomUUID } from 'node:crypto';
import type { Browser } from 'playwright-core';
import type { Server } from './aws.js';
import type { Config, Persona } from './config.js';
import type { LibreChatClient } from './librechat.js';
import type { Operator } from './operator.js';
import type { Report } from './report.js';
import { contextAs } from './session.js';

export interface Context {
  config: Config;
  report: Report;
  operator: Operator;
  server: Server;
  librechat(persona: Persona): Promise<LibreChatClient>;
  token(persona: Persona, scopes: string[]): Promise<string>;
  browser(): Promise<Browser>;
  chat(persona: Persona, text: string): Promise<string>;
  sleep(ms: number): Promise<void>;
  fetch: typeof fetch;
}

export interface Spec {
  id: string;
  title: string;
  run(ctx: Context): Promise<void>;
}

export function checker(ctx: Context, spec: string) {
  return {
    expect: (check: string, ok: boolean, evidence: unknown = '') =>
      ctx.report.expect(spec, check, ok, evidence),
    manual: async (check: string, instruction: string) => {
      if (!ctx.operator.interactive) {
        return ctx.report.record(spec, check, 'manual', instruction);
      }
      const done = await ctx.operator.confirm(`${check}\n    ${instruction}`);
      return ctx.report.record(
        spec,
        check,
        done ? 'pass' : 'fail',
        `operator: ${done ? 'confirmed' : 'not confirmed'}\n${instruction}`,
      );
    },
    skip: (check: string, reason: string) => ctx.report.record(spec, check, 'skipped', reason),
  };
}

export function marker(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export function hasReply(messages: unknown): boolean {
  return (
    Array.isArray(messages) &&
    messages.some(
      (message: any) =>
        !message.isCreatedByUser &&
        (Boolean(message.text) || (Array.isArray(message.content) && message.content.length > 0)),
    )
  );
}

export async function createChat(ctx: Context, persona: Persona, text: string): Promise<string> {
  const browser = await ctx.browser();
  const context = await contextAs(browser, ctx.config, persona);
  try {
    const page = await context.newPage();
    const query = new URLSearchParams({ spec: 'claude-everyday', prompt: text, submit: 'true' });
    await page.goto(`${ctx.config.chatUrl}/c/new?${query}`);
    await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 60000 });
    const conversationId = /\/c\/([0-9a-f-]{36})/.exec(page.url())![1];
    const client = await ctx.librechat(persona);
    for (let attempt = 0; attempt < 60; attempt++) {
      if (hasReply((await client.get(`/api/messages/${conversationId}`)).body)) {
        return conversationId;
      }
      await page.waitForTimeout(2000);
    }
    throw new Error(`no reply in conversation ${conversationId} after 2 minutes`);
  } finally {
    await context.close();
  }
}

export interface Uploaded {
  ok: boolean;
  status: number;
  fileId: string;
  record: Record<string, unknown>;
  text: string;
}

export async function createAgent(
  client: LibreChatClient,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const result = await client.post('/api/agents', {
    name,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    instructions: 'Go-live test agent.',
    ...extra,
  });
  return { ...result, id: String(result.body?.id ?? '') };
}

export async function uploadFile(
  client: LibreChatClient,
  agentId: string,
  name: string,
  content: string,
): Promise<Uploaded> {
  const form = new FormData();
  form.append('file_id', randomUUID());
  form.append('endpoint', 'agents');
  form.append('agent_id', agentId);
  form.append('tool_resource', 'file_search');
  form.append('file', new Blob([content], { type: 'text/plain' }), name);
  const result = await client.post('/api/files', form);
  const fileId = typeof result.body?.file_id === 'string' ? result.body.file_id : '';
  return {
    ok: result.status === 200 && fileId !== '' && typeof result.body?.filepath === 'string',
    status: result.status,
    fileId,
    record: result.body ?? {},
    text: result.text.slice(0, 500),
  };
}

export function deleteFile(client: LibreChatClient, upload: Uploaded) {
  const { file_id, filepath, source, type, embedded } = upload.record as Record<string, unknown>;
  return client.request('DELETE', '/api/files', {
    files: [{ file_id, filepath, source, type, embedded }],
  });
}
