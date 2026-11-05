// DS-1: Draft stories, the main path, in a real (not demo) session on fake sources, a fake DevOps (reads and writes
// share what was created) and the stub AI provider. A Needs stories row in Plan the week → Draft stories → Prepare
// (signals, this client's examples, the cost) → Run → Review (edit one card, drop one; a dependency shows as
// "after <title>") → Publish (the exact batch) → Create → the row no longer says Needs stories. The AI-off state is
// the button "Draft stories (AI is off for Adatum)". Edge cases are unit tests (plan/stories.test.ts,
// actions/story-actions.test.ts). Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import { dispatch } from "../actions/dispatch.ts";
import { stubProvider } from "../ai/stub.ts";
import { createSnapshotStore } from "../host/local/snapshots.ts";
import { aCoopProposal, anAiApp, aProposalsAnswer } from "../test/builders/index.ts";
import { Pat } from "../sources/devops/pat.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT, type FakeItem } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHROMIUM } from "./harness.ts";
import { liveBrowser, liveContext, liveTeam, ME, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";

const FEATURE = 240;
const WEEK = "2026-11-02";
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

/** Three features of Adatum's own project with stories, for the examples (ids the planweek fake doesn't use). */
const POOL: Record<number, { title: string; parent: number | null; type: string; description: string }> = {
  701: { title: "Weekly sales report export", parent: null, type: "Feature", description: "Sales wants the week's numbers as a file." },
  702: { title: "Invoice report for finance", parent: null, type: "Feature", description: "Finance checks invoices monthly." },
  703: { title: "Stock report by store", parent: null, type: "Feature", description: "Stores see stock levels." },
  711: { title: "Add the week filter", parent: 701, type: "User Story", description: "Pick a week." },
  712: { title: "Send the file by email", parent: 701, type: "User Story", description: "Email on Monday." },
  713: { title: "Add the month filter", parent: 702, type: "User Story", description: "Pick a month." },
  714: { title: "Show totals per customer", parent: 702, type: "User Story", description: "One row each." },
  715: { title: "Add the store filter", parent: 703, type: "User Story", description: "Pick a store." },
  716: { title: "Export as CSV", parent: 703, type: "User Story", description: "For Excel." },
};

/** The read side: the planweek fake, plus the feature's comments, the pool, and the stories the write fake created. */
function readFetch(created: () => FakeItem[]) {
  const ado = fakeDevOps({ contoso: "planweek" });
  const fieldsOf = (id: number, want: string[]) => {
    const p = POOL[id];
    const w = created().find((i) => i.id === id);
    const all: Record<string, unknown> = p
      ? { "System.Id": id, "System.Title": p.title, "System.WorkItemType": p.type, "System.State": "Closed", "System.Description": `<p>${p.description}</p>`, "System.AreaPath": "Project Ada", "System.ChangedDate": "2026-10-01T00:00:00Z", ...(p.parent ? { "System.Parent": p.parent } : {}) }
      : w ? { ...w.fields, "System.Id": id, "System.ChangedDate": "2026-11-02T14:00:00Z" } : {};
    return { id, fields: Object.fromEntries(Object.entries(all).filter(([k]) => want.includes(k))) };
  };
  return (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const path = decodeURIComponent(u.pathname);
    if (path.endsWith(`/_apis/wit/workItems/${FEATURE}/comments`)) return json({ totalCount: 2, comments: [{ text: "<p>Finance also wants a date filter.</p>", createdDate: "2026-10-30T15:00:00Z" }, { text: "<div>[Coop brief v1]<br>Monthly export, split by report</div>", createdDate: "2026-10-20T15:00:00Z" }] });
    if (path.endsWith("/_apis/wit/wiql")) {
      const q = (JSON.parse(String(init?.body)) as { query: string }).query;
      if (q.includes(`[System.Parent] = ${FEATURE}`)) return json({ workItems: created().map((i) => ({ id: i.id })) });
      if (q.includes("[System.ChangedDate] >=")) return json({ workItems: [{ id: 701 }, { id: 702 }, { id: 703 }] });
      if (/\[System\.Parent\] IN \(701, 702, 703\)/.test(q)) return json({ workItems: [711, 712, 713, 714, 715, 716].map((id) => ({ id })) });
      const parents = q.match(/\[System\.Parent\] IN \(([\d, ]+)\)/)?.[1]?.split(",").map(Number) ?? [];
      if (parents.includes(FEATURE)) {
        const base = (await (await ado.fetch(input, init)).json()) as { workItems: { id: number }[] };
        return json({ workItems: [...base.workItems, ...created().map((i) => ({ id: i.id }))] });
      }
    }
    if (path.endsWith("/_apis/wit/workitemsbatch")) {
      const body = JSON.parse(String(init?.body)) as { ids: number[]; fields: string[] };
      const mine = body.ids.filter((id) => POOL[id] || created().some((i) => i.id === id));
      if (mine.length) {
        const rest = body.ids.filter((id) => !mine.includes(id));
        const base = rest.length ? ((await (await ado.fetch(input, { ...init, body: JSON.stringify({ ...body, ids: rest }) })).json()) as { value: unknown[] }).value : [];
        return json({ count: mine.length + base.length, value: [...base, ...mine.map((id) => fieldsOf(id, body.fields))] });
      }
    }
    return ado.fetch(input, init);
  }) as typeof fetch;
}

