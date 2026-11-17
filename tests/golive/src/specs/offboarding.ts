import { checker, type Spec } from '../context.js';
import { SignedOutError, type LibreChatClient } from '../librechat.js';

const BAN_CHECKED_ROUTE = '/api/files';

async function cutOff(
  attempt: () => Promise<LibreChatClient>,
): Promise<'cut off' | 'signed in' | string> {
  try {
    const result = await (await attempt()).get(BAN_CHECKED_ROUTE);
    if (result.status === 401 || result.status === 403) {
      return 'cut off';
    }
    return result.status === 200 ? 'signed in' : `unclear: ${result.status}`;
  } catch (error) {
    return error instanceof SignedOutError ? 'cut off' : `unclear: ${(error as Error).message}`;
  }
}

export const offboarding: Spec = {
  id: 'offboarding',
  title: 'Offboarding',
  async run(ctx) {
    const { expect, manual, skip } = checker(ctx, this.id);
    const dave = await ctx.librechat('dave');
    const control = await dave.get(BAN_CHECKED_ROUTE);
    expect('dave is signed in (control)', control.status === 200, control.status);
    if (!ctx.operator.interactive) {
      await manual(
        'ban in the admin panel cuts dave off at once',
        'Run this spec interactively: npm run golive -- run offboarding',
      );
      await manual(
        "Entra block + revoke sessions ends dave's session",
        'Run this spec interactively and record the window in docs/runbooks/day-2.md',
      );
      return;
    }

    if (await ctx.operator.confirm('Ban dave in the admin panel (Users > dave > Ban) now.')) {
      const banned = await dave.get(BAN_CHECKED_ROUTE);
      expect(
        "after the ban, dave's next request is refused",
        banned.status === 401 || banned.status === 403,
        { status: banned.status, body: banned.text.slice(0, 200) },
      );
      await ctx.operator.confirm('Lift the ban on dave in the admin panel.');
    } else {
      skip('ban in the admin panel cuts dave off at once', 'operator did not ban');
    }

    if (!(await ctx.operator.confirm('In Entra: block sign-in for dave, then Revoke sessions.'))) {
      skip("Entra block ends dave's session", 'operator did not block');
      return;
    }
    const started = Date.now();
    let minutes = -1;
    const unclear: string[] = [];
    for (let attempt = 0; attempt < 150; attempt++) {
      const state = await cutOff(() => ctx.librechat('dave'));
      if (state === 'cut off') {
        minutes = Math.round((Date.now() - started) / 6000) / 10;
        break;
      }
      if (state !== 'signed in') {
        unclear.push(state);
      }
      await ctx.sleep(30000);
    }
    expect(
      "Entra block + revoke sessions ends dave's LibreChat session (within 75 min)",
      minutes >= 0,
      {
        minutes: minutes >= 0 ? minutes : 'still signed in after 75 min',
        note: 'write this in docs/runbooks/day-2.md',
        unclearAnswers: unclear.slice(0, 5),
      },
    );
    await manual(
      'Re-enable dave in Entra',
      'Unblock sign-in for dave, then npm run golive -- login dave.',
    );
  },
};
