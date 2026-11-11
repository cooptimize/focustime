// Step 17.6: today's meetings on Day (inside each block, all-day and outside-hours lines) with Now and Next, and (WD-1)
// on Week: one meetings line per block that opens to the list, and the agenda in the block's detail panel. Demo mode, clock pinned to Mon Nov 2, 9:30 AM.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("Meetings on Day and Week (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Today › Now lists each block's meetings in time order, the past one dimmed and the next one marked", async () => {
    const { page, errors } = await freshPage(h);
    const morning = page.locator(".today-block", { hasText: "Cooptimize" }).locator(".today-rows > li:not(.pick-row)");
    await expect.poll(() => morning.count()).toBeGreaterThan(0);
    const rows = await morning.allTextContents();
    expect(rows[0]).toMatch(/^9:00–9:15\s*Team standup/);
    expect(rows.some((r) => /Proposal review with Jordan\s*Next/i.test(r))).toBe(true);
    await expect(morning.first().getAttribute("class")).resolves.toContain("when-past");
    // Exactly one Next on the page; the afternoon block has its own meetings.
    await expect(page.locator(".today-view .cal-tag.next").count()).resolves.toBe(1);
    await expect(page.locator(".today-block", { hasText: "Northwind" }).locator(".today-rows > li:not(.pick-row)").count()).resolves.toBeGreaterThan(0);
    // A meeting opens the same event menu as on Week.
    await page.locator(".today-view .today-rows > li", { hasText: "Proposal review" }).click();
    await expect(page.locator("[role=menu]").count()).resolves.toBe(1);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Week: a block's meetings are one line that opens to the list; its detail panel has the agenda with free gaps (WD-1)", async () => {
    const { page, errors } = await freshPage(h);
    // With the Timeline off (WK-2): with it on, the meetings are on the card's rail.
    const showTimelines = (show: boolean) => page.evaluate((v) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "ui.set_show_timelines", input: { show: v } }) }).then((r) => r.ok), show);
    expect(await showTimelines(false)).toBe(true);
    await page.reload();
    await page.locator(".today-view").waitFor({ timeout: 30_000 });
    await page.keyboard.press("2");
    await page.locator(".half.card").first().waitFor();
    const card = page.locator('[data-drop^="2026-11-02:"]', { has: page.locator(".card-client", { hasText: "Cooptimize" }) }).first();
    const fold = card.locator(".card-agenda-fold");
    await expect(fold.textContent()).resolves.toMatch(/\d+ meetings? · .* free$/);
    await fold.click();
    await expect.poll(() => card.locator(".card-events li", { hasText: "Proposal review" }).count()).toBe(1);
    await card.locator(".card-when").click();
    const agenda = page.locator('aside.detail-panel section[aria-label="Agenda"]');
    await agenda.locator("li", { hasText: "Proposal review" }).waitFor();
    await expect(agenda.locator("li.ag-free").count()).resolves.toBeGreaterThan(0);
    expect(await showTimelines(true)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