describe.skipIf(!CHROMIUM)("Draft stories", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("Needs stories → Prepare → Run → edit and drop a card → Publish → the row no longer needs stories", async () => {
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example" } } });
    dv.add(FEATURE, { "System.WorkItemType": "Feature", "System.Title": "My feature with no stories", "System.State": "Active", "System.AreaPath": "Project Ada", "System.IterationPath": "Project Ada\\Sprint 4" });
    const created = () => [...dv.items.values()].filter((i) => i.fields["System.Parent"] === FEATURE);
    const pats = new Map([["Adatum", WRITE_PAT]]);
    const answer = aProposalsAnswer({
      feature_id: FEATURE,
      rationale: "The feature has no stories yet: the filter first, then delivery, then a check with finance.",
      set_aside: [{ title: "A new data model", why: "out_of_scope", existing_item_id: null, reason: "The note says to skip it." }],
      proposals: [
        aCoopProposal({ id: "P1", title: "Add the date filter to the export", depends_on: [] }),
        aCoopProposal({ id: "P2", title: "Email the export to finance", description: "Send the file on the first workday.", acceptance_criteria: ["Finance gets the file by email"], depends_on: ["P1"], size: "S" }),
        aCoopProposal({ id: "P3", title: "Review the export with finance", description: "A short call.", acceptance_criteria: [], depends_on: [], size: null, open_questions: ["Who signs off?"] }),
      ],
    });
    const team = liveTeam();
    const base = await liveContext({
      team,
      extra: {
        devopsWriter: createDevOpsWriter({ fetch: dv.fetch, log: () => {} }),
        writePats: { get: async (k) => new Pat(pats.get(k) ?? ""), set: async (k, v) => void pats.set(k, v), clear: async (k) => void pats.delete(k) },
        ai: { app: anAiApp({ provider: "openai", model: "gpt-6-luna", prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 } }), provider: async () => stubProvider({ respond: () => JSON.stringify(answer) }), appSpend: { get: async () => 0, add: async () => {} } },
      },
    });
    const fetch = readFetch(created);
    let devops: ReturnType<typeof createDevOpsSource> | null = null;
    const ctx = { ...base, makeDevOps: ((cfg, tz) => (devops ??= createDevOpsSource({ fetch, log: () => {}, snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "ds1-ado-"))), timeZone: tz, targets: (k) => base.makeDataverse(cfg, tz).devopsTargets(k) }))) as typeof base.makeDevOps };
    await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: ME, tid: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example", signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example", expires: null });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();
      const added = await dispatch(ctx, { action: "weekplan.add", input: { weekStart: WEEK, clientKey: "Adatum", itemId: FEATURE, tier: "must" } });
      expect(added.ok, JSON.stringify(added)).toBe(true);

      // AI off for Adatum: the button says so (and goes to Settings); the Coop brief stays.
      await page.goto(`${app.url}#/week/plan/${WEEK}`);
      const row = () => page.locator(".pw-needs").filter({ has: page.locator(".pw-needs-word") }).first();
      const openAdatum = async () => {
        const line = page.getByRole("button", { name: /^Adatum/ }).first();
        if (!(await row().isVisible().catch(() => false)) && (await line.isVisible().catch(() => false))) await line.click();
      };
      await openAdatum();
      await row().getByRole("button", { name: "Draft stories (AI is off for Adatum)" }).waitFor();
      await row().getByRole("button", { name: "Coop brief" }).waitFor();
      await page.locator("[data-moment]").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await shotBoth(page, "draft-stories-ai-off", row());

      // ADM-1: an admin turns AI on for FocusTime and allows it for Adatum.
      await team.set("org", "ai.on", true);
      await team.set("client:Adatum", "allow_ai", true);
      await page.reload();
      await page.locator(".topbar").waitFor();
      await openAdatum();
      await row().getByRole("button", { name: "Draft stories", exact: true }).click();

      // Prepare: the signals found, the client's own examples, the house style, the story type and the cost.
      const sheet = page.getByRole("dialog", { name: /^Draft stories: / });
      await sheet.getByRole("region", { name: "Found in DevOps" }).waitFor();
      await sheet.getByText("2 of 2, newest first; 1 Coop block as one line").waitFor();
      const examples = sheet.getByRole("region", { name: /^Examples from Adatum/ });
      await examples.getByText("Weekly sales report export").waitFor();
      // WT-1: the type to create, with its icon first, from the feature's valid child types.
      const runLine = sheet.locator(".ds-run-line");
      await runLine.getByText(/items under #240/).waitFor();
      // The fake has no team settings, so bugs sit with stories: a choice, the most common type first.
      expect(await runLine.getByLabel("Type to create").inputValue()).toBe("User Story");
      expect(await runLine.locator('.type-icon svg[aria-hidden="true"]').count()).toBe(1);
      expect(await sheet.locator(".ds-feature .type-icon").getAttribute("title")).toBe("Feature");
      await sheet.getByText(/at gpt-6-luna/).waitFor();
      await sheet.getByLabel("Note for the AI (optional)").fill("split by report, skip the data model");
      await shotBoth(page, "draft-stories-prepare", sheet);
      await sheet.getByRole("button", { name: "Run" }).click();

      // Review: three cards; the second is after the first. Edit the first title, drop the third.
      const card = (t: string | RegExp) => sheet.getByRole("listitem", { name: typeof t === "string" ? `Card ${t}` : t });
      await card("Email the export to finance").getByText("after Add the date filter to the export").waitFor();
      await card("Add the date filter to the export").getByLabel("Title").fill("Add a month filter to the export");
      await card("Email the export to finance").getByText("after Add a month filter to the export").waitFor();
      await card("Review the export with finance").getByRole("button", { name: "Drop" }).click();
      await card("Review the export with finance").getByRole("button", { name: "Keep" }).waitFor();
      await shotBoth(page, "draft-stories-review", sheet);
      await sheet.getByRole("button", { name: "Publish 2 stories…" }).click();

      // Publish: the exact batch, nothing in DevOps until Create.
      await sheet.getByRole("region", { name: "New User Story: Add a month filter to the export" }).waitFor();
      await sheet.getByRole("region", { name: "New User Story: Email the export to finance" }).getByText("S · 1h (not written to DevOps)").waitFor();
      expect(created()).toHaveLength(0);
      await shotBoth(page, "draft-stories-publish", sheet);
      await sheet.getByRole("button", { name: "Create 2 stories in DevOps" }).click();
      await sheet.getByText(/^Created 2 stories under #240/).waitFor();
      expect(created().map((i) => i.fields["System.Title"])).toEqual(["Add a month filter to the export", "Email the export to finance"]);
      expect(created().some((i) => i.fields["System.Title"] === "Review the export with finance")).toBe(false);
      await sheet.getByRole("button", { name: "Done" }).click();
      await sheet.waitFor({ state: "detached" });

      // The row refreshes: the feature has stories now, so it no longer says Needs stories.
      await page.locator(".pw-count").filter({ hasText: "2 stories" }).first().waitFor();
      await expect(page.locator(".pw-needs-word").count()).resolves.toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
