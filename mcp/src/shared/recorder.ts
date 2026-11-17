import pg from 'pg';
import { logRecorder, sha256Of, type ActionRecorder } from './audit.js';
import { log } from './log.js';

const INSERT = `INSERT INTO approved_actions
  (user_oid, upn, tool, target, summary, args_sha256, before, after, conversation_id, result)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

export function createPgRecorder(pool: Pick<pg.Pool, 'query'>): ActionRecorder {
  return {
    async record(action) {
      await pool.query(INSERT, [
        action.userOid,
        action.upn,
        action.tool,
        action.target,
        action.summary,
        sha256Of(action.args),
        action.before === undefined ? null : JSON.stringify(action.before),
        action.after === undefined ? null : JSON.stringify(action.after),
        action.conversationId ?? null,
        action.result,
      ]);
    },
  };
}

export function createRecorder(databaseUrl: string | undefined): ActionRecorder {
  if (!databaseUrl) {
    log.warn('AUDIT_DATABASE_URL not set: approved actions go to the log only');
    return logRecorder;
  }
  return createPgRecorder(new pg.Pool({ connectionString: databaseUrl, max: 4 }));
}
