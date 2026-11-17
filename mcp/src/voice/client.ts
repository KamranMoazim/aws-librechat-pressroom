import { createVendorFetch } from '../shared/vendor.js';

export const VENDOR = 'ElevenLabs';
export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

export interface ConversationQuery {
  agentId: string;
  afterUnix: number;
  beforeUnix?: number;
  pageSize: number;
  cursor?: string;
}

export interface OutboundCall {
  agentId: string;
  phoneNumberId: string;
  toNumber: string;
}

export interface VoiceClient {
  listConversations(query: ConversationQuery): Promise<any>;
  getConversation(conversationId: string): Promise<any>;
  startCall(call: OutboundCall): Promise<any>;
}

export function createVoiceClient(apiKey: string, fetchImpl: typeof fetch = fetch): VoiceClient {
  const call = createVendorFetch(VENDOR, ELEVENLABS_BASE_URL, { 'xi-api-key': apiKey }, fetchImpl);
  return {
    listConversations: ({ agentId, afterUnix, beforeUnix, pageSize, cursor }) =>
      call('/v1/convai/conversations', {
        query: {
          agent_id: agentId,
          call_start_after_unix: afterUnix,
          call_start_before_unix: beforeUnix,
          page_size: pageSize,
          cursor,
          summary_mode: 'include',
        },
      }),
    getConversation: (conversationId) =>
      call(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`),
    startCall: ({ agentId, phoneNumberId, toNumber }) =>
      call('/v1/convai/twilio/outbound-call', {
        method: 'POST',
        body: { agent_id: agentId, agent_phone_number_id: phoneNumberId, to_number: toNumber },
      }),
  };
}
