import { fileURLToPath } from 'node:url';
import type { PaceClient, PaceJob } from '../src/pace/client.js';
import { PaceError } from '../src/pace/client.js';
import { CHANGE_TTL_MS, PendingChanges } from '../src/pace/pending.js';
import { buildPaceServer, TOOL_NAMES } from '../src/pace/tools.js';
import { caller, check, connect, finish, memoryRecorder, resultText } from './helpers.js';
import { loadMatrix, runCase } from './matrix.js';

const STATUSES = [
  'quoted',
  'approved',
  'prepress',
  'proofing',
  'printing',
  'finishing',
  'shipped',
  'closed',
];

function job(jobNumber: string, restricted = false): PaceJob {
  return {
    jobNumber,
    customerId: 'C100',
    customerName: restricted ? 'City of Riverton' : 'Acme Outdoor',
    title: `Vinyl banner for ${restricted ? 'City of Riverton' : 'Acme Outdoor'}`,
    status: 'proofing',
    dueDate: '2026-11-20',
    quantity: 10,
    parts: [],
    notes: [],
    estimateId: `E${jobNumber.slice(1)}`,
    estimatedCost: 1000,
    quotedPrice: 1500,
    marginPct: 33.3,
    restricted,
    version: 1,
  };
}

function fakePace() {
  const jobs: Record<string, PaceJob> = { J24000: job('J24000'), J24005: job('J24005', true) };
  const updates: { jobNumber: string; version: number; changes: unknown }[] = [];
  const client: PaceClient = {
    async searchJobs() {
      const all = Object.values(jobs).map(
        ({ jobNumber, customerName, title, status, dueDate, quantity, restricted }) => ({
          jobNumber,
          customerName,
          title,
          status,
          dueDate,
          quantity,
          restricted,
        }),
      );
      return { count: all.length, jobs: all };
    },
    async getJob(jobNumber) {
      const found = jobs[jobNumber];
      if (!found) {
        throw new PaceError(404, 'job not found');
      }
      return structuredClone(found);
    },
    async getEstimate(estimateId) {
      return { id: estimateId, estimatedCost: 1000, quotedPrice: 1500, marginPct: 33.3 };
    },
    async statuses() {
      return STATUSES;
    },
    async updateJob(jobNumber, version, changes) {
      const current = jobs[jobNumber];
      if (current.version !== version) {
        throw new PaceError(412, 'job changed since it was read');
      }
      updates.push({ jobNumber, version, changes });
      if (changes.status) {
        current.status = changes.status;
      }
      if (changes.dueDate) {
        current.dueDate = changes.dueDate;
      }
      if (changes.note) {
        current.notes.push({ at: 'now', author: changes.author, text: changes.note });
      }
      current.version += 1;
      return structuredClone(current);
    },
  };
  return { client, jobs, updates };
}

let clock = Date.parse('2026-11-17T10:00:00Z');
const pace = fakePace();
const pending = new PendingChanges(() => clock);
const recorder = memoryRecorder();
const connectAs = (roles: string[], oid: string, conversationId?: string) =>
  connect(
    buildPaceServer({
      caller: caller(roles, oid),
      context: { conversationId },
      pace: pace.client,
      pending,
      recorder,
    }),
  );

const matrix = loadMatrix(
  fileURLToPath(new URL('../../tests/pace-permissions/matrix.json', import.meta.url)),
);
const jobs = { openJob: 'J24000', restrictedJob: 'J24005' };
for (const [persona, roles] of Object.entries(matrix.personas)) {
  const client = await connectAs(roles, `oid-${persona}`);
  for (const matrixCase of matrix.cases) {
    const result = await runCase(client, persona, matrixCase, matrix.costFields, jobs);
    check(
      `matrix: ${persona} / ${result.name} -> ${result.expected}`,
      result.actual === result.expected && result.problems.length === 0,
      result,
    );
  }
}
check(
  'matrix touched every tool',
  TOOL_NAMES.every((tool) => matrix.cases.some((entry) => entry.tool === tool)),
);
check('matrix runs never changed Pace', pace.updates.length === 0, pace.updates);

