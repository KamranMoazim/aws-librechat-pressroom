import {
  checker,
  createAgent,
  deleteFile,
  marker,
  uploadFile,
  type Spec,
  type Uploaded,
} from '../context.js';
import { denied, type HttpResult } from '../librechat.js';

export const chatIsolation: Spec = {
  id: 'chat-isolation',
  title: 'Chat isolation',
  async run(ctx) {
    const { expect, skip } = checker(ctx, this.id);
    const alice = await ctx.librechat('alice');
    const bob = await ctx.librechat('bob');
    const chatMarker = marker('isolation');
    const fileMarker = marker('file');
    const agentName = marker('isolation-agent');
    let conversationId = '';
    let agentId = '';
    let upload: Uploaded | undefined;
    const bobAgents: string[] = [];
    const shares: { client: typeof bob; shareId: string }[] = [];

    try {
      conversationId = await ctx.chat('alice', `${chatMarker}: reply with the word ready.`);
      const agent = await createAgent(alice, agentName);
      agentId = agent.id;
      expect(
        'alice creates a private agent (setup)',
        agent.status < 300 && agentId !== '',
        agent.text.slice(0, 300),
      );
      upload = await uploadFile(
        alice,
        agentId,
        `${fileMarker}.txt`,
        `isolation check ${fileMarker}`,
      );
      expect('alice uploads a file to her agent (setup)', upload.ok, upload.text);

      const controls = {
        convo: await alice.get(`/api/convos/${conversationId}`),
        messages: await alice.get(`/api/messages/${conversationId}`),
        agent: await alice.get(`/api/agents/${agentId}`),
      };
      expect(
        'alice can read her own chat, messages and agent (control)',
        controls.convo.status === 200 &&
          !denied(controls.messages) &&
          controls.agent.status === 200,
        {
          convo: controls.convo.status,
          messages: controls.messages.status,
          agent: controls.agent.status,
        },
      );

      const leaks = (result: HttpResult) =>
        [chatMarker, fileMarker, agentName, 'isolation check', alice.userId].some(
          (value) => value && result.text.includes(value),
        ) ||
        Boolean(result.body?.shareId) ||
        (result.status === 200 &&
          result.body?.conversationId === conversationId &&
          Boolean(result.body?.user));
      const refused = (route: string, result: HttpResult) => {
        if (result.body?.shareId) {
          shares.push({ client: bob, shareId: String(result.body.shareId) });
        }
        expect(
          `bob with alice's ids: ${route} is refused`,
          result.status >= 400 || !leaks(result),
          {
            status: result.status,
            body: result.text.slice(0, 300),
          },
        );
      };

      refused('GET /api/convos/:id', await bob.get(`/api/convos/${conversationId}`));
      refused(
        'GET /api/messages/:conversationId',
        await bob.get(`/api/messages/${conversationId}`),
      );
      refused(
        'POST /api/share/:conversationId',
        await bob.post(`/api/share/${conversationId}`, {}),
      );
      refused(
        'GET /api/share/link/:conversationId',
        await bob.get(`/api/share/link/${conversationId}`),
      );
      refused('GET /api/agents/:id', await bob.get(`/api/agents/${agentId}`));

      if (!upload.ok) {
        skip(
          "alice's file is refused to bob",
          'the setup upload failed, so there is no file to test with',
        );
        return;
      }
      refused(
        'GET /api/files/download/:userId/:fileId',
        await bob.get(`/api/files/download/${alice.userId}/${upload.fileId}`),
      );
      refused(
        'GET /api/files/:fileId/preview',
        await bob.get(`/api/files/${upload.fileId}/preview`),
      );
      const bobFiles = await bob.get('/api/files');
      expect(
        "alice's file is not in bob's file list",
        bobFiles.status === 200 && !bobFiles.text.includes(upload.fileId),
        bobFiles.status,
      );

      const bobAgent = await createAgent(bob, marker('borrow-agent'), {
        tools: ['file_search'],
        tool_resources: { file_search: { file_ids: [upload.fileId] } },
      });
      if (bobAgent.id) {
        bobAgents.push(bobAgent.id);
      }
      const expanded = bobAgent.id
        ? await bob.get(`/api/agents/${bobAgent.id}/expanded`)
        : bobAgent;
      expect(
        "alice's file cannot be attached to bob's agent",
        bobAgent.status >= 400 ||
          (expanded.status === 200 &&
            !bobAgent.text.includes(upload.fileId) &&
            !expanded.text.includes(upload.fileId)),
        { create: bobAgent.status, expanded: expanded.status, agent: expanded.text.slice(0, 400) },
      );
    } finally {
      for (const share of shares) {
        await share.client.request('DELETE', `/api/share/${share.shareId}`).catch(() => undefined);
      }
      for (const id of bobAgents) {
        await bob.request('DELETE', `/api/agents/${id}`).catch(() => undefined);
      }
      if (upload?.ok) {
        await deleteFile(alice, upload).catch(() => undefined);
      }
      if (agentId) {
        await alice.request('DELETE', `/api/agents/${agentId}`).catch(() => undefined);
      }
      if (conversationId) {
        await alice
          .request('DELETE', '/api/convos', { arg: { conversationId } })
          .catch(() => undefined);
      }
    }
  },
};
