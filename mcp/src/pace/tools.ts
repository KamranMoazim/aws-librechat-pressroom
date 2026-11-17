import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ActionRecorder } from '../shared/audit.js';
import type { Caller } from '../shared/auth.js';
import type { RequestContext } from '../shared/http.js';
import { errorResult, jsonResult, notPermitted } from '../shared/results.js';
import { PaceError, type JobChanges, type PaceClient, type PaceJob } from './client.js';
import type { FieldChange, PendingChanges } from './pending.js';

export const ESTIMATING_ROLE = 'Pace.Estimating';
export const PRODUCTION_ROLE = 'Pace.Production';
export const COST_FIELDS = ['estimatedCost', 'quotedPrice', 'marginPct'] as const;
export const TOOL_NAMES = [
  'job_search',
  'job_get',
  'estimate_get',
  'job_update_prepare',
  'job_update_commit',
] as const;

const JOB_NUMBER = z.string().regex(/^J\d{3,10}$/, 'a Pace job number such as J24017');

export interface PaceDeps {
  caller: Caller;
  context: RequestContext;
  pace: PaceClient;
  pending: PendingChanges;
  recorder: ActionRecorder;
}

function describeError(error: unknown): string {
  if (error instanceof PaceError) {
    if (error.status === 404) {
      return 'That job or estimate was not found in Pace.';
    }
    if (error.status === 412) {
      return 'The job changed in Pace after the change was prepared. Prepare it again.';
    }
    return `Pace returned an error (${error.status}). Try again later.`;
  }
  throw error;
}

export function redactJob(job: PaceJob, caller: Caller): Record<string, unknown> {
  const { version: _version, ...visible } = job;
  if (caller.roles.includes(ESTIMATING_ROLE)) {
    return visible;
  }
  const redacted: Record<string, unknown> = { ...visible };
  for (const field of COST_FIELDS) {
    delete redacted[field];
  }
  return redacted;
}

function canSee(job: { restricted: boolean }, caller: Caller): boolean {
  return !job.restricted || caller.roles.includes(ESTIMATING_ROLE);
}

