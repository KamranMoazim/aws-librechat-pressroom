import { createVendorFetch, VendorError } from '../shared/vendor.js';

export const VENDOR = 'Relevance AI';

export interface TriggeredRun {
  jobId: string;
  studioId: string;
  conversationId: string;
}

export type RunState =
  | { state: 'running' }
  | { state: 'failed'; detail: unknown }
  | { state: 'complete'; output: unknown };

export interface RelevanceClient {
  trigger(agentId: string, message: string, conversationId?: string): Promise<TriggeredRun>;
  poll(studioId: string, jobId: string): Promise<RunState>;
}

export function relevanceBaseUrl(region: string): string {
  if (!/^[a-z0-9-]+$/.test(region)) {
    throw new Error('RELEVANCE_REGION must look like f1db6c');
  }
  return `https://api-${region}.stack.tryrelevance.com/latest`;
}

export function createRelevanceClient(
  options: { region: string; projectId: string; apiKey: string },
  fetchImpl: typeof fetch = fetch,
): RelevanceClient {
  const call = createVendorFetch(
    VENDOR,
    relevanceBaseUrl(options.region),
    { Authorization: `${options.projectId}:${options.apiKey}` },
    fetchImpl,
  );
  return {
    async trigger(agentId, message, conversationId) {
      const body = await call('/agents/trigger', {
        method: 'POST',
        body: {
          agent_id: agentId,
          message: { role: 'user', content: message },
          ...(conversationId ? { conversation_id: conversationId } : {}),
        },
      });
      const jobId = body?.job_info?.job_id;
      const studioId = body?.job_info?.studio_id;
      if (typeof jobId !== 'string' || typeof studioId !== 'string') {
        throw new VendorError(VENDOR, 502, 'trigger answered without job_info');
      }
      return { jobId, studioId, conversationId: String(body.conversation_id ?? '') };
    },
    async poll(studioId, jobId) {
      const body = await call(
        `/studios/${encodeURIComponent(studioId)}/async_poll/${encodeURIComponent(jobId)}`,
        { query: { ending_update_only: 'true' } },
      );
      if (body?.type === 'failed') {
        return { state: 'failed', detail: body.updates ?? null };
      }
      if (body?.type !== 'complete') {
        return { state: 'running' };
      }
      const updates: any[] = Array.isArray(body.updates) ? body.updates : [];
      const last = updates.at(-1);
      return { state: 'complete', output: last?.output ?? updates };
    },
  };
}
