// Step 17.6, WD-1, WD-2: a block's meetings on Day and on Week: one meetings line per block card that opens to the
// list, and the block panel's meetings line that opens the agenda in place. Demo mode, clock pinned to Mon Nov 2, 9:30 AM.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("Meetings on Day and Week (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("WD-2: Day's cards show each block's meetings as one line that opens to the list in time order; the block panel's meetings line opens the agenda", async () => {
    const { page, errors } = await freshPage(h);
    const card = page.locator('.day-view [data-drop="2026-11-02:AM"]');
    const fold = card.locator(".card-agenda-fold");
    await fold.waitFor({ timeout: 30_000 });
    await expect(fold.textContent()).resolves.toMatch(/\d+ meetings? · .* free$/);
    await fold.click();
    const rows = card.locator(".card-events li");
    await expect.poll(() => rows.count()).toBeGreaterThan(1);
    const texts = await rows.allTextContents();
    expect(texts[0]).toMatch(/^9:00–9:15\s*Team standup/);
    expect(texts.some((r) => /Proposal review with Jordan/.test(r))).toBe(true);
    // The afternoon block has its own line.
    await expect(page.locator('.day-view [data-drop="2026-11-02:PM"] .card-agenda-fold').count()).resolves.toBe(1);
    // The panel: one meetings line, opening the agenda with its free gaps in place.
    await card.locator(".card-when").click();
    const panel = page.locator("aside.block-panel");
    const line = panel.locator(".bp-meet-line");
    await expect(line.textContent()).resolves.toMatch(/\d+ meetings · \d/);
    expect(await panel.locator(".bp-meetings li").count()).toBe(0);
    await line.click();
    await panel.locator(".bp-meetings li", { hasText: "Proposal review" }).waitFor();
    await expect(panel.locator(".bp-meetings li.ag-free").count()).resolves.toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Week: a block's meetings are one line that opens to the list; its panel's meetings line opens the agenda with free gaps (WD-1, WD-2)", async () => {
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
    await page.locator("aside.block-panel .bp-meet-line").click();
    const agenda = page.locator("aside.block-panel .bp-meetings");
    await agenda.locator("li", { hasText: "Proposal review" }).waitFor();
    await expect(agenda.locator("li.ag-free").count()).resolves.toBeGreaterThan(0);
    expect(await showTimelines(true)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
