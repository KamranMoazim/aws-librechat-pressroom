import { checker, type Context, type Spec } from '../context.js';
import { callTool } from '../mcp.js';
import { contextAs } from '../session.js';
import { claimsOf, graphScopes, mcpScopes } from '../tokens.js';

const COST_FIELDS = ['estimatedCost', 'quotedPrice', 'marginPct'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

async function siteStatus(ctx: Context, persona: 'alice' | 'bob', url: string) {
  const browser = await ctx.browser();
  const context = await contextAs(browser, ctx.config, persona);
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    const body = (await page.textContent('body').catch(() => '')) ?? '';
    return {
      status: response?.status() ?? 0,
      url: page.url(),
      denied: /AccessDenied|access denied|you need access|request access/i.test(
        `${page.url()} ${body}`,
      ),
    };
  } finally {
    await context.close();
  }
}

export const restrictedRecords: Spec = {
  id: 'restricted-records',
  title: 'Restricted records',
  async run(ctx) {
    const { expect, manual } = checker(ctx, this.id);
    const site = `https://${ctx.config.sharepointTenant}.sharepoint.com${ctx.config.estimatingSite}`;

    const aliceSite = await siteStatus(ctx, 'alice', site);
    const bobSite = await siteStatus(ctx, 'bob', site);
    expect(
      'alice can open the Estimating site (control)',
      !aliceSite.denied && aliceSite.status < 400,
      aliceSite,
    );
    expect(
      'bob is refused the Estimating site in SharePoint',
      bobSite.denied || bobSite.status === 403,
      bobSite,
    );

    const graph = async (persona: 'alice' | 'bob', path: string) => {
      const token = await ctx.token(persona, graphScopes());
      const response = await ctx.fetch(`${GRAPH}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'manual',
      });
      return {
        status: response.status,
        body: response.headers.get('content-type')?.includes('json') ? await response.json() : null,
      };
    };
    const siteInfo = await graph(
      'alice',
      `/sites/${ctx.config.sharepointTenant}.sharepoint.com:${ctx.config.estimatingSite}`,
    );
    const files = siteInfo.body?.id
      ? await graph('alice', `/sites/${siteInfo.body.id}/drive/root/children?$top=20`)
      : { status: 0, body: null };
    const file = (files.body?.value ?? []).find((item: any) => item.file);
    if (!file) {
      expect('found a file in the Estimating site to test with', false, {
        siteInfo: siteInfo.status,
        files: files.status,
      });
    } else {
      const path = `/sites/${siteInfo.body.id}/drive/items/${file.id}/content`;
      const aliceDownload = await graph('alice', path);
      const bobDownload = await graph('bob', path);
      expect(
        'alice can download an Estimating file by id (control)',
        [200, 302].includes(aliceDownload.status),
        aliceDownload.status,
      );
      expect(
        'bob downloading the same file id directly from Graph gets 403/404',
        [403, 404].includes(bobDownload.status),
        { file: file.name, status: bobDownload.status },
      );
    }

    const forward = await ctx.server.forward('mcp-pace', 8102, 18102);
    try {
      const bobToken = await ctx.token('bob', mcpScopes(ctx.config));
      const aliceToken = await ctx.token('alice', mcpScopes(ctx.config));
      const bobJob = await callTool(forward.url, bobToken, 'job_get', {
        jobNumber: ctx.config.openJob,
      });
      expect(
        'bob reads an open Pace job without cost, price or margin',
        bobJob.ok && !COST_FIELDS.some((field) => bobJob.text.includes(`"${field}"`)),
        bobJob.text.slice(0, 800),
      );
      const bobRestricted = await callTool(forward.url, bobToken, 'job_get', {
        jobNumber: ctx.config.restrictedJob,
      });
      expect(
        'bob cannot read a restricted Pace job',
        !bobRestricted.ok && bobRestricted.text.startsWith('Not permitted'),
        bobRestricted.text,
      );
      const bobEstimate = await callTool(forward.url, bobToken, 'estimate_get', {
        jobNumber: ctx.config.openJob,
      });
      expect(
        'bob is refused estimate_get',
        !bobEstimate.ok && bobEstimate.text.startsWith('Not permitted'),
        bobEstimate.text,
      );
      const aliceEstimate = await callTool(forward.url, aliceToken, 'estimate_get', {
        jobNumber: ctx.config.openJob,
      });
      expect(
        'alice (Pace.Estimating) can read the estimate (control)',
        aliceEstimate.ok,
        aliceEstimate.text.slice(0, 300),
      );
      const denials = await ctx.server.check(
        'denials',
        'mcp-pace',
        String(claimsOf(bobToken).oid),
        '15',
      );
      expect(
        "bob's denied Pace calls are in the connector log",
        Number(denials.count) >= 2,
        denials,
      );
    } finally {
      forward.close();
    }

    await manual(
      'SharePoint picker hides the Estimating site from bob',
      'Sign in to the chat as bob, attach from SharePoint: the Estimating site is not listed. Screenshot it for the report.',
    );
  },
};
