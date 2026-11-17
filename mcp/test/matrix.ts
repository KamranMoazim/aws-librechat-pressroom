import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readFileSync } from 'node:fs';

export type Outcome = 'allow' | 'deny' | 'error';

export interface MatrixCase {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  expect: Record<string, Outcome>;
  noRestrictedJobsFor?: string[];
  costFieldsAbsentFor?: string[];
  costFieldsPresentFor?: string[];
}

export interface Matrix {
  personas: Record<string, string[]>;
  costFields: string[];
  cases: MatrixCase[];
}

export interface CaseResult {
  persona: string;
  name: string;
  expected: Outcome;
  actual: Outcome;
  problems: string[];
}

export function loadMatrix(path: string): Matrix {
  return JSON.parse(readFileSync(path, 'utf8')) as Matrix;
}

function fill(value: unknown, jobs: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => jobs[key] ?? '');
  }
  return value;
}

function hasCostField(value: unknown, fields: string[]): boolean {
  return JSON.stringify(value).match(new RegExp(`"(${fields.join('|')})"`)) !== null;
}

export async function runCase(
  client: Client,
  persona: string,
  matrixCase: MatrixCase,
  costFields: string[],
  jobs: Record<string, string>,
): Promise<CaseResult> {
  const args = Object.fromEntries(
    Object.entries(matrixCase.args).map(([key, value]) => [key, fill(value, jobs)]),
  );
  const result = (await client.callTool({ name: matrixCase.tool, arguments: args })) as {
    isError?: boolean;
    content?: { text?: string }[];
  };
  const text = (result.content ?? []).map((part) => part.text ?? '').join('');
  const actual: Outcome = !result.isError
    ? 'allow'
    : text.startsWith('Not permitted')
      ? 'deny'
      : 'error';
  const expected = matrixCase.expect[persona];
  const problems: string[] = [];
  if (actual === 'allow') {
    const body = JSON.parse(text) as { jobs?: { restricted?: boolean; jobNumber: string }[] };
    if (matrixCase.costFieldsAbsentFor?.includes(persona) && hasCostField(body, costFields)) {
      problems.push('cost fields visible');
    }
    if (matrixCase.costFieldsPresentFor?.includes(persona) && !hasCostField(body, costFields)) {
      problems.push('cost fields missing');
    }
    if (
      matrixCase.noRestrictedJobsFor?.includes(persona) &&
      body.jobs?.some((job) => job.jobNumber === jobs.restrictedJob || job.restricted)
    ) {
      problems.push('restricted job listed');
    }
  }
  return { persona, name: matrixCase.name, expected, actual, problems };
}
