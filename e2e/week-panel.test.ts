// PV-1: Week's block panel, the main path, in a real (not demo) session on fake sources and a fake DevOps write side.
// Select an Adatum block → its panel lists only my stories, grouped by feature (features are headers) → drag a story
// onto another day's block (the fit shows on the target) → drag it back → under a feature on this week's plan with no
// stories of mine, "Add a story for me" → preview → Confirm → it is in the block. Edge cases are unit tests
// (plan/blockstories.test.ts, plan/weekdrop.test.ts, actions/devops-write.test.ts). Screenshots at 1920 and Text size
// Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import { dispatch } from "../actions/dispatch.ts";
import { createSnapshotStore } from "../host/local/snapshots.ts";
import { Pat } from "../sources/devops/pat.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT, type FakeItem } from "../sources/devops/write-fakes.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { CHROMIUM } from "./harness.ts";
import { liveBrowser, liveContext, ME, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";
import type { Locator, Page } from "playwright-core";

const WEEK = "2026-11-02";
const FEATURE = 240; // "My feature with no stories" (the planweek fake)

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

/** The read side: the planweek fake plus the stories the write fake created (mine, under their feature). */
function readFetch(created: () => FakeItem[]) {
  const ado = fakeDevOps({ contoso: "planweek" });
  const extra = async (input: string | URL, init: RequestInit | undefined, ids: number[]) => {
    const base = (await (await ado.fetch(input, init)).json()) as { workItems: { id: number }[] };
    return json({ ...base, workItems: [...base.workItems, ...ids.map((id) => ({ id }))] });
  };
  return (async (input: string | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(input)).pathname);
    const mine = created().map((i) => i.id);
    if (path.endsWith("/_apis/wit/wiql") && mine.length) {
      const q = (JSON.parse(String(init?.body)) as { query: string }).query;
      if (q.includes("[System.AssignedTo] = 'me@contoso.example'")) return extra(input, init, mine);
      const parents = q.match(/\[System\.Parent\] IN \(([\d, ]+)\)/)?.[1]?.split(",").map(Number) ?? [];
      if (parents.includes(FEATURE)) return extra(input, init, mine);
    }
    if (path.endsWith("/_apis/wit/workitemsbatch")) {
      const body = JSON.parse(String(init?.body)) as { ids: number[]; fields: string[] };
      const ours = created().filter((i) => body.ids.includes(i.id));
      if (ours.length) {
        const rest = body.ids.filter((id) => !ours.some((i) => i.id === id));
        const base = rest.length ? ((await (await ado.fetch(input, { ...init, body: JSON.stringify({ ...body, ids: rest }) })).json()) as { value: unknown[] }).value : [];
        const all = (i: FakeItem): Record<string, unknown> => ({ ...i.fields, "System.Id": i.id, "System.ChangedDate": "2026-11-02T14:40:00Z" });
        return json({ count: rest.length + ours.length, value: [...base, ...ours.map((i) => ({ id: i.id, fields: Object.fromEntries(Object.entries(all(i)).filter(([k]) => body.fields.includes(k))) }))] });
      }
    }
    return ado.fetch(input, init);
  }) as typeof fetch;
}

/** Drags with real mouse moves, so the page sees dragstart, dragover on the way and drop on the target. */
async function drag(page: Page, from: Locator, to: Locator, before?: () => Promise<void>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await before?.();
  await page.mouse.up();
}

