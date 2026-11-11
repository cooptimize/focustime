// UI-B: unfinished picks as suggested cards on Week's Board, the main path on the demo on Wednesday Nov 4 at 1:30 PM:
// Monday's and Tuesday's unfinished picks are dashed cards in each client's next block (Cooptimize's, with no block
// left this week, in Unfinished from earlier days); the original block shows "→ suggested …"; Keep moves one (Undo
// puts it back), Drop settles one, Keep all keeps the rest; the now line sits on today's column.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, unfoldAddWork, startDemo, type Harness } from "./harness.ts";

const T = 180_000;
const WED = "2026-11-04T13:30:00-05:00";
const SHOTS = process.env.UIB_SHOTS ?? null;

describe.skipIf(!CHROMIUM)("Unfinished picks suggested in the next block (UI-B)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, WED);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("suggests, keeps with Undo, drops, keeps all, and shows the now line", async () => {
    const { page, errors } = await freshPage(h);
    // WD-1: the summary of unfinished to-dos is in Add work › To place.
    await page.getByRole("button", { name: "Week", exact: true }).first().click();
    await page.evaluate(() => (location.hash = "#/week/add"));
    await unfoldAddWork(page);
    const summary = page.locator("aside.block-panel section.carry-summary");
    await summary.waitFor({ timeout: 30_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-first-1920.png` });
    // Thursday is PTO and Friday catch-up: only Northwind (Wed PM) has a block left; the rest are in the list.
    await expect(summary.locator(".cs-line").textContent()).resolves.toContain("1 unfinished to-do suggested in your next blocks");
    await expect(summary.locator(".cs-hint").count()).resolves.toBe(1);
    await expect(summary.getByText("Unfinished from earlier days (3)").count()).resolves.toBe(1);

    const card = (title: string) => page.locator(".suggested-card", { hasText: title });
    await expect(card("Filter orders by date range").textContent()).resolves.toContain("From Mon");
    // QT-1: the original blocks are on past days, folded to one line; the to-do is not a second unchecked item.
    await expect(page.locator(".half .checklist .pr-title", { hasText: "Filter orders by date range" }).count()).resolves.toBe(0);

    // Keep here: a normal pick on Wednesday afternoon; the original (folded) counts it as moved on. Undo puts it back.
    await card("Filter orders by date range").locator(".sc-open").click();
    await page.getByRole("menuitem", { name: /Keep here, Wed PM/ }).click();
    await expect.poll(() => card("Filter orders by date range").count()).toBe(0);
    await expect.poll(() => page.locator(".half .checklist .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(1);
    await expect.poll(() => page.locator(".half.folded .card-folded", { hasText: /moved on/ }).count()).toBeGreaterThan(0);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => card("Filter orders by date range").count()).toBe(1);

    // The fallback list: grouped by client, Drop settles one.
    await summary.getByText("Unfinished from earlier days (3)").click();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-list-1920.png` });
    await summary.locator(".flw-row", { hasText: "Map of active shipments" }).getByRole("button", { name: "Drop" }).click();
    await expect.poll(() => summary.getByText("Unfinished from earlier days (2)").count()).toBe(1);

    // Keep all keeps the suggestion.
    await summary.getByRole("button", { name: "Keep all" }).click();
    await expect.poll(() => page.locator(".suggested-card").count()).toBe(0);
    await expect.poll(() => page.locator(".half .checklist .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(1);

    // The now line on today's column, with the time.
    await expect(page.locator(".day.today .now-line").first().textContent()).resolves.toContain("1:30");
    expect(errors).toEqual([]);
  }, T);
});
