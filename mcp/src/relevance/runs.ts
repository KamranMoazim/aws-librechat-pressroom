import { randomBytes } from 'node:crypto';

export const RUN_TTL_MS = 24 * 60 * 60 * 1000;

export interface AgentRun {
  runId: string;
  userOid: string;
  agentId: string;
  studioId: string;
  jobId: string;
  conversationId: string;
  expiresAt: number;
}

export class AgentRuns {
  private readonly runs = new Map<string, AgentRun>();

  constructor(private readonly now: () => number = Date.now) {}

  add(run: Omit<AgentRun, 'runId' | 'expiresAt'>): AgentRun {
    this.sweep();
    const stored = {
      ...run,
      runId: `run_${randomBytes(16).toString('hex')}`,
      expiresAt: this.now() + RUN_TTL_MS,
    };
    this.runs.set(stored.runId, stored);
    return stored;
  }

  get(runId: string, userOid: string): AgentRun | undefined {
    const run = this.runs.get(runId);
    if (!run || run.userOid !== userOid || run.expiresAt <= this.now()) {
      return undefined;
    }
    return run;
  }

  ownsConversation(userOid: string, agentId: string, conversationId: string): boolean {
    const now = this.now();
    return [...this.runs.values()].some(
      (run) =>
        run.userOid === userOid &&
        run.agentId === agentId &&
        run.conversationId === conversationId &&
        run.expiresAt > now,
    );
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, run] of this.runs) {
      if (run.expiresAt <= now) {
        this.runs.delete(id);
      }
    }
  }
}
