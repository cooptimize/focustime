// HK-3: Plan today inside the Board's carry-over, on the demo on Wednesday Nov 4 at 1:30 PM: a pick the Board suggests
// in today's Northwind block is the same dashed card in Plan today (Keep / Move to… / Drop), not a second copy in the
// list; only the picks with no block left this week stay in "Unfinished from earlier days". And the no-hours prompt
// gives focus back to what asked when it closes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 180_000;
const WED = "2026-11-04T13:30:00-05:00";
const SHOTS = process.env.HK3_SHOTS ?? null;

describe.skipIf(!CHROMIUM)("Plan today with suggested picks (HK-3)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, WED);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("shows the suggested pick as the dashed card in its block, keeps it from there, and lists only the rest", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week/day/2026-11-04"));
    const pm = page.getByRole("region", { name: "Afternoon: Northwind" });
    await pm.waitFor({ timeout: 30_000 });
    const card = pm.locator(".suggested-card", { hasText: "Filter orders by date range" });
    await card.waitFor({ timeout: 30_000 });
    await expect(card.textContent()).resolves.toContain("From Mon");
    // Not a second copy: not a row in the block, not in the list.
    await expect(pm.locator(".pd2-picks .pr-title", { hasText: "Filter orders by date range" }).count()).resolves.toBe(0);
    const list = page.locator("section.pd2-carry");
    await list.waitFor();
    await expect(list.locator("li", { hasText: "Filter orders by date range" }).count()).resolves.toBe(0);
    await expect(list.locator("li.pd2-add").count()).resolves.toBe(3);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hk3-planday-suggested-1920.png` });

    // Keep here: it becomes a pick in the block; Undo puts the card back.
    await card.locator(".sc-open").click();
    await page.getByRole("menuitem", { name: /Keep here, Wed PM/ }).click();
    await expect.poll(() => pm.locator(".pd2-picks .pr-title", { hasText: "Filter orders by date range" }).count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => card.count()).toBe(0);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => card.count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => pm.locator(".pd2-picks .pr-title", { hasText: "Filter orders by date range" }).count()).toBe(0);

    // The no-hours prompt (a Move to a day with no working hours) gives focus back to the + that asked.
    await page.route("**/api/action", async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action !== "pick.move") return route.continue();
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, status: 409, error: "Saturday has no working hours. Add hours for that day?", code: "no_hours" }) });
    });
    const plus = list.locator("button.pd2-plus").first();
    await plus.focus();
    await plus.press("Enter");
    const prompt = page.getByRole("alertdialog", { name: "No working hours" });
    await prompt.waitFor();
    await expect.poll(() => prompt.getByRole("button", { name: "Add hours" }).evaluate((e) => e === document.activeElement)).toBe(true);
    await page.keyboard.press("Escape");
    await prompt.waitFor({ state: "detached" });
    await expect.poll(() => plus.evaluate((e) => e === document.activeElement), { timeout: 5_000 }).toBe(true);
    await page.unroute("**/api/action");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
