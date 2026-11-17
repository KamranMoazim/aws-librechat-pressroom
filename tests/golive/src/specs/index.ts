import type { Spec } from '../context.js';
import { approvedActions } from './approved-actions.js';
import { approvedProviders } from './approved-providers.js';
import { chatIsolation } from './chat-isolation.js';
import { connectorRevocation } from './connector-revocation.js';
import { deletion } from './deletion.js';
import { offboarding } from './offboarding.js';
import { recovery } from './recovery.js';
import { restrictedRecords } from './restricted-records.js';
import { spend } from './spend.js';

// Offboarding runs last: it revokes dave's sessions, which connector revocation still needs.
export const SPECS: Spec[] = [
  restrictedRecords,
  chatIsolation,
  connectorRevocation,
  approvedProviders,
  spend,
  deletion,
  recovery,
  approvedActions,
  offboarding,
];
