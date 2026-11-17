import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Caller } from './auth.js';

const ENTRY = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  roles: z.array(z.string().min(1)).min(1),
  callRoles: z.array(z.string().min(1)).default([]),
});

const ALLOWLIST = z
  .object({ agents: z.array(ENTRY) })
  .refine(
    (list) => new Set(list.agents.map((agent) => agent.id)).size === list.agents.length,
    'agent ids must be unique',
  );

export type AllowedAgent = z.infer<typeof ENTRY>;

export class AgentAllowlist {
  private readonly byId: Map<string, AllowedAgent>;

  constructor(agents: AllowedAgent[]) {
    this.byId = new Map(agents.map((agent) => [agent.id, agent]));
  }

  static parse(raw: unknown): AgentAllowlist {
    return new AgentAllowlist(ALLOWLIST.parse(raw).agents);
  }

  static load(path: string): AgentAllowlist {
    return AgentAllowlist.parse(JSON.parse(readFileSync(path, 'utf8')));
  }

  visibleTo(caller: Caller): AllowedAgent[] {
    return [...this.byId.values()].filter((agent) => hasAny(caller, agent.roles));
  }

  find(id: string): AllowedAgent | undefined {
    return this.byId.get(id);
  }
}

export function hasAny(caller: Caller, roles: string[]): boolean {
  return roles.some((role) => caller.roles.includes(role));
}
