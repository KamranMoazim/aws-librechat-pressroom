import { PublicClientApplication, type ICachePlugin } from '@azure/msal-node';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, Persona } from './config.js';

export function graphScopes(): string[] {
  return [
    'https://graph.microsoft.com/Files.Read.All',
    'https://graph.microsoft.com/Sites.Read.All',
  ];
}

export function mcpScopes(config: Config): string[] {
  return [`api://${config.mcpClientId}/Mcp.Tools`];
}

function fileCache(path: string): ICachePlugin {
  return {
    async beforeCacheAccess(context) {
      if (existsSync(path)) {
        context.tokenCache.deserialize(readFileSync(path, 'utf8'));
      }
    },
    async afterCacheAccess(context) {
      if (context.cacheHasChanged) {
        writeFileSync(path, context.tokenCache.serialize(), { mode: 0o600 });
      }
    },
  };
}

function appFor(config: Config, persona: Persona): PublicClientApplication {
  mkdirSync(config.authDir, { recursive: true, mode: 0o700 });
  return new PublicClientApplication({
    auth: {
      clientId: config.goliveClientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
    },
    cache: { cachePlugin: fileCache(join(config.authDir, `${persona}.msal.json`)) },
  });
}

export async function deviceLogin(config: Config, persona: Persona): Promise<string> {
  const result = await appFor(config, persona).acquireTokenByDeviceCode({
    scopes: [...mcpScopes(config), ...graphScopes(), 'offline_access'],
    deviceCodeCallback: (response) => console.log(`\n${persona}: ${response.message}\n`),
  });
  return result?.account?.username ?? '';
}

export async function tokenFor(
  config: Config,
  persona: Persona,
  scopes: string[],
): Promise<string> {
  const app = appFor(config, persona);
  const [account] = await app.getTokenCache().getAllAccounts();
  if (!account) {
    throw new Error(
      `no Microsoft sign-in stored for ${persona}: npm run golive -- login ${persona}`,
    );
  }
  const result = await app.acquireTokenSilent({ account, scopes, forceRefresh: true });
  return result.accessToken;
}

export function claimsOf(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}
