import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fileURLToPath } from 'node:url';
import { loadMatrix, runCase, type CaseResult } from '../test/matrix.js';

const url = process.env.PACE_MCP_URL;
const jobs = {
  openJob: process.env.OPEN_JOB ?? '',
  restrictedJob: process.env.RESTRICTED_JOB ?? '',
};
const allowWrites = process.argv.includes('--allow-writes');
const matrixPath =
  process.env.MATRIX ??
  fileURLToPath(new URL('../../tests/pace-permissions/matrix.json', import.meta.url));

if (!url || !jobs.openJob || !jobs.restrictedJob) {
  console.error(
    'Set PACE_MCP_URL, OPEN_JOB, RESTRICTED_JOB and TOKEN_<PERSONA> for each persona in the matrix.',
  );
  process.exit(2);
}

const matrix = loadMatrix(matrixPath);
const results: CaseResult[] = [];
for (const persona of Object.keys(matrix.personas)) {
  const token = process.env[`TOKEN_${persona.toUpperCase()}`];
  if (!token) {
    console.error(`TOKEN_${persona.toUpperCase()} is not set`);
    process.exit(2);
  }
  const client = new Client({ name: 'pace-permission-matrix', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  for (const matrixCase of matrix.cases) {
    results.push(await runCase(client, persona, matrixCase, matrix.costFields, jobs));
  }
  if (allowWrites && persona === 'production') {
    const prepared = await client.callTool({
      name: 'job_update_prepare',
      arguments: { jobNumber: jobs.openJob, note: 'Permission matrix write check' },
    });
    const preparedText = ((prepared.content ?? []) as { text?: string }[])
      .map((part) => part.text ?? '')
      .join('');
    const changeId = prepared.isError
      ? undefined
      : (JSON.parse(preparedText) as { changeId?: string }).changeId;
    const committed = changeId
      ? await client.callTool({ name: 'job_update_commit', arguments: { changeId } })
      : { isError: true };
    results.push({
      persona,
      name: 'prepare and commit a note (--allow-writes)',
      expected: 'allow',
      actual: committed.isError ? 'error' : 'allow',
      problems: [],
    });
  }
  await client.close();
}

let failures = 0;
for (const result of results) {
  const ok = result.actual === result.expected && result.problems.length === 0;
  if (!ok) {
    failures++;
  }
  const extra = result.problems.length ? ` (${result.problems.join(', ')})` : '';
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${result.persona.padEnd(11)} ${result.name.padEnd(42)} expected ${result.expected}, got ${result.actual}${extra}`,
  );
}
console.log(`\n${results.length - failures} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
