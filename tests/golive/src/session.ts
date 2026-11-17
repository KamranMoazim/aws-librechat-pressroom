import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, Persona } from './config.js';
import {
  applySetCookies,
  cookieHeaderFor,
  LibreChatClient,
  type StoredCookie,
} from './librechat.js';

export function statePath(config: Config, persona: Persona): string {
  return join(config.authDir, `${persona}.state.json`);
}

export async function librechatAs(
  config: Config,
  persona: Persona,
  fetchImpl: typeof fetch = fetch,
): Promise<LibreChatClient> {
  const path = statePath(config, persona);
  if (!existsSync(path)) {
    throw new Error(`no browser sign-in stored for ${persona}: npm run golive -- login ${persona}`);
  }
  const state = JSON.parse(readFileSync(path, 'utf8')) as { cookies: StoredCookie[] };
  const host = new URL(config.chatUrl).host;
  const { client, setCookies } = await LibreChatClient.signIn(
    config.chatUrl,
    cookieHeaderFor(state.cookies, host),
    fetchImpl,
  );
  applySetCookies(state.cookies, host, setCookies);
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
  return client;
}

export async function launch(headed = false): Promise<Browser> {
  return chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
}

export async function contextAs(
  browser: Browser,
  config: Config,
  persona: Persona,
): Promise<BrowserContext> {
  const path = statePath(config, persona);
  return browser.newContext(existsSync(path) ? { storageState: path } : {});
}
