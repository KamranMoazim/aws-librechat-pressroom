import {
  checker,
  createAgent,
  deleteFile,
  marker,
  uploadFile,
  type Context,
  type Spec,
} from '../context.js';

async function poll<T>(
  ctx: Context,
  attempts: number,
  delayMs: number,
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  let value = await read();
  for (let attempt = 1; attempt < attempts && !done(value); attempt++) {
    await ctx.sleep(delayMs);
    value = await read();
  }
  return value;
}

const goneFromMongo = (state: any) => state.convos === 0 && state.messages === 0;
const gone = (state: any) =>
  goneFromMongo(state) && state.meiliConvo === false && state.meiliMessages === 0;

export const deletion: Spec = {
  id: 'deletion',
  title: 'Deletion and retention',
  async run(ctx: Context) {
    const { expect, skip } = checker(ctx, this.id);
    const alice = await ctx.librechat('alice');
    const cleanup: (() => Promise<unknown>)[] = [];

    try {
      const conversationId = await ctx.chat(
        'alice',
        `${marker('deletion')}: reply with the word ready.`,
      );
      cleanup.push(() => alice.request('DELETE', '/api/convos', { arg: { conversationId } }));
      const stored = await poll(
        ctx,
        15,
        2000,
        () => ctx.server.check('convo', conversationId),
        (state) => state.meiliConvo === true,
      );
      expect(
        'setup: chat is in Mongo and the search index',
        stored.convos === 1 && stored.messages >= 2 && stored.meiliConvo === true,
        stored,
      );

      const deleted = await alice.request('DELETE', '/api/convos', { arg: { conversationId } });
      const after = await poll(
        ctx,
        15,
        2000,
        () => ctx.server.check('convo', conversationId, ...stored.messageIds),
        gone,
      );
      expect(
        'deleting a chat removes it from Mongo (conversation and messages) and Meilisearch',
        deleted.status < 300 && gone(after),
        { delete: deleted.status, after },
      );

      const agent = await createAgent(alice, marker('deletion-agent'));
      if (agent.id) {
        cleanup.push(() => alice.request('DELETE', `/api/agents/${agent.id}`));
      }
      const upload = await uploadFile(
        alice,
        agent.id,
        `${marker('deletion')}.txt`,
        `deletion check ${marker('vector')}`,
      );
      if (!upload.ok) {
        expect('setup: file upload', false, upload.text);
        skip('deleting a file removes it and its pgvector embeddings', 'the setup upload failed');
      } else {
        cleanup.push(() => deleteFile(alice, upload));
        const vectors = await poll(
          ctx,
          15,
          2000,
          () => ctx.server.check('file', upload.fileId),
          (state) => state.vectors > 0,
        );
        expect(
          'setup: uploaded file has embeddings in pgvector',
          vectors.files === 1 && vectors.vectors > 0,
          vectors,
        );
        const fileDeleted = await deleteFile(alice, upload);
        const fileAfter = await poll(
          ctx,
          15,
          2000,
          () => ctx.server.check('file', upload.fileId),
          (state) => state.files === 0 && state.vectors === 0,
        );
        expect(
          'deleting a file removes it and its pgvector embeddings',
          fileDeleted.status < 300 && fileAfter.files === 0 && fileAfter.vectors === 0,
          { delete: fileDeleted.status, fileAfter },
        );
      }

      const aged = await ctx.chat('alice', `${marker('retention')}: reply with the word ready.`);
      cleanup.push(() => alice.request('DELETE', '/api/convos', { arg: { conversationId: aged } }));
      const agedStored = await poll(
        ctx,
        15,
        2000,
        () => ctx.server.check('convo', aged),
        (state) => state.meiliConvo === true,
      );
      const expired = await ctx.server.check('expire', aged);
      const afterTtl = await poll(
        ctx,
        30,
        10000,
        () => ctx.server.check('convo', aged, ...agedStored.messageIds),
        goneFromMongo,
      );
      expect(
        'a chat past its retention date is removed from Mongo by the TTL (within 5 minutes)',
        expired.updated >= 1 && goneFromMongo(afterTtl),
        { expired, afterTtl },
      );
      const searchAfterTtl = await poll(
        ctx,
        30,
        10000,
        () => ctx.server.check('convo', aged, ...agedStored.messageIds),
        gone,
      );
      expect(
        'the expired chat is also gone from the search index (within 5 more minutes)',
        gone(searchAfterTtl),
        searchAfterTtl,
      );
    } finally {
      for (const step of cleanup.reverse()) {
        await step().catch(() => undefined);
      }
    }
  },
};