const production = await connectAs(['Pace.Production'], 'oid-alice', 'conv-7');
const prepared = JSON.parse(
  resultText(
    await production.callTool({
      name: 'job_update_prepare',
      arguments: { jobNumber: 'J24000', status: 'printing', note: 'Proof approved by customer' },
    }),
  ),
);
check(
  'prepare returns a diff and a change id without touching Pace',
  /^chg_[0-9a-f]{32}$/.test(prepared.changeId) &&
    prepared.diff.length === 2 &&
    prepared.diff[0].from === 'proofing' &&
    prepared.diff[0].to === 'printing' &&
    pace.updates.length === 0,
  prepared,
);

const mallory = await connectAs(['Pace.Production'], 'oid-mallory');
const replay = await mallory.callTool({
  name: 'job_update_commit',
  arguments: { changeId: prepared.changeId },
});
check(
  'another user cannot commit the change id',
  replay.isError === true &&
    resultText(replay).includes('someone else') &&
    pace.updates.length === 0,
  replay,
);

const committed = await production.callTool({
  name: 'job_update_commit',
  arguments: { changeId: prepared.changeId },
});
check(
  'the preparer commits it once, with the version read at prepare',
  !committed.isError &&
    pace.updates.length === 1 &&
    pace.updates[0].version === 1 &&
    pace.jobs.J24000.status === 'printing',
  { committed, updates: pace.updates },
);
const record = recorder.actions.at(-1);
check(
  'commit records before, after, user and conversation',
  recorder.actions.length === 1 &&
    record?.tool === 'job_update_commit' &&
    record.target === 'J24000' &&
    record.userOid === 'oid-alice' &&
    record.conversationId === 'conv-7' &&
    (record.before as any).status === 'proofing' &&
    (record.after as any).status === 'printing' &&
    (record.after as any).note === 'Proof approved by customer' &&
    record.result === 'committed',
  record,
);
const again = await production.callTool({
  name: 'job_update_commit',
  arguments: { changeId: prepared.changeId },
});
check(
  'a change id works only once',
  again.isError === true && resultText(again).includes('Unknown'),
  again,
);

const late = JSON.parse(
  resultText(
    await production.callTool({
      name: 'job_update_prepare',
      arguments: { jobNumber: 'J24000', dueDate: '2026-12-01' },
    }),
  ),
);
clock += CHANGE_TTL_MS + 1;
const expired = await production.callTool({
  name: 'job_update_commit',
  arguments: { changeId: late.changeId },
});
check(
  'a change id expires after 10 minutes',
  expired.isError === true && resultText(expired).includes('expired'),
  expired,
);

const stale = JSON.parse(
  resultText(
    await production.callTool({
      name: 'job_update_prepare',
      arguments: { jobNumber: 'J24000', status: 'finishing' },
    }),
  ),
);
pace.jobs.J24000.version += 1;
const conflict = await production.callTool({
  name: 'job_update_commit',
  arguments: { changeId: stale.changeId },
});
check(
  'a job edited in Pace after prepare is refused and recorded as failed',
  conflict.isError === true &&
    resultText(conflict).includes('changed in Pace') &&
    recorder.actions.at(-1)?.result === 'failed: 412',
  { conflict, last: recorder.actions.at(-1) },
);

const noop = await production.callTool({
  name: 'job_update_prepare',
  arguments: { jobNumber: 'J24000', status: 'printing' },
});
check(
  'preparing a change to the current value is refused',
  noop.isError === true && resultText(noop).includes('Nothing to change'),
);
const badStatus = await production.callTool({
  name: 'job_update_prepare',
  arguments: { jobNumber: 'J24000', status: 'teleported' },
});
check(
  'unknown status is refused with the valid list',
  badStatus.isError === true && resultText(badStatus).includes('printing'),
);
const badNumber = await production.callTool({
  name: 'job_get',
  arguments: { jobNumber: '../customers/C100' },
});
check('job numbers are validated before reaching Pace', badNumber.isError === true, badNumber);

finish();
