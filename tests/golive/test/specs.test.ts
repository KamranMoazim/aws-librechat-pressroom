import { randomUUID } from 'node:crypto';
import type { Server } from '../src/aws.js';
import type { Config, Persona } from '../src/config.js';
import type { Context, Spec } from '../src/context.js';
import { applySetCookies, cookieHeaderFor, LibreChatClient } from '../src/librechat.js';
import type { Operator } from '../src/operator.js';
import { Report } from '../src/report.js';
import { runSpecs } from '../src/run.js';
import { approvedProviders } from '../src/specs/approved-providers.js';
import { chatIsolation } from '../src/specs/chat-isolation.js';
import { deletion } from '../src/specs/deletion.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: unknown): void {
  if (ok) {
    passed++;
  } else {
    failed++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(extra)}`);
}

type Weakness =
  | 'convo'
  | 'messages'
  | 'download'
  | 'share'
  | 'agent'
  | 'agentFiles'
  | 'specs'
  | 'endpoint'
  | 'chat'
  | 'mcp'
  | 'meili'
  | 'vectors'
  | 'ttl'
  | 'ttlSearch';

const BASE = 'https://chat.pressroom.example.test';

function fakeLibreChat(weak: Set<Weakness>) {
  const convos = new Map<
    string,
    { owner: string; title: string; prompt: string; meili: boolean }
  >();
  const files = new Map<
    string,
    { owner: string; name: string; content: string; vectors: number }
  >();
  const agents = new Map<string, { owner: string; name: string; tool_resources: any }>();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/api/auth/refresh') {
      const user = /user=(\w+)/.exec(request.headers.get('cookie') ?? '')?.[1];
      if (!user) {
        return new Response('Refresh token not provided', { status: 200 });
      }
      return new Response(
        JSON.stringify({ token: user, user: { id: `u-${user}`, email: `${user}@x.test` } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': `user=${user}; Path=/` },
        },
      );
    }
    const me = /^Bearer (\w+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!me) {
      return json({ message: 'Unauthorized' }, 401);
    }
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request;
    let match: RegExpExecArray | null;

    if ((match = /^\/api\/convos\/([\w-]+)$/.exec(path)) && request.method === 'GET') {
      const convo = convos.get(match[1]);
      return convo && (convo.owner === me || weak.has('convo'))
        ? json({ conversationId: match[1], title: convo.title, user: `u-${convo.owner}` })
        : json({ message: 'not found' }, 404);
    }
    if (path === '/api/convos' && request.method === 'DELETE') {
      const { arg } = (await body!.json()) as any;
      const convo = convos.get(arg.conversationId);
      if (convo?.owner === me) {
        if (weak.has('meili')) {
          convo.owner = '(deleted)';
        } else {
          convos.delete(arg.conversationId);
        }
      }
      return json({ deletedCount: 1 });
    }
    if ((match = /^\/api\/messages\/([\w-]+)$/.exec(path))) {
      const convo = convos.get(match[1]);
      return convo && (convo.owner === me || weak.has('messages'))
        ? json([
            { isCreatedByUser: true, text: convo.prompt },
            { isCreatedByUser: false, text: '', content: [{ type: 'text', text: 'ready' }] },
          ])
        : json([]);
    }
    if ((match = /^\/api\/files\/download\/([\w-]+)\/([\w-]+)$/.exec(path))) {
      const file = files.get(match[2]);
      return file && (file.owner === me || weak.has('download'))
        ? new Response(file.content)
        : json({ message: 'Forbidden' }, 403);
    }
    if ((match = /^\/api\/files\/([\w-]+)\/preview$/.exec(path))) {
      const file = files.get(match[1]);
      return file && file.owner === me
        ? new Response(file.content)
        : json({ message: 'not found' }, 404);
    }
    if (path === '/api/files' && request.method === 'GET') {
      return json(
        [...files.entries()]
          .filter(([, file]) => file.owner === me)
          .map(([file_id, file]) => ({ file_id, filename: file.name })),
      );
    }
    if (path === '/api/files' && request.method === 'POST') {
      const form = await body!.formData();
      const upload = form.get('file') as File;
      const fileId = String(form.get('file_id'));
      if (!form.get('agent_id')) {
        return json({ message: 'No agent ID provided for agent file upload' }, 500);
      }
      files.set(fileId, { owner: me, name: upload.name, content: await upload.text(), vectors: 3 });
      return json({
        file_id: fileId,
        filename: upload.name,
        filepath: `/uploads/u-${me}/${fileId}__${upload.name}`,
        source: 'local',
      });
    }
    if (path === '/api/files' && request.method === 'DELETE') {
      const list = (((await body!.json()) as any).files ?? []).filter(
        (entry: any) => entry.filepath,
      );
      if (list.length === 0) {
        return json({ message: 'Nothing provided to delete' }, 204);
      }
      for (const entry of list) {
        const file = files.get(entry.file_id);
        if (file?.owner === me) {
          if (weak.has('vectors')) {
            file.owner = '(deleted)';
          } else {
            files.delete(entry.file_id);
          }
        }
      }
      return json({ message: 'deleted' });
    }
    if ((match = /^\/api\/share\/link\/([\w-]+)$/.exec(path))) {
      const convo = convos.get(match[1]);
      return convo?.owner === me
        ? json({ success: true, shareId: 's-1', conversationId: match[1] })
        : json({ success: false, shareId: null, conversationId: match[1] });
    }
    if ((match = /^\/api\/share\/([\w-]+)$/.exec(path)) && request.method === 'POST') {
      const convo = convos.get(match[1]);
      return convo && (convo.owner === me || weak.has('share'))
        ? json({ shareId: 's-2', conversationId: match[1], title: convo.title })
        : json({ message: 'not found' }, 404);
    }
    if (path === '/api/agents/chat') {
      const payload = (await body!.json()) as any;
      if (weak.has('chat')) {
        return json({ text: 'Sure, here is an answer from another provider.' });
      }
      if (!payload.spec) {
        return json({ text: 'No model spec selected' }, 400);
      }
      return json(
        { text: payload.endpoint === 'google' ? 'Model spec mismatch' : 'ok' },
        payload.endpoint === 'google' ? 400 : 200,
      );
    }
    if (path === '/api/agents' && request.method === 'POST') {
      const payload = (await body!.json()) as any;
      const id = `agent_${randomUUID().slice(0, 8)}`;
      const fileIds: string[] = payload.tool_resources?.file_search?.file_ids ?? [];
      const allowed = fileIds.filter(
        (fileId) => files.get(fileId)?.owner === me || weak.has('agentFiles'),
      );
      agents.set(id, {
        owner: me,
        name: payload.name,
        tool_resources: { file_search: { file_ids: allowed } },
      });
      return json({ id, name: payload.name }, 201);
    }
    if ((match = /^\/api\/agents\/([\w-]+)\/expanded$/.exec(path))) {
      const agent = agents.get(match[1]);
      return agent?.owner === me
        ? json({ id: match[1], ...agent })
        : json({ message: 'Forbidden' }, 403);
    }
    if ((match = /^\/api\/agents\/([\w-]+)$/.exec(path))) {
      const agent = agents.get(match[1]);
      if (request.method === 'DELETE') {
        agents.delete(match[1]);
        return json({});
      }
      return agent && (agent.owner === me || weak.has('agent'))
        ? json({ id: match[1], name: agent.name })
        : json({ message: 'Forbidden' }, 403);
    }
    if (path === '/api/config') {
      const list = ['claude-everyday', 'claude-deep', 'gpt-analysis', 'grok-research'].map(
        (name) => ({ name }),
      );
      if (weak.has('specs')) {
        list.push({ name: 'gemini-anything' });
      }
      return json({ modelSpecs: { enforce: true, list } });
    }
    if (path === '/api/endpoints') {
      return json({
        anthropic: {},
        openAI: {},
        xAI: {},
        agents: {},
        ...(weak.has('endpoint') ? { google: { userProvide: true } } : {}),
      });
    }
    if (path === '/api/mcp/servers') {
      return weak.has('mcp')
        ? json({ serverName: 'mine' }, 201)
        : json({ message: 'Forbidden' }, 403);
    }
    return json({ message: `no fake route for ${request.method} ${path}` }, 501);
  }) as typeof fetch;

  const server: Server = {
    async check(name, ...args) {
      if (name === 'egress') {
        return { passes: 42, failures: 0 };
      }
      if (name === 'convo') {
        const convo = convos.get(args[0]);
        const inMongo = convo && convo.owner !== '(deleted)' && convo.owner !== '(expired)';
        return {
          convos: inMongo ? 1 : 0,
          messages: inMongo ? 2 : 0,
          messageIds: inMongo ? ['m-1', 'm-2'] : [],
          meiliConvo: Boolean(convo),
          meiliMessages: convo ? 2 : 0,
        };
      }
      if (name === 'file') {
        const file = files.get(args[0]);
        return {
          files: file && file.owner !== '(deleted)' ? 1 : 0,
          vectors: file ? file.vectors : 0,
        };
      }
      if (name === 'expire') {
        const convo = convos.get(args[0]);
        if (convo && !weak.has('ttl')) {
          if (weak.has('ttlSearch')) {
            convo.owner = '(expired)';
          } else {
            convos.delete(args[0]);
          }
        }
        return { updated: 1, messages: 2 };
      }
      throw new Error(`no fake check ${name}`);
    },
    async forward() {
      throw new Error('not used');
    },
  };

  const chat = async (persona: Persona, text: string) => {
    const id = randomUUID();
    convos.set(id, {
      owner: persona,
      title: 'Proof timing for a customer',
      prompt: text,
      meili: true,
    });
    return id;
  };
  return { fetchImpl, server, chat };
}

const config = { chatUrl: BASE } as Config;
const operator: Operator = { interactive: false, confirm: async () => false, ask: async () => '' };

async function runAgainst(spec: Spec, weak: Weakness[]): Promise<Report> {
  const fake = fakeLibreChat(new Set(weak));
  const report = new Report(() => new Date('2026-11-17T12:00:00Z'));
  const ctx: Context = {
    config,
    report,
    operator,
    server: fake.server,
    librechat: async (persona) =>
      (await LibreChatClient.signIn(BASE, `user=${persona}`, fake.fetchImpl)).client,
    token: async () => 'unused',
    browser: async () => {
      throw new Error('no browser in unit tests');
    },
    fetch: fake.fetchImpl,
    chat: fake.chat,
    sleep: async () => undefined,
  };
  const log = console.log;
  console.log = () => undefined;
  try {
    await runSpecs(ctx, [spec]);
  } finally {
    console.log = log;
  }
  return report;
}

const failures = (report: Report) =>
  report.results.filter((result) => result.status === 'fail').map((result) => result.check);

for (const spec of [chatIsolation, approvedProviders, deletion]) {
  const clean = await runAgainst(spec, []);
  check(
    `${spec.id}: all checks pass against a correct server`,
    failures(clean).length === 0 && clean.results.length > 3,
    failures(clean),
  );
}

const cases: [Spec, Weakness, RegExp][] = [
  [chatIsolation, 'convo', /GET \/api\/convos\/:id/],
  [chatIsolation, 'messages', /GET \/api\/messages/],
  [chatIsolation, 'download', /files\/download/],
  [chatIsolation, 'share', /POST \/api\/share/],
  [chatIsolation, 'agent', /GET \/api\/agents\/:id/],
  [chatIsolation, 'agentFiles', /attached to bob's agent/],
  [approvedProviders, 'specs', /four approved model specs/],
  [approvedProviders, 'endpoint', /no other endpoint|user-provided key/],
  [approvedProviders, 'chat', /crafted request|without a model spec/],
  [approvedProviders, 'mcp', /MCP server/],
  [deletion, 'meili', /Meilisearch/],
  [deletion, 'vectors', /pgvector/],
  [deletion, 'ttl', /TTL|search index/],
  [deletion, 'ttlSearch', /search index/],
];
for (const [spec, weakness, expected] of cases) {
  const report = await runAgainst(spec, [weakness]);
  const failed = failures(report);
  check(
    `${spec.id}: a server weak on "${weakness}" fails exactly that check`,
    failed.length >= 1 && failed.every((name) => expected.test(name)),
    failed,
  );
}

const echo = await runAgainst(chatIsolation, []);
check(
  'share link lookup that only echoes the id back is not counted as a leak',
  echo.results.some(
    (result) => result.check.includes('GET /api/share/link') && result.status === 'pass',
  ),
);

const cookies = [
  { name: 'refreshToken', value: 'old', domain: 'chat.pressroom.example.test', path: '/' },
  { name: 'ESTSAUTH', value: 'ms', domain: '.login.microsoftonline.com', path: '/' },
];
check(
  'cookie header only carries the chat host cookies',
  cookieHeaderFor(cookies, 'chat.pressroom.example.test') === 'refreshToken=old',
);
applySetCookies(cookies, 'chat.pressroom.example.test', [
  'refreshToken=new; Path=/; HttpOnly',
  'token_provider=openid; Path=/',
]);
check(
  'rotated session cookies are written back',
  cookieHeaderFor(cookies, 'chat.pressroom.example.test') ===
    'refreshToken=new; token_provider=openid',
);
const signedOut = await LibreChatClient.signIn(BASE, '', fakeLibreChat(new Set()).fetchImpl).then(
  () => 'signed in',
  (error: Error) => error.constructor.name,
);
check(
  'a refresh without a session is "signed out", not a pass',
  signedOut === 'SignedOutError',
  signedOut,
);

const report = new Report(() => new Date('2026-11-17T12:00:00Z'));
report.record('spend', 'with no balance left, bob cannot chat', 'pass', 'Insufficient balance');
report.record('spend', 'spend CSV | within 5%', 'manual', 'compare with consoles');
const markdown = report.toMarkdown('PressRoom go-live test report', { spend: 'Per-person spend' });
check(
  'report lists every check with its result and evidence',
  markdown.includes('1 passed, 0 failed, 1 manual, 0 skipped') &&
    markdown.includes('| Per-person spend | spend CSV / within 5% | MANUAL |') &&
    markdown.includes('Insufficient balance'),
  markdown,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
