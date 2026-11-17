import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express } from 'express';
import { AuthError, type Caller, type Verifier } from './auth.js';
import { log } from './log.js';

export interface RequestContext {
  conversationId?: string;
}

export interface McpAppOptions {
  name: string;
  verify: Verifier;
  buildServer: (caller: Caller, context: RequestContext) => McpServer;
}

export function createMcpApp(options: McpAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: options.name });
  });

  app.post('/mcp', async (req, res) => {
    let caller: Caller;
    try {
      caller = await options.verify(req.headers.authorization);
    } catch (error) {
      const reason = error instanceof AuthError ? error.message : 'token check failed';
      log.warn('rejected request', { server: options.name, reason });
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
      return;
    }
    const conversationId = req.header('x-conversation-id') || undefined;
    const server = options.buildServer(caller, { conversationId });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log.error('request failed', { server: options.name, error: (error as Error).message });
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal error' });
      }
    }
  });

  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ error: 'method not allowed' });
  });

  return app;
}
