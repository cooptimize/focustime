// DM-1: Reset demo (Settings › Demo) puts a demo session back exactly as it started, in under 5 seconds: a capture, a
// pick, a DevOps state change and a resolved conversation are all gone after it, and the counts match the first load.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 240_000;
let h: Harness;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What the demo's start looks like, in numbers and states (never the whole payload: times move between calls). */
async function snapshot(page: Page) {
  const conv = (await call(page, "conversations.list", {})).data;
  const promises = (await call(page, "my_promises.list", {})).data;
  const week = (await call(page, "week.load", {})).data;
  const wp = (await call(page, "weekplan.load", {})).data;
  return {
    needsYou: conv.needsYou.map((c: { title: string }) => c.title).sort(),
    inProgress: conv.inProgress.length,
    teammates: conv.teammates.length,
    promises: promises.promises.map((p: { what: string; state: string }) => `${p.what}:${p.state}`).sort(),
    captures: week.captures,
    picks: Object.values(week.plan ?? {}).flatMap((d: any) => d.picks ?? []).length, // eslint-disable-line @typescript-eslint/no-explicit-any
    followUps: week.openFollowUps,
    drafts: wp.drafts.length,
  };
}

describe.skipIf(!CHROMIUM)("Reset demo (DM-1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop(), T);

  it("puts every change back as it started, in under 5 seconds", async () => {
    const { page, errors } = await freshPage(h);
    const start = await snapshot(page);
    expect(start.needsYou.length).toBeGreaterThan(0);

    // Change things: a capture, a pick, a DevOps write, a conversation resolved.
    expect((await call(page, "capture.add", { text: "Ask Dana about the export columns", clientKey: "Northwind" })).ok).toBe(true);
    expect((await call(page, "pick.add", { date: "2026-11-02", half: "PM", clientKey: "Northwind", itemId: 1112, size: "M" })).ok).toBe(true);
    const p = await call(page, "devops.preview", { clientKey: "Northwind", change: { kind: "state", itemId: 1112, state: "Active" } });
    expect((await call(page, "devops.confirm", { previewId: p.data.preview.previewId })).ok).toBe(true);
    const conv = (await call(page, "conversations.list", {})).data.needsYou[0];
    expect((await call(page, "conversations.resolve", { id: conv.id })).ok).toBe(true);
    expect(await snapshot(page)).not.toEqual(start);

    // Settings › Demo › Reset demo: the page reloads on Today.
    await page.evaluate(() => (location.hash = "#/settings/demo"));
    const button = page.getByRole("button", { name: "Reset demo" });
    await button.waitFor({ timeout: 30_000 });
    const t0 = Date.now();
    await Promise.all([page.waitForEvent("load", { timeout: 15_000 }), button.click()]);
    await page.locator(".topbar").waitFor({ timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/today");

    expect(await snapshot(page)).toEqual(start);
    const item = await call(page, "devops.preview", { clientKey: "Northwind", change: { kind: "state", itemId: 1112, state: "Active" } });
    expect(item.data.preview.fields.find((f: { label: string }) => f.label === "State")?.before).toBe("New");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the command menu's Reset demo opens Settings › Demo", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Reset demo");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Reset demo" }).waitFor({ timeout: 10_000 });
    await expect(page.evaluate(() => location.hash)).resolves.toBe("#/settings/data/demo-reset");
    await page.close();
  }, T);
});
