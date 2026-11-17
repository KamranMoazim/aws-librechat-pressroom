export class VendorError extends Error {
  constructor(
    readonly vendor: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${vendor} returned ${status}: ${detail}`);
  }
}

export interface VendorRequest {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export type VendorFetch = (path: string, request?: VendorRequest) => Promise<any>;

export function createVendorFetch(
  vendor: string,
  baseUrl: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): VendorFetch {
  return async (path, request = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const query = params.size > 0 ? `?${params}` : '';
    const response = await fetchImpl(`${baseUrl}${path}${query}`, {
      method: request.method ?? 'GET',
      headers: {
        ...headers,
        Accept: 'application/json',
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw new VendorError(vendor, response.status, response.statusText);
    }
    return response.json();
  };
}

export function describeVendorError(error: unknown): string {
  if (error instanceof VendorError) {
    if (error.status === 401 || error.status === 403) {
      return `${error.vendor} refused the server's API key (${error.status}). Ask IT to check the key.`;
    }
    if (error.status === 404) {
      return `${error.vendor} has no such item.`;
    }
    return `${error.vendor} returned an error (${error.status}). Try again later.`;
  }
  throw error;
}
