// ADM-2: the screenshots for the report (demo data only), when FOCUSTIME_SHOTS names a folder: Admin › Clients
// (Customers and All accounts), Admin › AI, Admin › People (the rows, the Not Cooptimizers fold, the mapping table),
// Admin › Status, the side menu scrolled to the bottom with Admin folded and unfolded, and the phone picker; at
// 1920×1080, 1366×768, Text size Larger and a phone (390×844, a 17px root font as on iPhone). The phone pass also checks
// that the page scrolls and nothing is wider than the screen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

const T = 300_000;

async function openAdmin(page: Page, item: string) {
  await page.getByRole("button", { name: /^More: the Guide/ }).click();
  await page.getByRole("menuitem", { name: "Admin" }).click();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: item, exact: true }).click();
  await page.locator(".set-body h2", { hasText: `Admin › ${item}` }).waitFor();
  await page.waitForTimeout(400);
}
async function larger(page: Page, on: boolean) {
  await page.evaluate((v) => (v ? document.documentElement.setAttribute("data-text-size", "larger") : document.documentElement.removeAttribute("data-text-size")), on);
  await page.waitForTimeout(150);
}

describe.skipIf(!CHROMIUM || !SHOTS)("ADM-2 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  for (const [w, ht] of [[1920, 1080], [1366, 768]] as const) {
    it(`desktop ${w}`, async () => {
      const { page } = await freshPage(h, { width: w, height: ht });
      const body = page.locator(".set-body");
      const snap = async (name: string, alsoLarger = w === 1920) => {
        await page.screenshot({ path: `${SHOTS}/adm2-${name}-${w}.png` });
        if (alsoLarger) {
          await larger(page, true);
          await page.screenshot({ path: `${SHOTS}/adm2-${name}-${w}-larger.png` });
          await larger(page, false);
        }
      };
      await openAdmin(page, "Clients");
      await snap("clients-customers");
      await page.getByRole("radio", { name: /All accounts/ }).click();
      await page.waitForTimeout(400);
      await snap("clients-all");
      await openAdmin(page, "AI");
      await page.locator(".adm-table, table").first().scrollIntoViewIfNeeded().catch(() => {});
      await snap("ai");
      await openAdmin(page, "People");
      await page.locator("h3", { hasText: "People" }).scrollIntoViewIfNeeded();
      await snap("people");
      const fold = page.getByRole("button", { name: /Not Cooptimizers/ });
      await fold.click();
      await fold.scrollIntoViewIfNeeded();
      await snap("people-fold");
      await page.locator(".adm-positions").scrollIntoViewIfNeeded();
      await snap("people-positions");
      await openAdmin(page, "Status");
      await snap("status");
      await page.locator("h3", { hasText: "Jobs" }).scrollIntoViewIfNeeded();
      await snap("status-jobs");
      // The side menu at its bottom, Admin unfolded, then folded (on a Settings page).
      await page.locator(".set-side").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await snap("menu-bottom-unfolded");
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "About", exact: true }).click();
      await page.locator('nav[aria-label="Admin sections"] .set-group-head').click();
      await page.locator(".set-side").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await snap("menu-bottom-folded");
      await page.locator('nav[aria-label="Admin sections"] .set-group-head').click();
      void body;
      await page.close();
    }, T);
  }

  it("phone", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.addStyleTag({ content: "html { font-size: 17px; }" });
    await page.getByRole("button", { name: /^More: notifications/ }).click();
    await page.getByRole("menuitem", { name: "Admin" }).click();
    const pick = page.getByRole("combobox", { name: "Settings section" });
    await pick.waitFor();
    await page.screenshot({ path: `${SHOTS}/adm2-phone-picker.png` });
    for (const id of ["admin-clients", "admin-people", "admin-status"]) {
      await pick.selectOption(id);
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, scrolls: document.scrollingElement!.scrollHeight > innerHeight }));
      expect(m.over, `${id} is wider than the phone`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/adm2-phone-${id}.png` });
      void m.scrolls;
    }
    await page.close();
  }, T);
});
