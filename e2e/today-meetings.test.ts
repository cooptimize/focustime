// Step 17.6: today's meetings on Today › Now (inside each block, all-day and outside-hours lines) and in Plan the day
// (each block's agenda open by default), with Now and Next. Demo mode, clock pinned to Mon Nov 2, 9:30 AM.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("Meetings on Today and Plan the day (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Today › Now lists each block's meetings in time order, the past one dimmed and the next one marked", async () => {
    const { page, errors } = await freshPage(h);
    const morning = page.locator(".today-block", { hasText: "Morning" }).locator(".day-cal li");
    await expect.poll(() => morning.count()).toBeGreaterThan(0);
    const rows = await morning.allTextContents();
    expect(rows[0]).toMatch(/^9:00–9:15\s*Team standup/);
    expect(rows.some((r) => /Proposal review with Jordan\s*Next/i.test(r))).toBe(true);
    await expect(morning.first().getAttribute("class")).resolves.toContain("when-past");
    // Exactly one Next on the page; the afternoon block has its own meetings.
    await expect(page.locator(".today-view .cal-tag.next").count()).resolves.toBe(1);
    await expect(page.locator(".today-block", { hasText: "Afternoon" }).locator(".day-cal li").count()).resolves.toBeGreaterThan(0);
    // A meeting opens the same event menu as on Week.
    await page.locator(".today-view .day-cal li", { hasText: "Proposal review" }).click();
    await expect(page.locator("[role=menu]").count()).resolves.toBe(1);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Plan the day shows each block's agenda without a click, with Next on the same meeting; the link folds it", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("p");
    await page.waitForSelector(".pd2-left");
    const agenda = page.locator(".pd2-block", { hasText: "Cooptimize" }).locator(".pd-agenda li");
    await expect.poll(() => agenda.count()).toBeGreaterThan(0);
    await expect(page.locator(".pd2-left .pd-agenda li", { hasText: "Proposal review" }).locator(".cal-tag.next").count()).resolves.toBe(1);
    await page.locator(".pd2-block", { hasText: "Cooptimize" }).locator(".pd2-cal > button").click();
    await expect(agenda.count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
