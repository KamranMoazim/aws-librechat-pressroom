export interface HttpResult {
  status: number;
  text: string;
  body: any;
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  [key: string]: unknown;
}

export function cookieHeaderFor(cookies: StoredCookie[], host: string): string {
  return cookies
    .filter((cookie) => {
      const domain = cookie.domain.replace(/^\./, '');
      return host === domain || host.endsWith(`.${domain}`);
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function applySetCookies(cookies: StoredCookie[], host: string, setCookies: string[]): void {
  for (const header of setCookies) {
    const [pair] = header.split(';');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const existing = cookies.find(
      (cookie) => cookie.name === name && cookieHeaderFor([cookie], host),
    );
    if (existing) {
      existing.value = value;
    } else {
      cookies.push({ name, value, domain: host, path: '/' });
    }
  }
}

export class SignedOutError extends Error {}

export class LibreChatClient {
  private constructor(
    readonly baseUrl: string,
    private readonly token: string,
    readonly userId: string,
    readonly email: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  static async signIn(
    baseUrl: string,
    cookieHeader: string,
    fetchImpl: typeof fetch = fetch,
  ): Promise<{ client: LibreChatClient; setCookies: string[] }> {
    const response = await fetchImpl(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    });
    const type = response.headers.get('content-type') ?? '';
    const body = type.includes('application/json') ? await response.json() : null;
    if (!response.ok || typeof body?.token !== 'string') {
      throw new SignedOutError(`LibreChat refresh answered ${response.status}`);
    }
    const user = body.user ?? {};
    return {
      client: new LibreChatClient(
        baseUrl,
        body.token,
        String(user.id ?? user._id ?? ''),
        String(user.email ?? ''),
        fetchImpl,
      ),
      setCookies: response.headers.getSetCookie?.() ?? [],
    };
  }

  async request(method: string, path: string, payload?: unknown): Promise<HttpResult> {
    const isForm = payload instanceof FormData;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(payload === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
      },
      body: payload === undefined ? undefined : isForm ? payload : JSON.stringify(payload),
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, text, body };
  }

  get(path: string) {
    return this.request('GET', path);
  }

  post(path: string, payload?: unknown) {
    return this.request('POST', path, payload);
  }
}

export function denied(result: HttpResult): boolean {
  if (result.status === 401 || result.status === 403 || result.status === 404) {
    return true;
  }
  if (result.status === 200) {
    const body = result.body;
    return (
      (Array.isArray(body) && body.length === 0) ||
      (Array.isArray(body?.messages) && body.messages.length === 0)
    );
  }
  return false;
}
