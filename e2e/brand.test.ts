// Step 17.5: the opening, the Close out reverse and where Lumen may appear (browser, demo mode, clock pinned to
// Mon Nov 2, 9:30 AM). Behavior only: no colors, sizes or curves.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Records, from the first paint, whether the loader, the unroll and the sweep ever appeared. */
const WATCH = () => {
  const seen = { loader: false, unroll: false, sweep: false, lumen: [] as string[] };
  (window as unknown as { __seen: typeof seen }).__seen = seen;
  new MutationObserver(() => {
    if (document.querySelector('[data-opening="loader"]')) seen.loader = true;
    if (document.querySelector(".unroll")) seen.unroll = true;
    if (document.querySelector(".loading-sweep")) seen.sweep = true;
    document.querySelectorAll("[data-lumen]").forEach((e) => seen.lumen.push(e.getAttribute("data-lumen")!));
  }).observe(document, { subtree: true, childList: true, attributes: true });
};
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: { loader: boolean; unroll: boolean; sweep: boolean; lumen: string[] } }).__seen);

/** A new page whose first week loads take `delay` ms (so the loader shows), with the opening watched. */
async function slowOpen(ctx: BrowserContext, delay: number): Promise<Page> {
  // Every week load of the opening waits until the same moment (dev mode's StrictMode asks twice).
  let until: number | null = null;
  await ctx.route("**/api/action", async (route) => {
    if ((route.request().postData() ?? "").includes('"week.load"')) {
      until ??= Date.now() + delay;
      await new Promise((r) => setTimeout(r, Math.max(0, until! - Date.now())));
    }
    await route.continue();
  });
  await ctx.addInitScript(WATCH);
  const page = await ctx.newPage();
  await page.goto(h.url);
  return page;
}

/** Today's must pick (demo: Cooptimize's "Timesheet summary query" in the Monday AM block), done. */
async function mustDone(page: Page): Promise<void> {
  const add = await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "S" });
  expect(add.ok).toBe(true);
  const w = await call(page, "week.load", {});
  const pick = w.data.plan["2026-11-02"].picks.find((p: { itemId: number }) => p.itemId === 4411);
  expect((await call(page, "pick.mark_done", { id: pick.id, done: true })).ok).toBe(true);
}

describe.skipIf(!CHROMIUM)("Brand: the opening, the Close out reverse and Lumen's places (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
    const { page } = await freshPage(h); // demo on, hints dismissed (cookies and storage are per context below)
    await page.close();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Lumen is absent in Week, Today, Plan the day, Check-in and Roadmap", async () => {
    const { page, errors } = await freshPage(h);
    for (const hash of ["#/today", "#/week", "#/week/plan", "#/today/plan", "#/today/checkin", "#/roadmap", "#/roadmap/ahead"]) {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.waitForTimeout(700);
      expect(await page.locator(".lumen, .lumen-loading, .unroll, .bent-mark, .lockup, .brand-stage, [data-lumen]").count(), hash).toBe(0);
    }
    // The top bar's mark is the week, not Lumen; it goes to Today.
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".brand-home").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/today");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a slow first load shows the loader (each source waiting, then done), then unrolls into the top bar", async () => {
    const ctx = await h.browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await slowOpen(ctx, 1500);
    await page.waitForSelector('[data-opening="loader"]', { timeout: 30_000 });
    expect(await page.locator(".brand-loading-text li").allTextContents()).toEqual(["Dataverse waiting", "Outlook waiting", "Google waiting", "DevOps waiting"]);
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    const s = await seen(page);
    expect(s).toMatchObject({ loader: true, unroll: true, sweep: true });
    await expect(page.locator(".topbar .brand-home .week-mark").count()).resolves.toBe(1);
    await ctx.close();
  }, T);

  it("reduced motion (the system setting): the loader holds still, no unroll; Close out cuts straight to Today", async () => {
    const ctx = await h.browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
    const page = await slowOpen(ctx, 1500);
    await page.waitForSelector('[data-opening="loader"]', { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.waitForSelector(".topbar");
    expect(await seen(page)).toMatchObject({ loader: true, unroll: false, sweep: false });
    // Close out with today's musts done: no reverse, the moment shows Lumen still, then Today.
    await mustDone(page);
    await page.evaluate(() => (location.hash = "#/today/closeout"));
    await page.locator(".closeout .done-btn").click();
    await page.getByText("Musts done. See you tomorrow.").waitFor();
    await expect(page.locator(".brand-stage [data-lumen]").getAttribute("data-lumen")).resolves.toBe("still");
    await page.keyboard.press("Space"); // any key skips
    await page.waitForSelector(".brand-stage", { state: "detached" });
    const s = await seen(page);
    expect(s.unroll).toBe(false);
    expect(s.lumen.every((p) => p === "still")).toBe(true);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/today");
    await ctx.close();
  }, T);

  it("reduced motion (Settings > Display): the same, after it's saved", async () => {
    const ctx = await h.browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const first = await ctx.newPage();
    await first.goto(h.url);
    await first.waitForSelector(".topbar", { timeout: 60_000 });
    expect((await call(first, "ui.set_reduce_motion", { on: true })).ok).toBe(true);
    await first.reload(); // the week brings the setting; it's kept locally for the next opening
    await first.waitForSelector(".topbar");
    await first.waitForFunction(() => document.documentElement.hasAttribute("data-reduce-motion"));
    await first.close();
    const page = await slowOpen(ctx, 1500);
    await page.waitForSelector('[data-opening="loader"]', { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    expect(await seen(page)).toMatchObject({ loader: true, unroll: false, sweep: false });
    expect((await call(page, "ui.set_reduce_motion", { on: false })).ok).toBe(true);
    await ctx.close();
  }, T);

  it("Close out plays the reverse, then the musts moment (Lumen bobs), then Today; a click skips", async () => {
    const { page, errors } = await freshPage(h);
    await page.addInitScript(WATCH);
    await page.reload();
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await mustDone(page);
    await page.evaluate(() => (location.hash = "#/today/closeout"));
    await page.locator(".closeout .done-btn").click();
    await page.waitForSelector('[data-close="unroll"]');
    await page.getByText("Musts done. See you tomorrow.").waitFor();
    await page.waitForSelector('[data-close="moment"] [data-lumen="bob"]');
    await page.locator(".brand-stage").click();
    await page.waitForSelector(".brand-stage", { state: "detached" });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/today");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
