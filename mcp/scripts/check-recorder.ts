import { createRecorder } from '../src/shared/recorder.js';

const recorder = createRecorder(process.env.AUDIT_DATABASE_URL);
await recorder.record({
  userOid: 'oid-alice',
  upn: 'alice@example.com',
  tool: 'job_update_commit',
  target: 'J24001',
  summary: 'status -> printing',
  args: { changeId: 'chg_x', jobNumber: 'J24001' },
  before: { status: 'proofing' },
  after: { status: 'printing' },
  conversationId: 'conv-recorder',
  result: 'committed',
});
process.exit(0);
