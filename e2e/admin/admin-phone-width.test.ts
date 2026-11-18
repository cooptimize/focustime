// FT-1: the one check from ADM-2's screenshots (e2e/shot-scripts/admin-screens-shots.ts, which ran only with
// FOCUSTIME_SHOTS, so CI never made it): on a phone (390×844, a 17px root font as on iPhone) Admin › Clients, People
// and Status are no wider than the screen, each read once its own content is in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, startDemo, type Harness } from "../harness.ts";

const T = 120_000;
/** Each section, and what shows once its data is in (the screenshots' own marks). */
const SECTIONS = [
  ["clients", ".sp-link-item[data-client]"],
  ["clients/Atlas/overview", '[role="radiogroup"]'],
  ["people/levels", 'table[aria-label="Positions to levels"]'],
  ["health", 'h3:has-text("Jobs")'],
] as const;

describe.skipIf(!CHROMIUM)("ADM-2: Admin on the phone is no wider than the screen", () => {
  let h: Harness;
  beforeAll(async () => void (h = await startDemo()), T);
  afterAll(async () => h?.stop());

  it("Clients, a client's page, People and Health at 390 px with a 17 px root font", async () => {
    // bypassCSP: the 17 px root font is a style tag the page's own policy would refuse.
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.addStyleTag({ content: "html { font-size: 17px; }" });
    // PH-1: More › Everything else › Admin.
    await page.locator(".bottom-bar").getByRole("button", { name: /^More/ }).click();
    await page.getByRole("button", { name: /Everything else/ }).click();
    await page.locator('.mr-row[data-row="admin"]').click();
    await page.waitForFunction(() => location.hash === "#/admin");
    for (const [id, ready] of SECTIONS) {
      await page.evaluate((x) => (location.hash = `#/admin/${x}`), id);
      await page.locator(".ps-head h2").first().waitFor();
      await page.locator(ready).first().waitFor({ timeout: 30_000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${id} is wider than the phone`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
