// UI-B, since SG-1: unfinished picks suggested in the client's next block, the main path on the demo on Wednesday
// Nov 4 at 1:30 PM. Monday's unfinished Northwind to-do is the first suggested row in Wednesday afternoon's (emptied)
// Northwind block, saying where it came from; Keep makes it a to-do there (Undo puts it back as a suggestion); the
// ones with no block left this week stay in Unfinished from earlier days, where Drop settles one; the now line sits on
// today's column. SG-1's own cases are e2e/sg1.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, unfoldAddWork, startDemo, type Harness } from "./harness.ts";
import { emptyFrom } from "./sg1-helpers.ts";

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
    // QT-1: the original blocks are on past days, folded to one line; the to-do is not a second unchecked item.
    expect(await page.locator(".half .checklist .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(0);

    // Keep: a normal to-do on Wednesday afternoon; the original (folded) counts it as moved on. Undo puts it back.
    await row.locator(".sug-plus").click();
    await expect.poll(() => wedPm.locator(".checklist .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(1);
    await expect.poll(() => page.locator(".half.folded .card-folded", { hasText: /moved on/ }).count()).toBeGreaterThan(0);
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
});
