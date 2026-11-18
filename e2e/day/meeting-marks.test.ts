// DY-1: a meeting that is one of a series on the calendar carries a repeat mark ("Repeats" to a screen reader and on
// hover) wherever it is drawn on Day and Week; a registered call names its type instead, and its type heads its menu.
// Known only from the calendar (the demo's series), never from a title. The phone's Day gains only these marks.
// Demo mode, Mon Nov 2: the standups, Northwind weekly status (a registered call) and Atlas refinement repeat.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 120_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);

async function day(page: Page, hash = "#/day") {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.locator(".day-view .card-client").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
}
const event = (page: Page, scope: string, title: string) => page.locator(`${scope} .event`, { has: page.locator(".ev-title", { hasText: title }) }).first();

describe.skipIf(!CHROMIUM)("DY-1: meeting marks (browser, demo mode, 3:55 PM)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-02T15:55:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Day's Timeline: Repeats on a series only, none on a single meeting or a personal one-off; a call shows its type and no repeat mark", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ui.set_day_fold", { on: false });
    await call(page, "ui.set_today_timeline", { show: true });
    await day(page);
    const standup = event(page, ".day-view", "Team standup");
    await expect(standup.getByRole("img", { name: "Repeats" }).count()).resolves.toBe(1);
    await expect(standup.locator(".repeat-mark").getAttribute("title")).resolves.toBe("Repeats");
    await expect(event(page, ".day-view", "Proposal review with Jordan").locator(".repeat-mark").count()).resolves.toBe(0);
    await expect(event(page, ".day-view", "Northwind data model review").locator(".repeat-mark").count()).resolves.toBe(0);
    await expect(event(page, ".day-view", "Dentist").locator(".repeat-mark").count()).resolves.toBe(0);
    const weekly = event(page, ".day-view", "Northwind weekly status");
    await expect(weekly.locator(".repeat-mark").count()).resolves.toBe(0);
    const mark = weekly.locator(".call-mark");
    await expect(mark.locator(".call-type").textContent()).resolves.toBe("Weekly status call");
    await expect(mark.getAttribute("aria-label")).resolves.toMatch(/^Weekly status call, /);
    await expect(mark.getAttribute("title")).resolves.toMatch(/^Weekly status call · /);
    // Its menu leads with the call, under its type.
    await weekly.locator(".ev-meta").click();
    await expect(page.locator(".menu-group").first().textContent()).resolves.toBe("Weekly status call");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day's cards (the meetings list) and the block panel's agenda carry the same marks", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ui.set_day_fold", { on: false });
    await call(page, "ui.set_today_timeline", { show: false });
    await day(page);
    const am = page.locator('.day-view [data-half="AM"]');
    await am.locator(".card-agenda-fold").click();
    const row = (t: string) => am.locator(".card-events li", { hasText: t });
    await expect(row("Team standup").getByRole("img", { name: "Repeats" }).count()).resolves.toBe(1);
    await expect(row("Proposal review").locator(".repeat-mark").count()).resolves.toBe(0);
    // The panel on the afternoon: its agenda.
    await day(page, "#/day/2026-11-02/PM");
    const panel = page.locator("aside.block-panel");
    await panel.locator(".bp-meet-line").click();
    const weekly = panel.locator(".bp-meetings li", { hasText: "Northwind weekly status" });
    await expect(weekly.locator(".call-type").textContent()).resolves.toBe("Weekly status call");
    await expect(weekly.locator(".repeat-mark").count()).resolves.toBe(0);
    await expect(panel.locator(".bp-meetings li", { hasText: "data model review" }).locator(".repeat-mark, .call-mark").count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Week's rail carries them: the mark where titles show, and in every meeting's hover", async () => {
    const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });
    await call(page, "ui.set_show_timelines", { show: true });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.reload();
    await page.locator("main.grid:not(.day-only) :is(.event, .r-ev)").first().waitFor({ timeout: 30_000 });
    const withTitles = await page.locator("main.grid:not(.day-only) .event .ev-title").count();
    if (withTitles) {
      await expect(event(page, "main.grid:not(.day-only)", "Atlas backlog refinement").getByRole("img", { name: "Repeats" }).count()).resolves.toBe(1);
      await expect(event(page, "main.grid:not(.day-only)", "Harbor sprint planning").locator(".repeat-mark").count()).resolves.toBe(0);
    }
    // Every rail's meeting says it on hover, titles or not.
    await expect(page.locator('main.grid:not(.day-only) :is(.event, .r-ev)[title*="Atlas backlog refinement"]').first().getAttribute("title")).resolves.toMatch(/Repeats/);
    await expect(page.locator('main.grid:not(.day-only) :is(.event, .r-ev)[title*="Harbor sprint planning"]').first().getAttribute("title")).resolves.not.toMatch(/Repeats/);
    await expect(page.locator('main.grid:not(.day-only) :is(.event, .r-ev)[title*="Northwind weekly status"]').first().getAttribute("title")).resolves.toMatch(/Weekly status call$/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("DY-1: the phone's Day gains only the marks (browser, demo mode, 8:50 AM)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-02T08:50:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Next names the standup with its repeat mark; no fold arrows, no folds, the header scrolls as before", async () => {
    const page = await phonePage(h, 390);
    await page.locator(".pn-next").waitFor({ timeout: 30_000 });
    const next = page.locator(".pn-next-row.meeting");
    await expect(next.locator(".pn-next-title").textContent()).resolves.toBe("Team standup");
    await expect(next.getByRole("img", { name: "Repeats" }).count()).resolves.toBe(1);
    expect(await page.locator(".day-fold-arrow, .day-folded").count()).toBe(0);
    const head = page.locator(".day-view > .day-bar");
    if (await head.count()) await expect(head.evaluate((el) => getComputedStyle(el).position)).resolves.not.toBe("sticky");
    await page.close();
  }, T);
});
