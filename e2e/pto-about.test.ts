// S1: Plan the week's PTO in the browser (demo: Thu Nov 12 is PTO), and ⋯ › About's one line. Screenshots of both at
// 1920 and at Text size Larger when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 90_000;
let h: Harness;

describe.skipIf(!CHROMIUM)("PTO in Plan the week, and About (S1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Thursday's PTO is one PTO cell in Plan the week, as on Week; About shows the build line", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week/plan/2026-11-09"));
    await page.locator(".pw-client").first().waitFor({ timeout: 30_000 });
    const pto = page.locator('.pw-cell.pto[aria-label^="Thu, Nov 12"]');
    await expect(pto.textContent()).resolves.toBe("PTO");
    // One cell over both halves, and it takes nothing (a span, not a button).
    await expect(pto.evaluate((e) => [e.tagName, getComputedStyle(e).gridRowStart, getComputedStyle(e).gridRowEnd])).resolves.toEqual(["SPAN", "2", "span 2"]);
    await shotBoth(page, "planweek-nov9-thu-pto");

    await page.getByRole("button", { name: /^More: the Guide/ }).click();
    await page.getByRole("menuitem", { name: "About" }).click();
    const about = page.getByRole("dialog", { name: /About/ });
    await expect(about.locator(".about-line").textContent()).resolves.toMatch(/^FocusTime · (demo|local) · /);
    await shotBoth(page, "about");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
