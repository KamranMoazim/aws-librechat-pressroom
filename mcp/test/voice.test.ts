import { AgentAllowlist } from '../src/shared/allowlist.js';
import { createVoiceClient, ELEVENLABS_BASE_URL } from '../src/voice/client.js';
import { buildVoiceServer, MAX_TRANSCRIPT_CHARS, TOOL_NAMES } from '../src/voice/tools.js';
import { caller, check, connect, finish, memoryRecorder, resultText } from './helpers.js';

const NOW = Date.parse('2026-11-17T10:00:00Z');
const YESTERDAY = NOW / 1000 - 6 * 3600;

const allowlist = AgentAllowlist.parse({
  agents: [
    {
      id: 'va-reception',
      name: 'Reception',
      description: 'Answers the main line',
      roles: ['LibreChat.User'],
      callRoles: ['Outlook.Assistant'],
    },
    { id: 'va-collections', name: 'Collections', roles: ['Pace.Estimating'] },
  ],
});

const conversations: Record<string, any> = {
  'conv-r1': {
    agent_id: 'va-reception',
    conversation_id: 'conv-r1',
    start_time_unix_secs: YESTERDAY,
    call_duration_secs: 95,
    status: 'done',
    call_successful: 'success',
    transcript_summary: 'Caller asked when the Acme banner ships.',
    direction: 'inbound',
  },
  'conv-c1': {
    agent_id: 'va-collections',
    conversation_id: 'conv-c1',
    start_time_unix_secs: YESTERDAY + 60,
    call_duration_secs: 30,
    status: 'done',
    call_successful: 'failure',
    transcript_summary: 'Invoice 4411 disputed.',
  },
  'conv-x1': { agent_id: 'va-other', conversation_id: 'conv-x1', start_time_unix_secs: YESTERDAY },
};

const requests: { url: URL; init: RequestInit }[] = [];
let keyValid = true;
let longTranscript = false;
const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input));
  requests.push({ url, init });
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!keyValid) {
    return reply(401, { detail: 'invalid_api_key' });
  }
  if (url.pathname === '/v1/convai/conversations') {
    const agentId = url.searchParams.get('agent_id');
    const after = Number(url.searchParams.get('call_start_after_unix'));
    const list = Object.values(conversations).filter(
      (entry) => (!agentId || entry.agent_id === agentId) && entry.start_time_unix_secs > after,
    );
    return reply(200, {
      conversations: list,
      has_more: agentId === 'va-reception',
      next_cursor: 'c2',
    });
  }
  const match = /^\/v1\/convai\/conversations\/([^/]+)$/.exec(url.pathname);
  if (match) {
    const summary = conversations[match[1]];
    if (!summary) {
      return reply(404, {});
    }
    const turns = [
      { role: 'agent', time_in_call_secs: 0, message: 'PressRoom, how can I help?' },
      { role: 'user', time_in_call_secs: 3, message: 'When does my banner ship?' },
      { role: 'agent', time_in_call_secs: 6, message: null, tool_calls: [{}] },
    ];
    return reply(200, {
      agent_id: summary.agent_id,
      conversation_id: summary.conversation_id,
      status: 'done',
      has_audio: true,
      transcript: longTranscript
        ? Array.from({ length: 2000 }, (_, index) => ({
            role: 'user',
            time_in_call_secs: index,
            message: 'blah blah blah blah blah',
          }))
        : turns,
      metadata: {
        start_time_unix_secs: summary.start_time_unix_secs,
        call_duration_secs: 95,
        cost: 900,
      },
      analysis: {
        call_successful: 'success',
        transcript_summary: summary.transcript_summary,
        data_collection_results: { job_number: { value: 'J24000', rationale: 'said it' } },
      },
    });
  }
  if (url.pathname === '/v1/convai/twilio/outbound-call') {
    return reply(200, {
      success: true,
      message: 'ok',
      conversation_id: 'conv-out',
      callSid: 'CA1',
    });
  }
  return reply(404, {});
}) as typeof fetch;

const voice = createVoiceClient('xi-test', fakeFetch);
const recorder = memoryRecorder();
const connectAs = (roles: string[], oid: string, phoneNumberId?: string) =>
  connect(
    buildVoiceServer({
      caller: caller(roles, oid),
      context: { conversationId: `lc-${oid}` },
      voice,
      allowlist,
      recorder,
      phoneNumberId,
      now: () => NOW,
    }),
  );

const alice = await connectAs(
  ['LibreChat.User', 'Pace.Estimating', 'Outlook.Assistant'],
  'oid-alice',
  'pn-1',
);
const bob = await connectAs(['LibreChat.User'], 'oid-bob', 'pn-1');
const noPhone = await connectAs(['LibreChat.User', 'Outlook.Assistant'], 'oid-dave');

const names = async (client: typeof alice) =>
  (await client.listTools()).tools.map((tool) => tool.name).sort();
check(
  'with a phone number all four tools exist',
  JSON.stringify(await names(alice)) === JSON.stringify([...TOOL_NAMES].sort()),
);
check(
  'without a phone number start_call is left out',
  !(await names(noPhone)).includes('start_call'),
);

const listed = JSON.parse(
  resultText(await alice.callTool({ name: 'voice_agents_list', arguments: {} })),
);
check(
  'agent list shows who can place calls',
  listed.agents.length === 2 &&
    listed.agents[0].canStartCalls === true &&
    listed.agents[1].canStartCalls === false,
  listed,
);

