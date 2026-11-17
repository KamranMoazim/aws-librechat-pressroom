import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createPortalApp, SESSION_COOKIE, SIGN_IN_COOKIE } from '../src/app.js';
import { SignInError, type Authenticator } from '../src/auth.js';
import { escapeHtml } from '../src/pages.js';
import { ExpiringStore, SESSION_TTL_MS } from '../src/sessions.js';

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

const CHAT = 'https://chat.pressroom.example.test';
let clock = Date.parse('2026-11-17T10:00:00Z');
let starts = 0;
const finished: { code: string; verifier: string }[] = [];
const auth: Authenticator = {
  async start() {
    starts++;
    return {
      url: `https://login.microsoftonline.com/authorize?state=state-${starts}`,
      state: `state-${starts}`,
      verifier: `verifier-${starts}`,
    };
  },
  async finish(code, verifier) {
    finished.push({ code, verifier });
    if (code === 'refused') {
      throw new SignInError('Microsoft sign-in failed (AADSTS50105)');
    }
    return { oid: 'oid-alice', name: 'Alice <Estimator>', upn: 'alice@example.test' };
  },
};

const app = createPortalApp({
  auth,
  chatOrigin: CHAT,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  secureCookies: true,
  now: () => clock,
});
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const get = (path: string, cookie?: string) =>
  fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

const sessionCookie = (response: Response) =>
  response.headers.getSetCookie().find((entry) => entry.startsWith(`${SESSION_COOKIE}=`)) ?? '';

const health = await get('/healthz');
check('health check answers', health.status === 200);

const anonymous = await get('/estimating');
check(
  'anonymous page visit goes to sign-in for that page',
  anonymous.status === 302 && anonymous.headers.get('location') === '/login?page=%2Festimating',
  anonymous.headers.get('location'),
);
const csp = anonymous.headers.get('content-security-policy') ?? '';
check(
  'portal CSP allows framing only the chat, and nobody may frame the portal',
  csp.includes(`frame-src ${CHAT}`) &&
    csp.includes("frame-ancestors 'none'") &&
    csp.includes("script-src 'self'") &&
    !csp.includes('unsafe-inline'),
  csp,
);

const login = await get('/login?page=/estimating');
check(
  'login redirects to Microsoft',
  login.status === 302 &&
    login.headers.get('location')!.startsWith('https://login.microsoftonline.com/'),
);
const evilLogin = await get('/login?page=https://evil.example');
const evilState = new URL(evilLogin.headers.get('location')!).searchParams.get('state');
const evilReturn = await get(
  `/auth/callback?code=ok&state=${evilState}`,
  `${SIGN_IN_COOKIE}=${evilState}`,
);
check(
  'login page parameter cannot redirect off the portal',
  evilReturn.headers.get('location') === '/',
  evilReturn.headers.get('location'),
);

const finishedBefore = finished.length;
const unknownState = await get('/auth/callback?code=ok&state=forged');
check('callback with an unknown state is refused', unknownState.status === 400);
check('forged state never reached Microsoft', finished.length === finishedBefore, finished);

const refusedLogin = await get('/login?page=/');
const refusedState = new URL(refusedLogin.headers.get('location')!).searchParams.get('state');
const refused = await get(
  `/auth/callback?code=refused&state=${refusedState}`,
  `${SIGN_IN_COOKIE}=${refusedState}`,
);
check(
  'refused sign-in shows the reason without a session',
  refused.status === 401 &&
    (await refused.text()).includes('AADSTS50105') &&
    sessionCookie(refused) === '',
);

const cancelLogin = await get('/login?page=/');
const cancelState = new URL(cancelLogin.headers.get('location')!).searchParams.get('state');
const cancelled = await get(
  `/auth/callback?error=access_denied&state=${cancelState}`,
  `${SIGN_IN_COOKIE}=${cancelState}`,
);
check('cancelled sign-in is 401', cancelled.status === 401);
const reuseCancelled = await get(
  `/auth/callback?code=ok&state=${cancelState}`,
  `${SIGN_IN_COOKIE}=${cancelState}`,
);
check('a state cannot be used twice', reuseCancelled.status === 400);

