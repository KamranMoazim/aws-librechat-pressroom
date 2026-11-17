export interface GraphRequest {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
}

export type GraphFetch = (path: string, request?: GraphRequest) => Promise<any>;

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Microsoft Graph returned ${status} ${code}`);
  }
}

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

export function createGraphFetch(
  getToken: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): GraphFetch {
  return async (path, request = {}) => {
    const response = await fetchImpl(`${GRAPH_BASE_URL}${path}`, {
      method: request.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        Accept: 'application/json',
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...request.headers,
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (!response.ok) {
      let code = 'unknown';
      try {
        code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? code;
      } catch {
        // Graph sometimes answers errors without a JSON body.
      }
      throw new GraphError(response.status, code);
    }
    return response.status === 204 ? undefined : response.json();
  };
}