const aliceCalls = JSON.parse(
  resultText(await alice.callTool({ name: 'conversations_list', arguments: {} })),
);
check(
  'default window is the last 24 hours across her agents, newest first',
  aliceCalls.count === 2 &&
    aliceCalls.calls[0].conversationId === 'conv-c1' &&
    aliceCalls.from === '2026-11-16T10:00:00.000Z',
  aliceCalls,
);
check(
  'no call from an agent outside the allowlist',
  !JSON.stringify(aliceCalls).includes('conv-x1'),
);
const listRequest = requests.find((entry) => entry.url.pathname === '/v1/convai/conversations')!;
check(
  'list call sends xi-api-key and summary_mode=include',
  listRequest.url.origin === ELEVENLABS_BASE_URL &&
    (listRequest.init.headers as Record<string, string>)['xi-api-key'] === 'xi-test' &&
    listRequest.url.searchParams.get('summary_mode') === 'include',
  String(listRequest.url),
);

const bobCalls = JSON.parse(
  resultText(await bob.callTool({ name: 'conversations_list', arguments: {} })),
);
check(
  'bob only sees reception calls',
  bobCalls.count === 1 &&
    bobCalls.calls[0].conversationId === 'conv-r1' &&
    bobCalls.nextCursor === undefined,
  bobCalls,
);
const bobPaged = JSON.parse(
  resultText(
    await bob.callTool({ name: 'conversations_list', arguments: { agentId: 'va-reception' } }),
  ),
);
check('cursor is passed back for a single agent', bobPaged.nextCursor === 'c2', bobPaged);
const bobDenied = await bob.callTool({
  name: 'conversations_list',
  arguments: { agentId: 'va-collections' },
});
check(
  'bob cannot list collections calls',
  bobDenied.isError === true && resultText(bobDenied).startsWith('Not permitted'),
);
const cursorAlone = await bob.callTool({ name: 'conversations_list', arguments: { cursor: 'c2' } });
check('cursor without agentId is refused', cursorAlone.isError === true);

const detail = JSON.parse(
  resultText(
    await bob.callTool({ name: 'conversation_get', arguments: { conversationId: 'conv-r1' } }),
  ),
);
check(
  'transcript keeps spoken turns only, with analysis',
  detail.transcript.length === 2 &&
    detail.transcript[1].text === 'When does my banner ship?' &&
    detail.collected.job_number === 'J24000' &&
    detail.summary.includes('Acme'),
  detail,
);
check(
  'audio flags and cost are not passed on',
  !('has_audio' in detail) && !JSON.stringify(detail).includes('"cost"'),
  detail,
);
const bobOther = await bob.callTool({
  name: 'conversation_get',
  arguments: { conversationId: 'conv-c1' },
});
check(
  'bob cannot read a collections transcript by id',
  bobOther.isError === true && resultText(bobOther).startsWith('Not permitted'),
);
const outside = await alice.callTool({
  name: 'conversation_get',
  arguments: { conversationId: 'conv-x1' },
});
check(
  'transcript of a non-allowlisted agent looks like not found',
  outside.isError === true && resultText(outside).includes('no such item'),
);

const requestsBefore = requests.length;
const dot = await alice.callTool({ name: 'conversation_get', arguments: { conversationId: '.' } });
check(
  'conversation id "." never reaches ElevenLabs',
  dot.isError === true && requests.length === requestsBefore,
);

longTranscript = true;
const long = JSON.parse(
  resultText(
    await alice.callTool({ name: 'conversation_get', arguments: { conversationId: 'conv-r1' } }),
  ),
);
check(
  'long transcript is truncated',
  long.transcript.truncated === true && long.transcript.firstChars.length === MAX_TRANSCRIPT_CHARS,
);
longTranscript = false;

const bobCall = await bob.callTool({
  name: 'start_call',
  arguments: { agentId: 'va-reception', toNumber: '+15551234567', reason: 'proof ready' },
});
check(
  'bob cannot start calls',
  bobCall.isError === true && resultText(bobCall).startsWith('Not permitted'),
);
const noCallRoles = await alice.callTool({
  name: 'start_call',
  arguments: { agentId: 'va-collections', toNumber: '+15551234567', reason: 'invoice' },
});
check(
  'agent without callRoles never calls',
  noCallRoles.isError === true && resultText(noCallRoles).includes('not set up'),
);
const badNumber = await alice.callTool({
  name: 'start_call',
  arguments: { agentId: 'va-reception', toNumber: '555-1234', reason: 'x' },
});
check('non E.164 number is refused', badNumber.isError === true);
check(
  'no outbound call reached ElevenLabs yet',
  !requests.some((entry) => entry.url.pathname.endsWith('outbound-call')),
);

const placed = await alice.callTool({
  name: 'start_call',
  arguments: {
    agentId: 'va-reception',
    toNumber: '+15551234567',
    reason: 'Tell Acme the proof is ready',
  },
});
const outbound = requests.find((entry) => entry.url.pathname.endsWith('outbound-call'))!;
check(
  'start_call sends agent, phone number id and target',
  !placed.isError &&
    JSON.stringify(JSON.parse(String(outbound.init.body))) ===
      JSON.stringify({
        agent_id: 'va-reception',
        agent_phone_number_id: 'pn-1',
        to_number: '+15551234567',
      }),
  placed,
);
check(
  'start_call is recorded',
  recorder.actions.length === 1 &&
    recorder.actions[0].tool === 'start_call' &&
    recorder.actions[0].result === 'started' &&
    recorder.actions[0].conversationId === 'lc-oid-alice',
  recorder.actions,
);

keyValid = false;
const rotated = await alice.callTool({ name: 'conversations_list', arguments: {} });
check(
  'rotated key fails closed with a clear message',
  rotated.isError === true && resultText(rotated).includes("refused the server's API key"),
  rotated,
);

await Promise.all([alice.close(), bob.close(), noPhone.close()]);
finish();
