import { chmodSync, mkdirSync } from 'node:fs';
import type { Config, Persona } from './config.js';
import { launch, statePath } from './session.js';
import { deviceLogin } from './tokens.js';

export async function login(config: Config, persona: Persona): Promise<void> {
  mkdirSync(config.authDir, { recursive: true, mode: 0o700 });
  const browser = await launch(true);
  const context = await browser.newContext();
  const page = await context.newPage();
  console.log(
    `Sign in as ${persona} in the browser window (Microsoft, MFA). Waiting up to 5 minutes.`,
  );
  await page.goto(`${config.chatUrl}/oauth/openid`);
  await page.waitForURL(
    (url) =>
      url.host === new URL(config.chatUrl).host &&
      !url.pathname.startsWith('/login') &&
      !url.pathname.startsWith('/oauth'),
    { timeout: 300000 },
  );
  await page.waitForTimeout(3000);
  console.log(
    `Now approve the device sign-in for ${persona} (same Microsoft account) in the same window.`,
  );
  const devicePage = await context.newPage();
  await devicePage.goto('https://microsoft.com/devicelogin');
  const username = await deviceLogin(config, persona);
  await context.storageState({ path: statePath(config, persona) });
  chmodSync(statePath(config, persona), 0o600);
  await browser.close();
  console.log(`stored sign-ins for ${persona} (${username}) in ${config.authDir}`);
}
