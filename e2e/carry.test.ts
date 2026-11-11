// PL-1: rolling into a new week, the main path on the demo (Monday Nov 2): the Board's From last week group proposes
// last week's features per client and adds nothing until accepted (WD-1: in Add work › To place); Watch makes a Watching row with its check-in on the
// client's first block; Keep carries a feature over as a must; next week's Add work proposes from this week's list.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 180_000;

describe.skipIf(!CHROMIUM)("From last week and Watching (PL-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("proposes, watches with a check-in, keeps a must, and proposes next week in Commit", async () => {
    const { page, errors } = await freshPage(h);
    // WD-1: From last week is in Add work › To place.
    await page.evaluate(() => (location.hash = "#/week/add"));
    const flw = page.locator("aside.add-work-panel section.carry", { hasText: "From last week" }).first();
    await flw.waitFor({ timeout: 30_000 });
    // Folded to one line until Review.
    if (!(await flw.locator(".carry-row").count())) await flw.getByRole("button", { name: /to place|Review/ }).first().click();
    const row = (title: string) => flw.locator(".carry-row", { hasText: title });
    await expect(row("Carrier rate alerts").textContent()).resolves.toContain("Watching");
    await expect(row("Carrier contact list").textContent()).resolves.toContain("Finished last week");
    await expect(row("Shipment tracking dashboard").textContent()).resolves.toContain("Carry over as a must");

    // Watch: the row moves to Watching, with a 30-minute check-in on Atlas's first block (Tue PM) and a ghost chip there.
    await row("Carrier rate alerts").getByRole("button", { name: "Watch", exact: true }).click();
    const watching = page.locator("section.watching .watch-row", { hasText: "Carrier rate alerts" });
    await watching.waitFor();
    await expect(watching.textContent()).resolves.toMatch(/Check-in\s*Tue PM · 30m/);
    await expect.poll(() => page.locator(".checkin-chip", { hasText: "Carrier rate alerts" }).count()).toBeGreaterThan(0);

    // Keep: the feature joins this week's list; its row goes.
    await row("Shipment tracking dashboard").getByRole("button", { name: "Keep", exact: true }).click();
    await expect.poll(() => row("Shipment tracking dashboard").count()).toBe(0);

    // Removing the check-in keeps the Watching row.
    await watching.getByRole("button", { name: "Remove check-in" }).click();
    await expect.poll(() => page.locator(".checkin-chip", { hasText: "Carrier rate alerts" }).count()).toBe(0);
    await expect(watching.getByRole("button", { name: "Add a check-in" }).count()).resolves.toBe(1);

    // Next week's Add work proposes from this week's list.
    await page.evaluate(() => (location.hash = "#/week/2026-11-09/add"));
    const next = page.locator("aside.add-work-panel section.carry", { hasText: "From last week" }).first();
    await next.waitFor({ timeout: 30_000 });
    // Review stays open (remembered).
    await expect(next.locator(".carry-row", { hasText: "Supplier onboarding" }).textContent()).resolves.toContain("Needs stories");
    expect(errors).toEqual([]);
  }, T);
});
