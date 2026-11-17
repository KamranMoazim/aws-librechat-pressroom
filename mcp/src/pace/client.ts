export interface PaceJob {
  jobNumber: string;
  customerId: string;
  customerName: string;
  title: string;
  status: string;
  dueDate: string;
  quantity: number;
  parts: unknown[];
  notes: { at: string; author: string; text: string }[];
  estimateId: string;
  estimatedCost?: number;
  quotedPrice?: number;
  marginPct?: number;
  restricted: boolean;
  version: number;
}

export interface JobChanges {
  status?: string;
  dueDate?: string;
  note?: string;
}

export interface PaceClient {
  searchJobs(params: { q?: string; status?: string; customer?: string; limit: number }): Promise<{
    count: number;
    jobs: Pick<
      PaceJob,
      'jobNumber' | 'customerName' | 'title' | 'status' | 'dueDate' | 'quantity' | 'restricted'
    >[];
  }>;
  getJob(jobNumber: string): Promise<PaceJob>;
  getEstimate(estimateId: string): Promise<Record<string, unknown>>;
  statuses(): Promise<string[]>;
  updateJob(
    jobNumber: string,
    version: number,
    changes: JobChanges & { author: string },
  ): Promise<PaceJob>;
}

export class PaceError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Pace returned ${status}: ${detail}`);
  }
}

export function createPaceClient(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): PaceClient {
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
        ...(init.headers as Record<string, string>),
      },
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        detail = String(((await response.json()) as { detail?: unknown }).detail ?? detail);
      } catch {
        // Keep the status text when the body is not JSON.
      }
      throw new PaceError(response.status, detail);
    }
    return response.json();
  };
  return {
    searchJobs: ({ q, status, customer, limit }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (q) {
        params.set('q', q);
      }
      if (status) {
        params.set('status', status);
      }
      if (customer) {
        params.set('customer', customer);
      }
      return call(`/jobs?${params}`);
    },
    getJob: (jobNumber) => call(`/jobs/${encodeURIComponent(jobNumber)}`),
    getEstimate: (estimateId) => call(`/estimates/${encodeURIComponent(estimateId)}`),
    statuses: async () => ((await call('/statuses')) as { statuses: string[] }).statuses,
    updateJob: (jobNumber, version, changes) =>
      call(`/jobs/${encodeURIComponent(jobNumber)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(version) },
        body: JSON.stringify(changes),
      }),
  };
}
