import { checker, type Spec } from '../context.js';
import type { LibreChatClient } from '../librechat.js';

async function chatOutcome(client: LibreChatClient, text: string): Promise<string> {
  const started = await client.post('/api/agents/chat', {
    endpoint: 'anthropic',
    model: 'claude-sonnet-5-5',
    spec: 'claude-everyday',
    text,
    conversationId: 'new',
    parentMessageId: '00000000-0000-0000-0000-000000000000',
  });
  const streamId = started.body?.streamId ?? started.body?.conversationId;
  if (!streamId) {
    return started.text;
  }
  const stream = await client.get(`/api/agents/chat/stream/${streamId}`);
  return `${started.text}\n${stream.text}`.slice(0, 2000);
}

export const spend: Spec = {
  id: 'spend',
  title: 'Per-person spend',
  async run(ctx) {
    const { expect, manual } = checker(ctx, this.id);
    const alice = await ctx.librechat('alice');
    const balance = await alice.get('/api/balance');
    expect(
      'alice has a balance (limits are on)',
      balance.status === 200 && /\d/.test(balance.text),
      balance.text.slice(0, 200),
    );

    const bob = await ctx.librechat('bob');
    const before = await ctx.server.check('balance', bob.email, '0');
    try {
      const outcome = await chatOutcome(bob, 'Go-live limit check: say hello.');
      expect('with no credit left, bob cannot chat', /token_balance/.test(outcome), outcome);
    } finally {
      await ctx.server.check('balance', bob.email, String(before.previous ?? 20000000));
    }

    const month = new Date().toISOString().slice(0, 7);
    const report = await ctx.server.check('spend', month);
    expect(`spend CSV for ${month} lists users with cost`, Number(report.rows) > 0, report);
    await manual(
      'spend CSV within 5% of the provider consoles',
      `Compare the totals per model (${JSON.stringify(report.totals ?? {})}) with the Anthropic, OpenAI and xAI usage pages for ${month}. Each must be within 5%.`,
    );
  },
};
