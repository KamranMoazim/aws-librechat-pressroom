import express, { type Express, type Request, type Response } from 'express';
import { SignInError, type Authenticator, type PortalUser } from './auth.js';
import { PAGES, renderMessage, renderPage } from './pages.js';
import {
  ExpiringStore,
  MAX_SESSIONS,
  MAX_SIGN_INS,
  SESSION_TTL_MS,
  SIGN_IN_TTL_MS,
} from './sessions.js';

export const SESSION_COOKIE = 'portal_sid';
export const SIGN_IN_COOKIE = 'portal_signin';

export interface PortalOptions {
  auth: Authenticator;
  chatOrigin: string;
  publicDir: string;
  secureCookies?: boolean;
  now?: () => number;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

interface PendingSignIn {
  verifier: string;
  page: string;
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return undefined;
}

function knownPage(value: unknown): string {
  return PAGES.some((page) => page.path === value) ? (value as string) : '/';
}

export function createPortalApp(options: PortalOptions): Express {
  const app = express();
  const sessions = new ExpiringStore<PortalUser>(SESSION_TTL_MS, MAX_SESSIONS, options.now);
  const pending = new ExpiringStore<PendingSignIn>(SIGN_IN_TTL_MS, MAX_SIGN_INS, options.now);
  const secure = options.secureCookies ?? true;
  const log = options.log ?? (() => undefined);
  const contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    `frame-src ${options.chatOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': contentSecurityPolicy,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
    });
    next();
  });
  app.use('/static', express.static(options.publicDir, { index: false }));

  const userOf = (req: Request) => sessions.get(cookieValue(req, SESSION_COOKIE));
  const message = (res: Response, status: number, title: string, text: string) => {
    res
      .status(status)
      .type('html')
      .send(renderMessage(title, text, { href: '/', text: 'Try again' }));
  };

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: 'portal' });
  });

  app.get('/login', async (req, res) => {
    const start = await options.auth.start();
    pending.put({ verifier: start.verifier, page: knownPage(req.query.page) }, start.state);
    res.cookie(SIGN_IN_COOKIE, start.state, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/auth',
      maxAge: SIGN_IN_TTL_MS,
    });
    res.redirect(start.url);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const signIn = pending.take(typeof state === 'string' ? state : undefined);
    const sameBrowser = typeof state === 'string' && cookieValue(req, SIGN_IN_COOKIE) === state;
    res.clearCookie(SIGN_IN_COOKIE, { path: '/auth' });
    if (typeof error === 'string') {
      message(res, 401, 'Not signed in', 'Microsoft sign-in was cancelled or refused.');
      return;
    }
    if (!signIn || !sameBrowser || typeof code !== 'string') {
      message(res, 400, 'Sign-in expired', 'That sign-in link is no longer valid.');
      return;
    }
    let user: PortalUser;
    try {
      user = await options.auth.finish(code, signIn.verifier);
    } catch (failure) {
      if (failure instanceof SignInError) {
        log('sign-in failed', { reason: failure.message });
        message(res, 401, 'Not signed in', failure.message);
        return;
      }
      throw failure;
    }
    const sessionId = sessions.put(user);
    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
    log('signed in', { oid: user.oid, upn: user.upn });
    res.redirect(signIn.page);
  });

  app.get('/logout', (req, res) => {
    sessions.take(cookieValue(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.type('html').send(
      renderMessage('Signed out', 'You are signed out of the portal.', {
        href: '/',
        text: 'Sign in',
      }),
    );
  });

  for (const page of PAGES) {
    app.get(page.path, (req, res) => {
      const user = userOf(req);
      if (!user) {
        res.redirect(`/login?page=${encodeURIComponent(page.path)}`);
        return;
      }
      res.type('html').send(renderPage(page, user, options.chatOrigin));
    });
  }

  app.use((_req, res) => {
    res.status(404).type('html').send(renderMessage('Not found', 'There is no such page.'));
  });

  return app;
}
