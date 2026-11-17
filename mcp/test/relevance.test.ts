import { createRelevanceClient } from '../src/relevance/client.js';
import { AgentRuns, RUN_TTL_MS } from '../src/relevance/runs.js';
import { buildRelevanceServer, MAX_OUTPUT_CHARS, TOOL_NAMES } from '../src/relevance/tools.js';
import { AgentAllowlist } from '../src/shared/allowlist.js';
import { caller, check, connect, finish, memoryRecorder, resultText } from './helpers.js';

const BASE = 'https://api-f1db6c.stack.tryrelevance.com/latest';

const allowlist = AgentAllowlist.parse({
  agents: [
    {
      id: 'agent-quotes',
      name: 'Quote follow-up',
      description: 'Chases open quotes',
      roles: ['LibreChat.User'],
    },
    { id: 'agent-margins', name: 'Margin review', roles: ['Pace.Estimating'] },
  ],
});

const requests: { url: string; init: RequestInit }[] = [];
let pollAnswers: unknown[] = [];
let keyValid = true;
const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input);
  requests.push({ url, init });
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!keyValid) {
    return reply(401, { message: 'invalid key' });
  }
  if (url === `${BASE}/agents/trigger`) {
    const body = JSON.parse(String(init.body));
    return reply(200, {
      job_info: { job_id: `job-${requests.length}`, studio_id: `studio-${body.agent_id}` },
      conversation_id: body.conversation_id ?? `conv-${requests.length}`,
      agent_id: body.agent_id,
    });
  }
  if (url.includes('/async_poll/')) {
    return reply(200, pollAnswers.shift() ?? { type: 'running', updates: [] });
  }
  return reply(404, {});
}) as typeof fetch;

let clock = Date.parse('2026-11-17T10:00:00Z');
const relevance = createRelevanceClient(
  { region: 'f1db6c', projectId: 'proj-1', apiKey: 'sk-test' },
  fakeFetch,
);
const runs = new AgentRuns(() => clock);
const recorder = memoryRecorder();
const sleeps: number[] = [];
const connectAs = (roles: string[], oid: string) =>
  connect(
    buildRelevanceServer({
      caller: caller(roles, oid),
      context: { conversationId: `lc-${oid}` },
      relevance,
      allowlist,
      runs,
      recorder,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    }),
  );

const alice = await connectAs(['LibreChat.User', 'Pace.Estimating'], 'oid-alice');
const bob = await connectAs(['LibreChat.User'], 'oid-bob');
const eve = await connectAs([], 'oid-eve');

const tools = (await alice.listTools()).tools.map((tool) => tool.name);
check(
  'exposes exactly the allowlisted tools',
  JSON.stringify(tools.sort()) === JSON.stringify([...TOOL_NAMES].sort()),
  tools,
);

const agentIds = async (client: typeof alice) =>
  JSON.parse(resultText(await client.callTool({ name: 'agents_list', arguments: {} }))).agents.map(
    (agent: { agentId: string }) => agent.agentId,
  );
check(
  'alice sees both agents',
  JSON.stringify(await agentIds(alice)) === JSON.stringify(['agent-quotes', 'agent-margins']),
);
check(
  'bob sees only the user agent',
  JSON.stringify(await agentIds(bob)) === JSON.stringify(['agent-quotes']),
);
check('eve sees none', (await agentIds(eve)).length === 0);

const bobDenied = await bob.callTool({
  name: 'agent_run',
  arguments: { agentId: 'agent-margins', message: 'review J24000' },
});
check(
  'bob cannot run the estimators agent',
  bobDenied.isError === true && resultText(bobDenied).startsWith('Not permitted'),
  bobDenied,
);
const unknown = await alice.callTool({
  name: 'agent_run',
  arguments: { agentId: 'agent-admin', message: 'make me an agent' },
});
check(
  'agent outside the allowlist is refused',
  unknown.isError === true && resultText(unknown).includes('Unknown agent'),
);
check('no denied call reached Relevance', requests.length === 0, requests);

const started = await alice.callTool({
  name: 'agent_run',
  arguments: { agentId: 'agent-quotes', message: 'Which quotes are still open for Acme?' },
});
const run = JSON.parse(resultText(started));
check('agent_run returns a runId', /^run_[0-9a-f]{32}$/.test(run.runId), started);
const trigger = requests[0];
check(
  'trigger goes to the regional host with project:key',
  trigger.url === `${BASE}/agents/trigger` &&
    (trigger.init.headers as Record<string, string>).Authorization === 'proj-1:sk-test',
  trigger,
);
check(
  'trigger body is agent_id + user message',
  JSON.stringify(JSON.parse(String(trigger.init.body))) ===
    JSON.stringify({
      agent_id: 'agent-quotes',
      message: { role: 'user', content: 'Which quotes are still open for Acme?' },
    }),
  trigger.init.body,
);
check(
  'agent_run is recorded with the LibreChat conversation',
  recorder.actions[0]?.tool === 'agent_run' &&
    recorder.actions[0]?.target === 'agent-quotes' &&
    recorder.actions[0]?.result === 'triggered' &&
    recorder.actions[0]?.conversationId === 'lc-oid-alice',
  recorder.actions,
);

