import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PaceError, type PaceClient, type PaceJob } from '../src/pace/client.js';
import { PendingChanges } from '../src/pace/pending.js';
import { buildPaceServer } from '../src/pace/tools.js';
import { createVerifier } from '../src/shared/auth.js';
import { createMcpApp } from '../src/shared/http.js';
import {
  check,
  createIssuer,
  finish,
  MCP_CLIENT_ID,
  memoryRecorder,
  TENANT_ID,
} from './helpers.js';

const base = {
  customerId: 'C1',
  status: 'proofing',
  dueDate: '2026-11-20',
  quantity: 1,
  parts: [],
  notes: [],
  estimatedCost: 1,
  quotedPrice: 2,
  marginPct: 50,
  version: 1,
};
const jobs: Record<string, PaceJob> = {
  J1: {
    ...base,
    jobNumber: 'J100',
    customerName: 'Acme',
    title: 'Banner',
    estimateId: 'E1',
    restricted: false,
  },
  J2: {
    ...base,
    jobNumber: 'J200',
    customerName: 'City',
    title: 'Signs',
    estimateId: 'E2',
    restricted: true,
  },
};
const byNumber = Object.fromEntries(Object.values(jobs).map((job) => [job.jobNumber, job]));
let writes = 0;
const pace: PaceClient = {
  searchJobs: async () => ({ count: 2, jobs: Object.values(byNumber) }),
  getJob: async (jobNumber) => {
    if (!byNumber[jobNumber]) {
      throw new PaceError(404, 'not found');
    }
    return structuredClone(byNumber[jobNumber]);
  },
  getEstimate: async (id) => ({ id, estimatedCost: 1 }),
  statuses: async () => ['proofing', 'printing'],
  updateJob: async (jobNumber, _version, changes) => {
    writes++;
    byNumber[jobNumber].version++;
    byNumber[jobNumber].notes.push({ at: 'now', author: changes.author, text: changes.note ?? '' });
    return structuredClone(byNumber[jobNumber]);
  },
};

const { keys, sign } = await createIssuer();
const pending = new PendingChanges();
const app = createMcpApp({
  name: 'pace',
  verify: createVerifier({
    tenantId: TENANT_ID,
    audiences: [MCP_CLIENT_ID],
    requiredScope: 'Mcp.Tools',
    keys,
  }),
  buildServer: (caller, context) =>
    buildPaceServer({ caller, context, pace, pending, recorder: memoryRecorder() }),
});
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

const env = {
  ...process.env,
  PACE_MCP_URL: url,
  OPEN_JOB: 'J100',
  RESTRICTED_JOB: 'J200',
  TOKEN_USER: await sign({ oid: 'u1', roles: [] }),
  TOKEN_ESTIMATOR: await sign({ oid: 'u2', roles: ['Pace.Estimating'] }),
  TOKEN_PRODUCTION: await sign({ oid: 'u3', roles: ['Pace.Production'] }),
};
const script = fileURLToPath(new URL('../scripts/pace-permissions.ts', import.meta.url));
const spawnAsync = async (extra: string[], overrides: Record<string, string> = {}) => {
  return new Promise<{ status: number | null; stdout: string }>((resolve) => {
    const child = spawn('npx', ['tsx', script, ...extra], { env: { ...env, ...overrides } });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout }));
  });
};
const readOnly = await spawnAsync([]);
check(
  'runner passes all 21 cases against our server and exits 0',
  readOnly.status === 0 && readOnly.stdout.includes('21 passed, 0 failed'),
  readOnly.stdout,
);
check('runner without --allow-writes never writes to Pace', writes === 0, writes);

const withWrites = await spawnAsync(['--allow-writes']);
check(
  '--allow-writes prepares and commits once as production',
  withWrites.status === 0 && withWrites.stdout.includes('22 passed') && writes === 1,
  withWrites.stdout,
);

const leaky = await spawnAsync([], {
  TOKEN_USER: await sign({ oid: 'u1', roles: ['Pace.Estimating'] }),
});
check(
  'runner fails and exits 1 when a persona gets more than it should',
  leaky.status === 1 && /FAIL\s+user\s+read a restricted job/.test(leaky.stdout),
  leaky.stdout,
);

server.close();
finish();
