import { randomBytes } from 'node:crypto';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SIGN_IN_TTL_MS = 10 * 60 * 1000;
export const MAX_SESSIONS = 10000;
export const MAX_SIGN_INS = 1000;

interface Entry<Value> {
  value: Value;
  expiresAt: number;
}

export class ExpiringStore<Value> {
  private readonly entries = new Map<string, Entry<Value>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  put(value: Value, key = randomBytes(32).toString('base64url')): string {
    this.sweep();
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return key;
  }

  get(key: string | undefined): Value | undefined {
    const entry = key ? this.entries.get(key) : undefined;
    if (!entry || entry.expiresAt <= this.now()) {
      return undefined;
    }
    return entry.value;
  }

  take(key: string | undefined): Value | undefined {
    const value = this.get(key);
    if (key) {
      this.entries.delete(key);
    }
    return value;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
