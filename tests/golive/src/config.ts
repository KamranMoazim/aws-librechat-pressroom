import { fileURLToPath } from 'node:url';

export const PERSONAS = ['alice', 'bob', 'carol', 'dave', 'eve'] as const;
export type Persona = (typeof PERSONAS)[number];

export interface Config {
  domain: string;
  tenantId: string;
  mcpClientId: string;
  goliveClientId: string;
  sharepointTenant: string;
  estimatingSite: string;
  openJob: string;
  restrictedJob: string;
  relevanceTestAgent: string;
  region: string;
  chatUrl: string;
  portalUrl: string;
  authDir: string;
  reportDir: string;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const need = (name: string) => {
    const value = env[name];
    if (!value) {
      missing.push(name);
    }
    return value ?? '';
  };
  const domain = need('DOMAIN');
  const config: Config = {
    domain,
    tenantId: need('ENTRA_TENANT_ID'),
    mcpClientId: need('MCP_CLIENT_ID'),
    goliveClientId: need('GOLIVE_CLIENT_ID'),
    sharepointTenant: need('SHAREPOINT_TENANT'),
    estimatingSite: env.ESTIMATING_SITE ?? '/sites/Estimating',
    openJob: env.OPEN_JOB ?? 'J24017',
    restrictedJob: env.RESTRICTED_JOB ?? 'J24011',
    relevanceTestAgent: env.RELEVANCE_TEST_AGENT ?? '',
    region: env.AWS_REGION ?? 'us-east-1',
    chatUrl: env.CHAT_URL ?? `https://chat.pressroom.${domain}`,
    portalUrl: env.PORTAL_URL ?? `https://portal.pressroom.${domain}`,
    authDir: env.GOLIVE_AUTH_DIR ?? `${ROOT}.auth`,
    reportDir: env.GOLIVE_REPORT_DIR ?? `${ROOT}reports`,
  };
  if (missing.length > 0) {
    throw new Error(`Set ${missing.join(', ')} in tests/golive/.env (see .env.example)`);
  }
  return config;
}