const csrfLogin = await get('/login?page=/');
const csrfState = new URL(csrfLogin.headers.get('location')!).searchParams.get('state');
check(
  'login binds the state to the browser with a short HttpOnly cookie',
  (csrfLogin.headers.get('set-cookie') ?? '').startsWith(`${SIGN_IN_COOKIE}=${csrfState};`) &&
    /HttpOnly/i.test(csrfLogin.headers.get('set-cookie') ?? '') &&
    /Path=\/auth/i.test(csrfLogin.headers.get('set-cookie') ?? ''),
  csrfLogin.headers.get('set-cookie'),
);
const finishedBeforeCsrf = finished.length;
const planted = await get(`/auth/callback?code=ok&state=${csrfState}`);
check(
  'a callback link opened in another browser (login CSRF) is refused',
  planted.status === 400 && sessionCookie(planted) === '' && finished.length === finishedBeforeCsrf,
);

const goodLogin = await get('/login?page=/estimating');
const goodState = new URL(goodLogin.headers.get('location')!).searchParams.get('state');
const callback = await get(
  `/auth/callback?code=ok&state=${goodState}`,
  `${SIGN_IN_COOKIE}=${goodState}`,
);
const setCookie = sessionCookie(callback);
check(
  'callback signs in and returns to the page',
  callback.status === 302 && callback.headers.get('location') === '/estimating',
  callback.headers.get('location'),
);
check(
  'session cookie is HttpOnly, Secure, SameSite=Lax',
  setCookie.startsWith(`${SESSION_COOKIE}=`) &&
    /HttpOnly/i.test(setCookie) &&
    /Secure/i.test(setCookie) &&
    /SameSite=Lax/i.test(setCookie),
  setCookie,
);
check(
  'pkce verifier from start is used to finish',
  finished.at(-1)?.verifier === goodState!.replace('state', 'verifier'),
  finished.at(-1),
);
const replay = await get(
  `/auth/callback?code=ok&state=${goodState}`,
  `${SIGN_IN_COOKIE}=${goodState}`,
);
check('callback replay is refused', replay.status === 400);

const cookie = setCookie.split(';')[0];
const page = await get('/production', cookie);
const html = await page.text();
check('signed-in page renders', page.status === 200);
check(
  'page carries chat origin and deep link with spec and prompt, never auto-submit',
  html.includes(`data-chat-origin="${CHAT}"`) &&
    html.includes('spec=claude-everyday') &&
    html.includes('prompt=Which%20Pace%20jobs') &&
    !html.includes('submit='),
);
check(
  'user name is escaped',
  html.includes('Alice &#60;Estimator&#62;') && !html.includes('<Estimator>'),
);
check(
  'no inline script',
  !/<script>(?!<\/script>)/.test(html) &&
    html.includes('<script src="/static/portal.js"></script>'),
);
check(
  'chat frame allows microphone for dictation',
  html.includes('allow="microphone; clipboard-read; clipboard-write"'),
);

const script = await get('/static/portal.js');
check(
  'portal script is served as javascript',
  script.status === 200 && (script.headers.get('content-type') ?? '').includes('javascript'),
);
const listing = await get('/static/');
check('static folder has no listing', listing.status === 404);

const logout = await get('/logout', cookie);
check(
  'logout clears the cookie',
  (logout.headers.get('set-cookie') ?? '').includes(`${SESSION_COOKIE}=;`),
);
const afterLogout = await get('/production', cookie);
check('old session cookie no longer works', afterLogout.status === 302);

const secondLogin = await get('/login?page=/');
const secondState = new URL(secondLogin.headers.get('location')!).searchParams.get('state');
const second = await get(
  `/auth/callback?code=ok&state=${secondState}`,
  `${SIGN_IN_COOKIE}=${secondState}`,
);
const secondCookie = sessionCookie(second).split(';')[0];
check('each sign-in gets a new session id', secondCookie !== cookie);
clock += SESSION_TTL_MS + 1;
const expired = await get('/', secondCookie);
check('session expires after 8 hours', expired.status === 302);

const lateLogin = await get('/login?page=/');
const lateState = new URL(lateLogin.headers.get('location')!).searchParams.get('state');
clock += 11 * 60 * 1000;
const late = await get(
  `/auth/callback?code=ok&state=${lateState}`,
  `${SIGN_IN_COOKIE}=${lateState}`,
);
check('sign-in older than 10 minutes is refused', late.status === 400);

const capped = new ExpiringStore<number>(60000, 3, () => clock);
const firstKey = capped.put(1);
capped.put(2);
capped.put(3);
capped.put(4);
check('stores are capped and drop the oldest entry', capped.get(firstKey) === undefined);

check('escapeHtml escapes quotes', escapeHtml(`"'<>&`) === '&#34;&#39;&#60;&#62;&#38;');
const missing = await get('/admin', cookie);
check('unknown path is 404', missing.status === 404);

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
