import { checker, type Spec } from '../context.js';

export const approvedActions: Spec = {
  id: 'approved-actions',
  title: 'Approved-action records',
  async run(ctx) {
    const { expect, manual } = checker(ctx, this.id);
    const summary = await ctx.server.check('audit', '30');
    const tools = new Set((summary.rows ?? []).map((row: any) => row.tool));
    expect('Outlook drafts are recorded', tools.has('draft_reply'), summary);
    expect('Pace commits are recorded', tools.has('job_update_commit'), summary);
    expect(
      'every record has who, what and when',
      (summary.rows ?? []).every((row: any) => row.missing_fields === 0),
      summary,
    );
    const appendOnly = await ctx.server.check('audit-append-only');
    expect(
      'UPDATE, DELETE and TRUNCATE on approved_actions are refused, even for the admin role',
      appendOnly.update === 'refused' &&
        appendOnly.delete === 'refused' &&
        appendOnly.truncate === 'refused',
      appendOnly,
    );
    await manual(
      'each approval card in the chats has a matching record',
      "Pick three approved actions from alice's chats and find each in approved_actions (time, tool, target).",
    );
  },
};