describe.skipIf(!CHROMIUM)("Week block panel (PV-1)", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("panel groups my stories by feature → drag to another day and back → Add a story for me → it is in the block", async () => {
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example" } } });
    dv.add(FEATURE, { "System.WorkItemType": "Feature", "System.Title": "My feature with no stories", "System.State": "Active", "System.AreaPath": "Project Ada", "System.IterationPath": "Project Ada\\Sprint 4" });
    const created = () => [...dv.items.values()].filter((i) => i.fields["System.Parent"] === FEATURE);
    const pats = new Map([["Adatum", WRITE_PAT]]);
    const base = await liveContext({
      extra: {
        devopsWriter: createDevOpsWriter({ fetch: dv.fetch, log: () => {} }),
        writePats: { get: async (k) => new Pat(pats.get(k) ?? ""), set: async (k, v) => void pats.set(k, v), clear: async (k) => void pats.delete(k) },
      },
    });
    const fetch = readFetch(created);
    let devops: ReturnType<typeof createDevOpsSource> | null = null;
    const ctx = { ...base, makeDevOps: ((cfg, tz) => (devops ??= createDevOpsSource({ fetch, log: () => {}, snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "pv1-ado-"))), timeZone: tz, targets: (k) => base.makeDataverse(cfg, tz).devopsTargets(k) }))) as typeof base.makeDevOps };
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
      await page.goto(`${app.url}#/week`);
      await page.reload();
      await page.locator(".topbar").waitFor();
      await page.locator("[data-moment]").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      const blocks = page.locator(".half.focus", { has: page.locator(".card-client", { hasText: "Adatum" }) });
      await blocks.first().waitFor();
      expect(await blocks.count()).toBeGreaterThan(1);
      const mon = blocks.nth(0);
      const tue = blocks.nth(1);

      // Select Monday PM: the panel lists my stories under their features; features are headers only.
      await mon.click({ position: { x: 120, y: 200 } });
      const panel = page.getByRole("region", { name: "Your stories for Adatum" });
      await panel.waitFor();
      const story = panel.locator(".ps-row[data-story]").first();
      await story.waitFor();
      const id = Number(await story.getAttribute("data-story"));
      expect(await panel.locator(".ps-row[data-story='240']").count()).toBe(0);
      const empty = panel.getByRole("group", { name: /#240 My feature with no stories/ });
      await empty.getByText("No stories for you yet").waitFor();
      await shotBoth(page, "week-panel-groups", panel);
      await shotBoth(page, "week-panel-no-stories", empty);

      // Drag it onto Tuesday's block: the target shows its fit while the story is over it; Undo after the drop.
      await drag(page, story, tue, async () => {
        await tue.locator(".drop-tip").waitFor();
        expect(await tue.locator(".drop-tip").innerText()).toMatch(/^\d+h (of \d+h free|over)$/);
        await shotBoth(page, "week-panel-drag-fit");
      });
      await page.locator(".undo-toast", { hasText: "Added to Tue PM" }).waitFor();
      await panel.locator(`.ps-row[data-story='${id}'] .ps-planned`, { hasText: "Planned · Tue PM" }).waitFor();
      const onTue = tue.locator("li[draggable='true']").first();
      await onTue.waitFor();

      // Move it back from the card to Monday.
      await drag(page, onTue, mon);
      await page.locator(".undo-toast", { hasText: "Moved to Mon PM" }).waitFor();
      await panel.locator(`.ps-row[data-story='${id}'] .ps-here`).waitFor();
      expect(await tue.locator("li[draggable='true']").count()).toBe(0);

      // Add a story for me under the committed feature with none: preview → Confirm → it is in this block.
      const box = empty.getByRole("textbox");
      await box.fill("Check the export with finance");
      await box.press("Enter");
      const write = page.locator(".commit");
      await write.waitFor();
      await shotBoth(page, "week-panel-add-for-me-preview");
      await write.click();
      await page.getByText(/created|Created/).first().waitFor();
      await page.keyboard.press("Escape");
      expect(created().map((i) => i.fields["System.Title"])).toEqual(["Check the export with finance"]);
      // The card puts it under its feature (DevOps is read again after the create).
      await mon.locator(".card-feat", { hasText: "My feature with no stories" }).waitFor();
      await mon.getByText("Check the export with finance").waitFor();
      await shotBoth(page, "week-cards-grouped", mon);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
