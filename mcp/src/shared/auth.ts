import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Caller {
  oid: string;
  upn: string;
  tenantId: string;
  roles: string[];
  token: string;
}

export class AuthError extends Error {}

export interface VerifierOptions {
  tenantId: string;
  audiences: string[];
  requiredScope: string;
  keys?: JWTVerifyGetKey;
}

export type Verifier = (authorization: string | undefined) => Promise<Caller>;

export function createVerifier(options: VerifierOptions): Verifier {
  const keys =
    options.keys ??
    createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${options.tenantId}/discovery/v2.0/keys`),
    );
  const issuer = `https://login.microsoftonline.com/${options.tenantId}/v2.0`;

  return async (authorization) => {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match) {
      throw new AuthError('missing bearer token');
    }
    const token = match[1];
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer,
        audience: options.audiences,
        algorithms: ['RS256'],
        clockTolerance: 60,
      }));
    } catch (error) {
      throw new AuthError(`invalid token: ${(error as Error).message}`);
    }
    if (payload.tid !== options.tenantId) {
      throw new AuthError('token is from another tenant');
    }
    const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ') : [];
    if (!scopes.includes(options.requiredScope)) {
      throw new AuthError(`token lacks the ${options.requiredScope} scope`);
    }
    if (typeof payload.oid !== 'string' || payload.oid.length === 0) {
      throw new AuthError('token has no user object id');
    }
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((role): role is string => typeof role === 'string')
      : [];
    const upn = [payload.preferred_username, payload.upn].find(
      (value): value is string => typeof value === 'string',
    );
    return { oid: payload.oid, upn: upn ?? '', tenantId: options.tenantId, roles, token };
  };
}