export function buildPaceServer(deps: PaceDeps): McpServer {
  const server = new McpServer({ name: 'pressroom-pace', version: '0.1.0' });
  const { caller, pace } = deps;

  const guarded = <Args>(
    tool: string,
    role: string | null,
    handler: (args: Args) => Promise<CallToolResult>,
  ) => {
    return async (args: Args): Promise<CallToolResult> => {
      if (role && !caller.roles.includes(role)) {
        return notPermitted('pace', tool, caller, role);
      }
      try {
        return await handler(args);
      } catch (error) {
        return errorResult(describeError(error));
      }
    };
  };

  const readableJob = async (tool: string, jobNumber: string) => {
    const job = await pace.getJob(jobNumber);
    if (!canSee(job, caller)) {
      return { denied: notPermitted('pace', tool, caller, ESTIMATING_ROLE) };
    }
    return { job };
  };

  server.registerTool(
    'job_search',
    {
      title: 'Search Pace jobs',
      description:
        'Search Pace jobs by words in the title or job number, status or customer. Returns job summaries without prices.',
      inputSchema: {
        query: z.string().max(100).optional(),
        status: z.string().max(40).optional(),
        customer: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(25).default(10),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('job_search', null, async ({ query, status, customer, limit }) => {
      const result = await pace.searchJobs({ q: query, status, customer, limit: 50 });
      const jobs = result.jobs
        .filter((job) => canSee(job, caller))
        .slice(0, limit)
        .map(({ jobNumber, customerName, title, status, dueDate, quantity }) => ({
          jobNumber,
          customerName,
          title,
          status,
          dueDate,
          quantity,
        }));
      return jsonResult({ count: jobs.length, jobs });
    }),
  );

  server.registerTool(
    'job_get',
    {
      title: 'Read a Pace job',
      description:
        'Read one Pace job with parts, notes and status. Cost, price and margin are included only for estimators.',
      inputSchema: { jobNumber: JOB_NUMBER },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('job_get', null, async ({ jobNumber }) => {
      const { job, denied } = await readableJob('job_get', jobNumber);
      return denied ?? jsonResult(redactJob(job!, caller));
    }),
  );

  server.registerTool(
    'estimate_get',
    {
      title: 'Read the estimate for a job',
      description:
        'Read the estimate lines, cost, quoted price and margin for a Pace job. Estimators only.',
      inputSchema: { jobNumber: JOB_NUMBER },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('estimate_get', ESTIMATING_ROLE, async ({ jobNumber }) => {
      const job = await pace.getJob(jobNumber);
      return jsonResult(await pace.getEstimate(job.estimateId));
    }),
  );

  server.registerTool(
    'job_update_prepare',
    {
      title: 'Prepare a job update',
      description:
        'Prepare a status, due date or note change on a Pace job. Nothing changes yet: it returns the difference and a change_id, valid for 10 minutes, for job_update_commit.',
      inputSchema: {
        jobNumber: JOB_NUMBER,
        status: z.string().max(40).optional(),
        dueDate: z.iso.date().optional().describe('YYYY-MM-DD'),
        note: z.string().min(1).max(2000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('job_update_prepare', PRODUCTION_ROLE, async ({ jobNumber, status, dueDate, note }) => {
      const { job, denied } = await readableJob('job_update_prepare', jobNumber);
      if (denied) {
        return denied;
      }
      const statuses = await pace.statuses();
      if (status !== undefined && !statuses.includes(status)) {
        return errorResult(`Unknown status "${status}". Use one of: ${statuses.join(', ')}.`);
      }
      const changes: JobChanges = {};
      const diff: FieldChange[] = [];
      if (status !== undefined && status !== job!.status) {
        changes.status = status;
        diff.push({ field: 'status', from: job!.status, to: status });
      }
      if (dueDate !== undefined && dueDate !== job!.dueDate) {
        changes.dueDate = dueDate;
        diff.push({ field: 'dueDate', from: job!.dueDate, to: dueDate });
      }
      if (note !== undefined) {
        changes.note = note;
        diff.push({ field: 'note', from: null, to: note });
      }
      if (diff.length === 0) {
        return errorResult('Nothing to change: the job already has these values.');
      }
      const pending = deps.pending.add({
        userOid: caller.oid,
        jobNumber,
        version: job!.version,
        changes,
        diff,
      });
      return jsonResult({
        changeId: pending.changeId,
        jobNumber,
        title: job!.title,
        diff,
        expiresAt: new Date(pending.expiresAt).toISOString(),
        next: 'Show this difference to the person. If they agree, call job_update_commit with the changeId.',
      });
    }),
  );

  server.registerTool(
    'job_update_commit',
    {
      title: 'Commit a prepared job update',
      description:
        'Apply a change prepared by job_update_prepare. Works once, only for the person who prepared it, within 10 minutes.',
      inputSchema: { changeId: z.string().regex(/^chg_[0-9a-f]{32}$/) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded('job_update_commit', PRODUCTION_ROLE, async ({ changeId }) => {
      const taken = deps.pending.take(changeId, caller.oid);
      if (!taken.ok) {
        const reasons = {
          unknown: 'Unknown change_id. Prepare the change again.',
          'other-user': 'This change was prepared by someone else and cannot be committed by you.',
          expired: 'This change expired (10 minutes). Prepare it again.',
        };
        return errorResult(reasons[taken.reason]);
      }
      const { change } = taken;
      const base = {
        userOid: caller.oid,
        upn: caller.upn,
        tool: 'job_update_commit',
        target: change.jobNumber,
        args: { changeId, jobNumber: change.jobNumber, changes: change.changes },
        before: Object.fromEntries(change.diff.map((entry) => [entry.field, entry.from])),
        conversationId: deps.context.conversationId,
      };
      const summary = change.diff.map((entry) => `${entry.field} -> ${entry.to}`).join('; ');
      let updated: PaceJob;
      try {
        updated = await pace.updateJob(change.jobNumber, change.version, {
          ...change.changes,
          author: caller.upn || caller.oid,
        });
      } catch (error) {
        const code = error instanceof PaceError ? String(error.status) : 'error';
        await deps.recorder.record({ ...base, summary, result: `failed: ${code}` });
        throw error;
      }
      const after = {
        status: updated.status,
        dueDate: updated.dueDate,
        note: change.changes.note ? (updated.notes.at(-1)?.text ?? null) : null,
      };
      await deps.recorder.record({
        ...base,
        summary,
        after: Object.fromEntries(change.diff.map((entry) => [entry.field, after[entry.field]])),
        result: 'committed',
      });
      return jsonResult({
        jobNumber: updated.jobNumber,
        status: updated.status,
        dueDate: updated.dueDate,
        applied: change.diff,
      });
    }),
  );

  return server;
}
