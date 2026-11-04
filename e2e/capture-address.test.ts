// A5: #/capture opens Quick capture over the last place and leaves the address (the hosted app's Super+Alt+N).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const box = ".cap-box input[aria-label='Quick capture']";

describe.skipIf(!CHROMIUM)("The capture address (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("opens Quick capture on load and on a hash change, over the place you were, and back doesn't reopen it", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("2");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/week");
    await page.goto(`${h.url}#/capture`);
    await page.locator(box).waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/week");
    await page.keyboard.press("Escape");
    await page.locator(box).waitFor({ state: "detached" });
    // A new window at the address (what the key binding opens), signed in already: capture over the last place.
    const win = page;
    await win.goto(new URL("/healthz", h.url).href);
    await win.goto(`${h.url}#/capture`);
    await win.locator(box).waitFor({ timeout: 30_000 });
    await expect.poll(() => win.evaluate(() => location.hash)).toBe("#/week");
    await win.keyboard.press("Escape");
    await win.locator(box).waitFor({ state: "detached" });
    await win.goBack().catch(() => null);
    await win.waitForTimeout(500);
    await expect(win.locator(box).count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);
});
