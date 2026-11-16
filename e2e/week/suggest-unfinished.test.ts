// Was e2e/board-suggest.test.ts until BT-1.
// UI-B, since SG-1: unfinished picks suggested in the client's next block, the main path on the demo on Wednesday
// Nov 4 at 1:30 PM. Monday's unfinished Northwind to-do is the first suggested row in Wednesday afternoon's (emptied)
// Northwind block, saying where it came from; Keep makes it a to-do there (Undo puts it back as a suggestion); the
// ones with no block left this week stay in Unfinished from earlier days, where Drop settles one; the now line sits on
// today's column. SG-1's own cases are e2e/week/board-suggests.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, unfoldAddWork, startDemo, type Harness } from "../harness.ts";
import { emptyFrom } from "../sg1-helpers.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 180_000;
const WED = "2026-11-04T13:30:00-05:00";

describe.skipIf(!CHROMIUM)("Unfinished picks suggested in the next block (UI-B, SG-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, WED);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("suggests, keeps with Undo, drops from the list, and shows the now line", async () => {
    const { page, errors } = await freshPage(h);
    await emptyFrom(page, "2026-11-04", ["2026-11-04:PM"]);
    await page.getByRole("button", { name: "Week", exact: true }).first().click();
    const wedPm = page.locator('main.grid [data-drop="2026-11-04:PM"]');
    const row = wedPm.locator(".sug-row", { hasText: "Filter orders by date range" });
    await row.waitFor({ timeout: 30_000 });
    expect(await row.locator(".sug-take").getAttribute("title")).toMatch(/^Unfinished from Mon/);
    expect(await wedPm.locator(".sug-row").first().innerText()).toContain("Filter orders by date range");
    // The original blocks are on past days (WK-5: listed again, read only); the to-do is not a second unchecked item
    // on any day still to come.
    expect(await page.locator(".half:not(.past) .checklist .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(0);

    // Keep: a normal to-do on Wednesday afternoon; the original (past) row says where it went. Undo puts it back.
    await row.locator(".sug-plus").click();
    await expect.poll(() => wedPm.locator(".checklist .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(1);
    await expect.poll(() => page.locator(".half.past .past-moved", { hasText: "Filter orders by date range" }).count()).toBeGreaterThan(0);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => row.count()).toBe(1);
    expect(await wedPm.locator(".checklist .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(0);

    // The fallback list (no block left this week), in Add work › To place: Drop settles one.
    await page.evaluate(() => (location.hash = "#/week/add"));
    await unfoldAddWork(page);
    const summary = page.locator("aside.block-panel section.carry-summary");
    await summary.waitFor({ timeout: 30_000 });
    const fold = summary.getByText(/Unfinished from earlier days \((\d+)\)$/);
    const n = Number((await fold.innerText()).match(/\((\d+)\)/)![1]);
    await fold.click();
    await summary.locator(".flw-row").first().getByRole("button", { name: "Drop" }).click();
    await expect.poll(async () => ((await fold.count()) ? Number((await fold.innerText()).match(/\((\d+)\)/)![1]) : 0)).toBe(n - 1);

    // The now line on today's column, with the time.
    // PS-1 (C1): with no rail, "now" is a marker in the header of the block under way.
    await expect(page.locator(".day.today :is(.now-line, .now-mark)").first().textContent()).resolves.toContain("1:30");
    expect(errors).toEqual([]);
  }, T);

  // BT-1: from the UI-B screenshots (e2e/shot-scripts/uib-shots.ts), which CI never ran: on a 390 px phone with the
  // iPhone's 17 px root font, mid-block, Today and Week are no wider than the screen.
  it("on a 390 px phone with a 17 px root font, Today and Week are no wider than the screen", async () => {
    const page = await phonePage(h, 390);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.locator("main").first().waitFor();
    await page.waitForTimeout(800);
    expect(await wide(), "Today is wider than the phone").toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Week", exact: true }).first().click();
    await page.waitForFunction(() => location.hash.startsWith("#/week"));
    await page.waitForTimeout(800);
    expect(await wide(), "Week is wider than the phone").toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