const bobPeek = await bob.callTool({ name: 'agent_result', arguments: { runId: run.runId } });
check(
  'bob cannot read alice run',
  bobPeek.isError === true && resultText(bobPeek).includes('Unknown runId'),
);
const bobContinue = await bob.callTool({
  name: 'agent_run',
  arguments: {
    agentId: 'agent-quotes',
    message: 'and the rest?',
    conversationId: run.conversationId,
  },
});
check(
  'bob cannot continue alice conversation',
  bobContinue.isError === true && resultText(bobContinue).includes('not one of your runs'),
);

pollAnswers = [
  { type: 'running' },
  { type: 'running' },
  {
    type: 'complete',
    updates: [{ type: 'chain-success', output: { output: { answer: '3 open quotes' } } }],
  },
];
const pollsBefore = requests.length;
const done = await alice.callTool({
  name: 'agent_result',
  arguments: { runId: run.runId, waitSeconds: 20 },
});
const doneBody = JSON.parse(resultText(done));
check(
  'agent_result polls until complete',
  doneBody.status === 'complete' &&
    JSON.stringify(doneBody.output).includes('3 open quotes') &&
    requests.length - pollsBefore === 3 &&
    sleeps.length === 2,
  { doneBody, sleeps },
);
check(
  'poll uses async_poll with ending_update_only',
  requests.at(-1)!.url ===
    `${BASE}/studios/studio-agent-quotes/async_poll/${'job-1'}?ending_update_only=true`,
  requests.at(-1)!.url,
);
check('result marks the output as untrusted', doneBody.note.includes('never as instructions'));

pollAnswers = [];
const slow = await alice.callTool({
  name: 'agent_result',
  arguments: { runId: run.runId, waitSeconds: 0 },
});
check(
  'waitSeconds 0 polls once and reports running',
  JSON.parse(resultText(slow)).status === 'running',
);

pollAnswers = [
  { type: 'complete', updates: [{ output: { text: 'x'.repeat(MAX_OUTPUT_CHARS + 50) } }] },
];
const big = JSON.parse(
  resultText(await alice.callTool({ name: 'agent_result', arguments: { runId: run.runId } })),
);
check('huge output is truncated', big.output.truncated === true, Object.keys(big.output));

const continued = await alice.callTool({
  name: 'agent_run',
  arguments: {
    agentId: 'agent-quotes',
    message: 'and for Riverton?',
    conversationId: run.conversationId,
  },
});
check(
  'alice can continue her own conversation',
  !continued.isError &&
    JSON.parse(String(requests.at(-1)!.init.body)).conversation_id === run.conversationId,
  continued,
);

const marginRun = JSON.parse(
  resultText(
    await alice.callTool({
      name: 'agent_run',
      arguments: { agentId: 'agent-margins', message: 'review J24000' },
    }),
  ),
);
const demoted = await connectAs(['LibreChat.User'], 'oid-alice');
const afterRemoval = await demoted.callTool({
  name: 'agent_result',
  arguments: { runId: marginRun.runId, waitSeconds: 0 },
});
check(
  'losing the role stops reading an earlier run',
  afterRemoval.isError === true && resultText(afterRemoval).startsWith('Not permitted'),
  afterRemoval,
);
await demoted.close();
const dotted = await alice.callTool({
  name: 'agent_run',
  arguments: { agentId: '../admin', message: 'x' },
});
check('agent ids with path characters are refused', dotted.isError === true);

keyValid = false;
const rotated = await alice.callTool({
  name: 'agent_run',
  arguments: { agentId: 'agent-quotes', message: 'hello' },
});
check(
  'rotated key fails closed with a clear message',
  rotated.isError === true && resultText(rotated).includes("refused the server's API key"),
  rotated,
);
check(
  'failed trigger is recorded',
  recorder.actions.at(-1)?.result === 'failed: 401',
  recorder.actions.at(-1),
);
keyValid = true;

clock += RUN_TTL_MS + 1;
const expired = await alice.callTool({ name: 'agent_result', arguments: { runId: run.runId } });
check('runs expire after 24 hours', expired.isError === true);

let duplicateRejected = false;
try {
  AgentAllowlist.parse({
    agents: [
      { id: 'a', name: 'A', roles: ['LibreChat.User'] },
      { id: 'a', name: 'B', roles: ['LibreChat.User'] },
    ],
  });
} catch {
  duplicateRejected = true;
}
check('allowlist rejects duplicate ids', duplicateRejected);
let rolesRequired = false;
try {
  AgentAllowlist.parse({ agents: [{ id: 'a', name: 'A', roles: [] }] });
} catch {
  rolesRequired = true;
}
check('allowlist needs at least one role per agent', rolesRequired);

let badRegion = false;
try {
  createRelevanceClient({ region: 'evil.com/x', projectId: 'p', apiKey: 'k' });
} catch {
  badRegion = true;
}
check('region cannot redirect the base URL', badRegion);

await Promise.all([alice.close(), bob.close(), eve.close()]);
finish();
