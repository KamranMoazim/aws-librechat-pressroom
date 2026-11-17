import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createPortalApp } from '../src/app.js';
import type { Authenticator } from '../src/auth.js';

const PORTS = { api: 18311, portal: 18312, https: 18453, hostile: 18314 };
const CHAT = 'https://chat.pressroom.example.test';
const PORTAL = 'https://portal.pressroom.example.test';
const HOSTILE = `http://evil.example.test:${PORTS.hostile}`;
const STACK = fileURLToPath(new URL('../../../server/test/embed/stack.sh', import.meta.url));
const STUB = fileURLToPath(
  new URL('../../../server/test/embed/stub-librechat.mjs', import.meta.url),
);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: unknown): void {
  if (ok) {
    passed++;
  } else {
    failed++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(extra)}`);
}

let signIns = 0;
const auth: Authenticator = {
  async start() {
    signIns++;
    const state = `state-${signIns}`;
    return { url: `${PORTAL}/auth/callback?code=ok&state=${state}`, state, verifier: 'verifier' };
  },
  async finish() {
    return { oid: 'oid-alice', name: 'Alice', upn: 'alice@example.test' };
  },
};
const portal = createPortalApp({
  auth,
  chatOrigin: CHAT,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
}).listen(PORTS.portal, '0.0.0.0');

const hostile = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><title>evil</title>
<iframe id="chat" src="${CHAT}/c/new"></iframe>
<iframe id="probe" src="${CHAT}/pressroom/session.html"></iframe>
<script>window.received = []; addEventListener('message', (event) => window.received.push(event.data));</script>`);
}).listen(PORTS.hostile, '127.0.0.1');

const stub = spawn('node', [STUB, String(PORTS.api)], { stdio: 'inherit' });
const stackEnv = {
  ...process.env,
  API_PORT: String(PORTS.api),
  PORTAL_PORT: String(PORTS.portal),
  HTTPS_PORT: String(PORTS.https),
  EMBED_STATE: fileURLToPath(new URL('../../../server/test/embed/.state-browser', import.meta.url)),
};
const cleanup = () => {
  spawnSync(STACK, ['down'], { env: stackEnv, stdio: 'inherit' });
  stub.kill();
  portal.close();
  hostile.close();
};

try {
  const up = spawnSync(STACK, ['up'], { env: stackEnv, stdio: 'inherit' });
  if (up.status !== 0) {
    throw new Error('test stack did not start');
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--host-resolver-rules=MAP *.pressroom.example.test:443 127.0.0.1:${PORTS.https}, MAP evil.example.test 127.0.0.1`,
    ],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.goto(`${PORTAL}/production`);
  await page.locator('#chat-signin').waitFor({ state: 'visible', timeout: 10000 });
  check(
    'first visit: portal signed in, chat not yet, sign-in link shown',
    page.url() === `${PORTAL}/production` && (await page.locator('#chat-frame').isHidden()),
    page.url(),
  );

  await page.click('#chat-signin-link');
  await page.waitForURL(`${PORTAL}/production`, { timeout: 10000 });
  await page.locator('#chat-frame').waitFor({ state: 'visible', timeout: 10000 });
  const chatFrame = page.frameLocator('#chat-frame');
  await chatFrame.locator('#state').waitFor({ timeout: 10000 });
  check(
    'after one top-level sign-in the person is back on the same portal page',
    page.url() === `${PORTAL}/production`,
    page.url(),
  );
  check(
    'chat in the frame sees its SameSite=Strict session cookie',
    (await chatFrame.locator('#state').textContent()) === 'signed in: yes',
  );
  const productionPath = (await chatFrame.locator('#path').textContent()) ?? '';
  check(
    'production page deep link preselects the spec and fills the prompt',
    productionPath.startsWith('/c/new?spec=claude-everyday&prompt=Which'),
    productionPath,
  );
  const cookies = await context.cookies(CHAT);
  check(
    'chat session cookie is HttpOnly, Secure, Strict and the return cookie is gone',
    cookies.some(
      (cookie) =>
        cookie.name === 'refreshToken' &&
        cookie.httpOnly &&
        cookie.secure &&
        cookie.sameSite === 'Strict',
    ) && !cookies.some((cookie) => cookie.name === 'pressroom_return'),
    cookies,
  );

  await page.goto(`${PORTAL}/estimating`);
  await page.locator('#chat-frame').waitFor({ state: 'visible', timeout: 10000 });
  await chatFrame.locator('#path').waitFor({ timeout: 10000 });
  check(
    'next page shows the chat with no second sign-in',
    (await chatFrame.locator('#path').textContent()) === '/c/new?spec=claude-deep' &&
      (await page.locator('#chat-signin').isHidden()),
  );
  check('portal sign-in happened once', signIns === 1, signIns);

  const evil = await context.newPage();
  const refusals: string[] = [];
  evil.on('console', (message) => {
    if (/frame-ancestors|Refused to frame/i.test(message.text())) {
      refusals.push(message.text());
    }
  });
  await evil.goto(`${HOSTILE}/`);
  await evil.waitForTimeout(3000);
  const loadedFrames = await Promise.all(
    evil.frames().map(async (frame) => {
      try {
        return await frame.locator('#state').count();
      } catch {
        return 0;
      }
    }),
  );
  check(
    'a page on another origin cannot frame the chat, even with a live session',
    loadedFrames.every((count) => count === 0) && refusals.length >= 2,
    { loadedFrames, refusals },
  );
  check(
    'a page on another origin gets no message from the session probe',
    JSON.stringify(
      await evil.evaluate(() => (window as unknown as { received: unknown[] }).received),
    ) === '[]',
  );

  await browser.close();
} catch (error) {
  failed++;
  console.log(`FAIL browser run: ${(error as Error).message}`);
} finally {
  cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
