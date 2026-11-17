import { ConfidentialClientApplication } from '@azure/msal-node';
import type { Caller } from './auth.js';

export type TokenExchanger = (caller: Caller, scopes: string[]) => Promise<string>;

export interface OboOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class OboError extends Error {}

export function createOboExchanger(options: OboOptions): TokenExchanger {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      authority: `https://login.microsoftonline.com/${options.tenantId}`,
    },
  });
  return async (caller, scopes) => {
    try {
      const result = await app.acquireTokenOnBehalfOf({ oboAssertion: caller.token, scopes });
      if (!result?.accessToken) {
        throw new OboError('the on-behalf-of exchange returned no token');
      }
      return result.accessToken;
    } catch (error) {
      if (error instanceof OboError) {
        throw error;
      }
      const code = /AADSTS\d+/.exec(String((error as Error).message))?.[0] ?? 'unknown error';
      throw new OboError(`Microsoft sign-in refused the token exchange (${code})`);
    }
  };
}
