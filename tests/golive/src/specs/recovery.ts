import { awsServer } from '../aws.js';
import { checker, type Spec } from '../context.js';

export const recovery: Spec = {
  id: 'recovery',
  title: 'Recovery from backup',
  async run(ctx) {
    const { expect, manual, skip } = checker(ctx, this.id);
    const backup = await ctx.server.check('backup-status');
    expect('the last backup is less than 26 hours old', Number(backup.ageHours) < 26, backup);
    let log: any;
    try {
      log = await awsServer(ctx.config, 'pressroom-restore').check('restore-log');
    } catch (error) {
      skip(
        'restore drill on a fresh instance passed',
        `no running pressroom-restore instance: ${(error as Error).message}. Run the drill (docs/runbooks/backup-and-restore.md) and run this spec again.`,
      );
      return;
    }
    const line = String(log.last ?? '');
    const minutes = Number(/restore took (\d+) min/.exec(line)?.[1] ?? 'NaN');
    expect(
      'restore drill on a fresh instance passed its smoke checks',
      /smoke passed/.test(line),
      line,
    );
    expect('restore itself took under 60 minutes', minutes < 60, line);
    await manual(
      'RTO recorded',
      'Write instance-created and smoke-passed times in the report; RTO target is under 1 hour.',
    );
  },
};
