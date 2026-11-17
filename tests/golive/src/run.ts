import type { Browser } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { awsServer } from './aws.js';
import { loadConfig, PERSONAS, type Persona } from './config.js';
import { createChat, type Context, type Spec } from './context.js';
import { login } from './login.js';
import { terminalOperator } from './operator.js';
import { Report } from './report.js';
import { launch, librechatAs } from './session.js';
import { SPECS } from './specs/index.js';
import { tokenFor } from './tokens.js';

export async function runSpecs(ctx: Context, specs: Spec[]): Promise<void> {
  for (const spec of specs) {
    console.log(`\n== ${spec.title}`);
    try {
      await spec.run(ctx);
    } catch (error) {
      ctx.report.record(
        spec.id,
        'spec finished without an error',
        'fail',
        (error as Error).stack ?? String(error),
      );
    }
  }
}

async function main(argv: string[]): Promise<number> {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch {
    // Values may come from the environment instead.
  }
  const [command, ...rest] = argv;
  if (command === 'list') {
    for (const spec of SPECS) {
      console.log(`${spec.id.padEnd(22)} ${spec.title}`);
    }
    return 0;
  }
  const config = loadConfig();
  if (command === 'login') {
    const persona = rest[0] as Persona;
    if (!PERSONAS.includes(persona)) {
      console.error(`usage: login <${PERSONAS.join('|')}>`);
      return 2;
    }
    await login(config, persona);
    return 0;
  }
  if (command !== 'run') {
    console.error(
      'usage: npm run golive -- list | login <persona> | run [--non-interactive] [spec...]',
    );
    return 2;
  }

  const interactive = !rest.includes('--non-interactive');
  const wanted = rest.filter((arg) => !arg.startsWith('--'));
  const unknown = wanted.filter((id) => !SPECS.some((spec) => spec.id === id));
  if (unknown.length > 0) {
    console.error(`unknown spec: ${unknown.join(', ')} (npm run golive -- list)`);
    return 2;
  }
  const specs = wanted.length > 0 ? SPECS.filter((spec) => wanted.includes(spec.id)) : SPECS;
  let browser: Browser | undefined;
  const report = new Report();
  const ctx: Context = {
    config,
    report,
    operator: terminalOperator(interactive),
    server: awsServer(config),
    librechat: (persona) => librechatAs(config, persona),
    token: (persona, scopes) => tokenFor(config, persona, scopes),
    browser: async () => (browser ??= await launch()),
    fetch,
    chat: (persona, text) => createChat(ctx, persona, text),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  try {
    await runSpecs(ctx, specs);
  } finally {
    await browser?.close();
  }
  const titles = Object.fromEntries(SPECS.map((spec) => [spec.id, spec.title]));
  const path = report.write(config.reportDir, 'PressRoom go-live test report', titles);
  const counts = report.counts();
  console.log(
    `\n${counts.pass} passed, ${counts.fail} failed, ${counts.manual} manual, ${counts.skipped} skipped\nreport: ${path}`,
  );
  return counts.fail > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
