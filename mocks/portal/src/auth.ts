import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';

export interface PortalUser {
  oid: string;
  name: string;
  upn: string;
}

export interface SignInStart {
  url: string;
  state: string;
  verifier: string;
}

export interface Authenticator {
  start(): Promise<SignInStart>;
  finish(code: string, verifier: string): Promise<PortalUser>;
}

export class SignInError extends Error {}

export interface MsalOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const SCOPES = ['openid', 'profile'];

export function createMsalAuthenticator(options: MsalOptions): Authenticator {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      authority: `https://login.microsoftonline.com/${options.tenantId}`,
    },
  });
  const crypto = new CryptoProvider();
  return {
    async start() {
      const { verifier, challenge } = await crypto.generatePkceCodes();
      const state = crypto.createNewGuid();
      const url = await app.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri: options.redirectUri,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        state,
      });
      return { url, state, verifier };
    },
    async finish(code, verifier) {
      let claims: Record<string, unknown> | undefined;
      try {
        const result = await app.acquireTokenByCode({
          code,
          scopes: SCOPES,
          redirectUri: options.redirectUri,
          codeVerifier: verifier,
        });
        claims = result?.idTokenClaims as Record<string, unknown> | undefined;
      } catch (error) {
        const code = /AADSTS\d+/.exec(String((error as Error).message))?.[0] ?? 'unknown error';
        throw new SignInError(`Microsoft sign-in failed (${code})`);
      }
      const tenant = typeof claims?.tid === 'string' ? claims.tid.toLowerCase() : '';
      if (!claims || tenant !== options.tenantId.toLowerCase() || typeof claims.oid !== 'string') {
        throw new SignInError('Microsoft sign-in returned an unexpected account');
      }
      return {
        oid: claims.oid,
        name: typeof claims.name === 'string' ? claims.name : '',
        upn: typeof claims.preferred_username === 'string' ? claims.preferred_username : '',
      };
    },
  };
}
