// S1: Plan the week's PTO in the browser (demo: Thu Nov 12 is PTO), and ⋯ › About's one line. Screenshots of both at
// 1920 and at Text size Larger when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 90_000;
let h: Harness;

describe.skipIf(!CHROMIUM)("PTO on Week, and About (S1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Thursday's PTO is one PTO cell on Week, with Add work open too; About shows the build line", async () => {
    const { page, errors } = await freshPage(h);
    // WD-1: Plan the week's grid is gone; the old address opens Week with Add work on that week.
    await page.evaluate(() => (location.hash = "#/week/plan/2026-11-09"));
    await page.locator("aside.block-panel").waitFor({ timeout: 30_000 });
    const thu = page.locator("section.day").nth(3);
    // One cell over both halves, no + Add on it.
    await expect(thu.locator(".half.whole.pto").count()).resolves.toBe(1);
    await expect(thu.locator(".half.whole.pto").textContent()).resolves.toContain("PTO");
    await expect(thu.locator(".add-work.add-row").count()).resolves.toBe(0);
    await shotBoth(page, "week-nov9-thu-pto");

    await page.getByRole("button", { name: /^More: the Guide/ }).click();
    await page.getByRole("menuitem", { name: "About" }).click();
    const about = page.getByRole("dialog", { name: /About/ });
    await expect(about.locator(".about-line").textContent()).resolves.toMatch(/^FocusTime · (demo|local) · /);
    await shotBoth(page, "about");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
