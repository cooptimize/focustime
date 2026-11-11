// BD-1: Break down (was Draft stories), the main path, in a real (not demo) session on fake sources, a fake DevOps
// (reads and writes share what was created) and the stub AI provider. A Needs stories row in Plan the week →
// "Break down Feature" → the side panel's Prepare (the item, chips, no children yet, what's sent behind a fold) → Run
// from the note with Enter → Review (edit one, drop one with Undo, reorder by keys, a size, "after <title>", the total)
// → Publish (the exact batch) → Create all → the row no longer says Needs stories. Also: the AI-off panel, focus back
// on the row after Esc, and the old and PV-1 events opening the panel. Edge cases are unit tests (plan/breakdown.test.ts,
// plan/stories.test.ts, actions/story-actions.test.ts). Screenshots at 1920, Text size Larger and the phone (390 wide,
// a 17px root font as on iPhone) when FOCUSTIME_SHOTS is set.
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
import { appReady, liveBrowser, liveContext, liveTeam, ME, T, type LiveBrowser } from "./live.ts";
import { shotBoth, SHOTS } from "./shots.ts";
import type { Page } from "playwright-core";

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

/** 1920 and Larger, then the phone: 390 by 844 with a 17px root font (iPhone's body text), then back. */
async function shotAll(page: Page, name: string) {
  await shotBoth(page, name);
  if (!SHOTS) return;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
  await page.waitForTimeout(250);
  // Nothing wider than the phone.
  const over = await page.evaluate(() => { const p = document.querySelector(".bd-panel"); return p ? p.scrollWidth - p.clientWidth : 0; });
  expect(over, `${name}: the panel is wider than the phone`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png` });
  await page.evaluate(() => void (document.documentElement.style.fontSize = ""));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(150);
}

describe.skipIf(!CHROMIUM)("Break down", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("Needs stories → Break down → Run → drop one, edit one → Create all → the row no longer needs stories", async () => {
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example" } } });
    dv.add(FEATURE, { "System.WorkItemType": "Feature", "System.Title": "My feature with no stories", "System.State": "Active", "System.AreaPath": "Project Ada", "System.IterationPath": "Project Ada\\Sprint 4" });
    const created = () => [...dv.items.values()].filter((i) => i.fields["System.Parent"] === FEATURE);
    const pats = new Map([["Adatum", WRITE_PAT]]);
    const team = liveTeam();
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
    const ctx = { ...base, makeDevOps: ((cfg, tz) => (devops ??= createDevOpsSource({ fetch, log: () => {}, snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "bd1-ado-"))), timeZone: tz, targets: (k) => base.makeDataverse(cfg, tz).devopsTargets(k) }))) as typeof base.makeDevOps };
    await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: ME, tid: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example", signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example", expires: null });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await appReady(page);
      const added = await dispatch(ctx, { action: "weekplan.add", input: { weekStart: WEEK, clientKey: "Adatum", itemId: FEATURE, tier: "must" } });
      expect(added.ok, JSON.stringify(added)).toBe(true);

      // WD-1: a feature with no stories is under Not ready in its client chip's popover on Week, with Break down.
      await page.goto(`${app.url}#/week/${WEEK}`);
      await page.reload();
      await appReady(page);
      const chip = page.locator(".client-chips button.cc-chip", { hasText: /^Adatum/ }).first();
      const row = () => page.locator(".cc-pop .cc-ready li").filter({ has: page.locator(".aw-needs-word") }).first();
      const openAdatum = async () => {
        await chip.waitFor({ timeout: 30_000 });
        if (!(await row().isVisible().catch(() => false))) await chip.click();
        await row().waitFor();
      };
      await openAdatum();
      await page.locator("[data-moment]").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      const panel = page.getByRole("dialog", { name: /^Break down Feature: / });

      // AI off for Adatum: the button says "Break down" (WD-1 review), its tooltip follows the type; the panel says so
      // in one line, with no Run. Esc goes back to the row.
      const button = row().getByRole("button", { name: "Break down", exact: true });
      await expect(button.getAttribute("title")).resolves.toBe("Break down Feature");
      await button.focus();
      await button.press("Enter");
      await panel.getByText("AI is off for Adatum. Ask your FocusTime admin.").waitFor();
      expect(await panel.getByRole("button", { name: "Run" }).count()).toBe(0);
      await shotAll(page, "break-down-ai-off");
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      await expect.poll(() => page.evaluate(() => document.activeElement?.textContent ?? "")).toBe("Break down");

      // ADM-1: an admin turns AI on for FocusTime and allows it for Adatum.
      await team.set("org", "ai.on", true);
      await team.set("client:Adatum", "allow_ai", true);
      await page.reload();
      await appReady(page);
      await openAdatum();

      // The old event name and PV-1's event ({ clientKey, itemId }) open the same panel.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("focustime:draft-stories", { detail: { clientKey: "Adatum", item: { id: 240, title: "My feature with no stories" } } })));
      await panel.getByRole("button", { name: "Run" }).waitFor();
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("focustime:breakdown", { detail: { clientKey: "Adatum", itemId: 240 } })));
      await panel.getByRole("complementary", { name: "The item" }).getByText("#240 My feature with no stories").waitFor();
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });

      await row().getByRole("button", { name: "Break down", exact: true }).click();

      // Prepare: the item with its state chip and description, no children section (it has none), the child type
      // choice (the fake has bugs with stories), and what's sent behind a fold. The removed sections are gone.
      const item = panel.getByRole("complementary", { name: "The item" });
      await item.getByRole("list", { name: "About the item" }).getByText("Active").waitFor();
      await item.locator(".bd-desc").waitFor();
      expect(await item.getByRole("region", { name: "Existing children" }).count()).toBe(0);
      expect(await panel.locator(".bd-head .type-icon").getAttribute("data-type")).toBe("Feature");
      const types = panel.getByRole("radiogroup", { name: "Type to create" });
      await types.getByRole("radio", { name: "User Story", checked: true }).waitFor();
      await panel.getByText(/items under #240 after you review and confirm\./).waitFor();
      await item.getByText("What's sent to the AI").click();
      await item.getByText("3 examples from Adatum's own items, with their children").waitFor();
      for (const gone of ["Found in DevOps", "House style", "gpt-6-luna", "Edit it in Settings", "Text only: no attachments"]) expect(await panel.getByText(gone, { exact: gone === "House style" }).count(), gone).toBe(0);
      await item.getByText("What's sent to the AI").click();
      await shotAll(page, "break-down-prepare");

      // Enter in the note runs.
      const noteBox = panel.getByLabel("Note for the AI (optional)");
      await noteBox.fill("split by report, skip the data model");
      await noteBox.press("Enter");

      // Review: three cards; the second is after the first. Edit the first title, drop the third (Undo, then drop
      // again), move the first down and back with the keys, size the first L; the total follows.
      const card = (t: string) => panel.getByRole("listitem", { name: `Card ${t}` });
      await card("Email the export to finance").getByText("after Add the date filter to the export").waitFor();
      await panel.getByText("3 items · about 4h").waitFor();
      await card("Add the date filter to the export").getByLabel("Title").fill("Add a month filter to the export");
      await card("Email the export to finance").getByText("after Add a month filter to the export").waitFor();
      await card("Review the export with finance").getByRole("button", { name: "Drop" }).click();
      const dropped = panel.getByRole("listitem", { name: "Dropped Review the export with finance" });
      await dropped.getByRole("button", { name: "Undo" }).click();
      await card("Review the export with finance").getByRole("button", { name: "Drop" }).click();
      await dropped.waitFor();
      await panel.getByText("2 items · about 3h").waitFor();
      const titles = () => panel.locator(".bd-card:not(.dropped) .bd-title").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      await card("Add a month filter to the export").locator(".bd-handle").press("ArrowDown");
      await expect.poll(titles).toEqual(["Email the export to finance", "Add a month filter to the export"]);
      await card("Add a month filter to the export").locator(".bd-handle").press("ArrowUp");
      await expect.poll(titles).toEqual(["Add a month filter to the export", "Email the export to finance"]);
      await card("Add a month filter to the export").getByRole("button", { name: "L · 4h" }).click();
      await panel.getByText("2 items · about 5h").waitFor();
      await card("Add a month filter to the export").getByRole("button", { name: "M · 2h" }).click();
      await panel.getByText("2 items · about 3h").waitFor();
      await panel.getByText(/^Why these, and 1 left out$/).waitFor();
      await shotAll(page, "break-down-review");
      await panel.getByRole("button", { name: "Preview 2 items…" }).click();

      // Publish: the exact batch (types, titles, sizes, parent), nothing in DevOps until Create all.
      await panel.getByRole("listitem", { name: "New User Story: Add a month filter to the export" }).waitFor();
      await panel.getByRole("listitem", { name: "New User Story: Email the export to finance" }).getByText("S · 1h").waitFor();
      expect(created()).toHaveLength(0);
      await shotAll(page, "break-down-publish");
      await panel.getByRole("button", { name: "Create all" }).click();
      await panel.getByText(/^Created 2 items under/).waitFor();
      expect(created().map((i) => i.fields["System.Title"])).toEqual(["Add a month filter to the export", "Email the export to finance"]);
      expect(created().some((i) => i.fields["System.Title"] === "Review the export with finance")).toBe(false);
      await panel.getByRole("button", { name: "Done" }).click();
      await panel.waitFor({ state: "detached" });

      // The chip refreshes: the feature has stories now, so it isn't under Not ready and the badge goes.
      await expect.poll(() => chip.locator(".cc-badge").count(), { timeout: 30_000 }).toBe(0);
      await expect(page.locator(".cc-pop .aw-needs-word").count()).resolves.toBe(0);

      // Prepare again (PV-1's event): now with its existing children, and the earlier draft as one muted line.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("focustime:breakdown", { detail: { clientKey: "Adatum", itemId: 240 } })));
      await panel.getByRole("region", { name: "Existing children" }).getByText("Email the export to finance").waitFor();
      await panel.getByRole("button", { name: "Open that draft" }).waitFor();
      await shotAll(page, "break-down-prepare-children");
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
