import { checker, type Spec } from '../context.js';

export const EXPECTED_SPECS = ['claude-everyday', 'claude-deep', 'gpt-analysis', 'grok-research'];
export const ALLOWED_ENDPOINTS = ['anthropic', 'openAI', 'xAI', 'agents'];

export const approvedProviders: Spec = {
  id: 'approved-providers',
  title: 'Approved providers only',
  async run(ctx) {
    const { expect } = checker(ctx, this.id);
    const bob = await ctx.librechat('bob');

    const config = await bob.get('/api/config');
    const specs = (config.body?.modelSpecs?.list ?? []).map((spec: any) => spec.name);
    expect(
      'only the four approved model specs are offered, and they are enforced',
      JSON.stringify([...specs].sort()) === JSON.stringify([...EXPECTED_SPECS].sort()) &&
        config.body?.modelSpecs?.enforce === true,
      { specs, enforce: config.body?.modelSpecs?.enforce },
    );

    const endpoints = await bob.get('/api/endpoints');
    const configured = Object.entries(endpoints.body ?? {}).filter(
      ([, value]) => value !== null && value !== false,
    );
    const extra = configured
      .map(([name]) => name)
      .filter((name) => !ALLOWED_ENDPOINTS.includes(name));
    expect(
      'no other endpoint is configured',
      extra.length === 0,
      configured.map(([name]) => name),
    );
    const userKeys = configured
      .filter(([, value]: [string, any]) => value?.userProvide === true)
      .map(([name]) => name);
    expect('no endpoint takes a user-provided key', userKeys.length === 0, userKeys);

    const crafted = await bob.post('/api/agents/chat', {
      endpoint: 'google',
      model: 'gemini-3-pro',
      spec: 'claude-everyday',
      text: 'crafted request',
      conversationId: 'new',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
    });
    expect(
      'a crafted request for another provider is refused before any model is called',
      /Model spec mismatch|Invalid model spec/.test(crafted.text),
      { status: crafted.status, body: crafted.text.slice(0, 300) },
    );
    const noSpec = await bob.post('/api/agents/chat', {
      endpoint: 'openAI',
      model: 'gpt-4o-mini',
      text: 'crafted request without a spec',
      conversationId: 'new',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
    });
    expect(
      'a request without a model spec is refused',
      /No model spec selected/.test(noSpec.text),
      { status: noSpec.status, body: noSpec.text.slice(0, 300) },
    );

    const mcpServer = await bob.post('/api/mcp/servers', {
      config: { title: 'mine', type: 'streamable-http', url: 'https://example.com/mcp' },
    });
    expect(
      'a user cannot add an MCP server',
      mcpServer.status === 403 || mcpServer.status === 401,
      { status: mcpServer.status, body: mcpServer.text.slice(0, 200) },
    );

    const egress = await ctx.server.check('egress');
    expect(
      'DNS firewall blocks other AI providers from inside the containers',
      egress.failures === 0 && egress.passes > 0,
      egress,
    );
  },
};
