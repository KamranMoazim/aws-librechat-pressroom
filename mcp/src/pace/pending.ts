import { randomBytes } from 'node:crypto';
import type { JobChanges } from './client.js';

export const CHANGE_TTL_MS = 10 * 60 * 1000;

export interface FieldChange {
  field: 'status' | 'dueDate' | 'note';
  from: string | null;
  to: string;
}

export interface PendingChange {
  changeId: string;
  userOid: string;
  jobNumber: string;
  version: number;
  changes: JobChanges;
  diff: FieldChange[];
  expiresAt: number;
}

export type TakeResult =
  | { ok: true; change: PendingChange }
  | { ok: false; reason: 'unknown' | 'other-user' | 'expired' };

export class PendingChanges {
  private readonly changes = new Map<string, PendingChange>();

  constructor(private readonly now: () => number = Date.now) {}

  add(change: Omit<PendingChange, 'changeId' | 'expiresAt'>): PendingChange {
    this.sweep();
    const pending = {
      ...change,
      changeId: `chg_${randomBytes(16).toString('hex')}`,
      expiresAt: this.now() + CHANGE_TTL_MS,
    };
    this.changes.set(pending.changeId, pending);
    return pending;
  }

  take(changeId: string, userOid: string): TakeResult {
    const change = this.changes.get(changeId);
    if (!change) {
      return { ok: false, reason: 'unknown' };
    }
    if (change.userOid !== userOid) {
      return { ok: false, reason: 'other-user' };
    }
    this.changes.delete(changeId);
    if (change.expiresAt <= this.now()) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, change };
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, change] of this.changes) {
      if (change.expiresAt <= now) {
        this.changes.delete(id);
      }
    }
  }
}
