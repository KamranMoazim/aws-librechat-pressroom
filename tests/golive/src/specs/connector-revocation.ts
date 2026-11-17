import { checker, type Spec } from '../context.js';
import { callTool } from '../mcp.js';
import { claimsOf, mcpScopes } from '../tokens.js';

export const connectorRevocation: Spec = {
  id: 'connector-revocation',
  title: 'Connector revocation',
  async run(ctx) {
    const { expect, manual, skip } = checker(ctx, this.id);
    const outlook = await ctx.server.forward('mcp-outlook', 8101, 18101);
    try {
      const token = await ctx.token('dave', mcpScopes(ctx.config));
      const control = await callTool(outlook.url, token, 'mail_search', { query: 'invoice' });
      expect(
        'dave (Outlook.Assistant) can search his mail (control)',
        control.ok,
        control.text.slice(0, 200),
      );
      if (
        await ctx.operator.confirm(
          'In Entra, remove the Outlook.Assistant role from dave on PressRoom-MCP.',
        )
      ) {
        const started = Date.now();
        let minutes = -1;
        let last = '';
        for (let attempt = 0; attempt < 90; attempt++) {
          const fresh = await ctx.token('dave', mcpScopes(ctx.config));
          const result = await callTool(outlook.url, fresh, 'mail_search', { query: 'invoice' });
          last = `${JSON.stringify(claimsOf(fresh).roles ?? [])} ${result.text.slice(0, 120)}`;
          if (!result.ok && result.text.startsWith('Not permitted')) {
            minutes = Math.round((Date.now() - started) / 6000) / 10;
            break;
          }
          await ctx.sleep(20000);
        }
        expect(
          'after the role is removed, a new token is refused by the Outlook connector',
          minutes >= 0,
          minutes >= 0 ? `refused after ${minutes} min (new token)` : `still allowed: ${last}`,
        );
        await manual(
          "LibreChat path: dave's next Outlook tool call says not permitted",
          'In the chat as dave, ask to search mail. LibreChat may reuse its on-behalf-of token for up to an hour; record the time it takes.',
        );
        await manual(
          'Give dave the Outlook.Assistant role back',
          'Re-assign Outlook.Assistant to dave on PressRoom-MCP; the next run needs it.',
        );
      } else {
        skip('role removal revokes the Outlook connector', 'operator did not remove the role');
      }
    } finally {
      outlook.close();
    }

    if (
      await ctx.operator.confirm(
        'Remove the voice server from librechat.template.yaml, push, render-env and restart api.',
      )
    ) {
      const tools = await (await ctx.librechat('alice')).get('/api/mcp/tools');
      expect(
        'a server removed from the yaml has no tools in LibreChat',
        tools.status === 200 && !tools.text.includes('voice_agents_list'),
        tools.text.slice(0, 400),
      );
      await manual(
        'Put the voice server back',
        'Revert the yaml change, push, render-env, restart api.',
      );
    } else {
      skip('removing a server from the yaml removes its tools', 'operator did not remove it');
    }

    if (!ctx.config.relevanceTestAgent) {
      skip('a rotated Relevance key makes the gateway fail closed', 'set RELEVANCE_TEST_AGENT');
      return;
    }
    if (
      await ctx.operator.confirm(
        'Revoke the Relevance API key at Relevance (keep the old value in SSM), then restart mcp-relevance.',
      )
    ) {
      const relevance = await ctx.server.forward('mcp-relevance', 8103, 18103);
      try {
        const result = await callTool(
          relevance.url,
          await ctx.token('alice', mcpScopes(ctx.config)),
          'agent_run',
          {
            agentId: ctx.config.relevanceTestAgent,
            message: 'Key rotation check: this must not run.',
          },
        );
        expect(
          'with a revoked key the Relevance gateway fails closed',
          !result.ok && result.text.includes("refused the server's API key"),
          result.text,
        );
      } finally {
        relevance.close();
      }
      await manual(
        'Install the new Relevance key',
        'ROTATE_PROVIDER_KEYS=1 npm run secrets, then render-env and restart mcp-relevance.',
      );
    } else {
      skip(
        'a rotated Relevance key makes the gateway fail closed',
        'operator did not revoke the key',
      );
    }
  },
};
