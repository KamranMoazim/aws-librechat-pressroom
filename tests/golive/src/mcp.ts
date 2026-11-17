import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ToolOutcome {
  ok: boolean;
  text: string;
}

export async function callTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const client = new Client({ name: 'pressroom-golive', version: '0.1.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const result = await client.callTool({ name, arguments: args });
    const text = ((result.content ?? []) as { text?: string }[])
      .map((part) => part.text ?? '')
      .join('');
    return { ok: !result.isError, text };
  } catch (error) {
    return { ok: false, text: (error as Error).message };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function listTools(url: string, token: string): Promise<string[]> {
  const client = new Client({ name: 'pressroom-golive', version: '0.1.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close().catch(() => undefined);
  }
}
