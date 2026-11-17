import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Status = 'pass' | 'fail' | 'manual' | 'skipped';

export interface Result {
  spec: string;
  check: string;
  status: Status;
  evidence: string;
  at: string;
}

export class Report {
  readonly results: Result[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(spec: string, check: string, status: Status, evidence: unknown = ''): boolean {
    const text = typeof evidence === 'string' ? evidence : JSON.stringify(evidence, null, 2);
    this.results.push({ spec, check, status, evidence: text, at: this.now().toISOString() });
    console.log(`${status.toUpperCase().padEnd(7)} ${spec}: ${check}`);
    return status === 'pass';
  }

  expect(spec: string, check: string, ok: boolean, evidence: unknown = ''): boolean {
    return this.record(spec, check, ok ? 'pass' : 'fail', evidence);
  }

  counts(): Record<Status, number> {
    const counts: Record<Status, number> = { pass: 0, fail: 0, manual: 0, skipped: 0 };
    for (const result of this.results) {
      counts[result.status]++;
    }
    return counts;
  }

  toMarkdown(title: string, specTitles: Record<string, string>): string {
    const counts = this.counts();
    const lines = [
      `# ${title}`,
      '',
      `Run at ${this.now().toISOString()}: ${counts.pass} passed, ${counts.fail} failed, ${counts.manual} manual, ${counts.skipped} skipped.`,
      '',
      '| Test | Check | Result |',
      '| --- | --- | --- |',
      ...this.results.map(
        (result) =>
          `| ${specTitles[result.spec] ?? result.spec} | ${result.check.replace(/\|/g, '/')} | ${result.status.toUpperCase()} |`,
      ),
      '',
      '## Evidence',
      '',
    ];
    for (const result of this.results.filter((entry) => entry.evidence)) {
      lines.push(`### ${specTitles[result.spec] ?? result.spec}: ${result.check}`, '');
      lines.push('```', result.evidence, '```', '');
    }
    return lines.join('\n');
  }

  write(dir: string, title: string, specTitles: Record<string, string>): string {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const base = join(dir, `golive-${stamp}`);
    writeFileSync(`${base}.json`, `${JSON.stringify(this.results, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(`${base}.md`, this.toMarkdown(title, specTitles), { mode: 0o600 });
    return `${base}.md`;
  }
}
