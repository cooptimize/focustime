// Was e2e/adm2-shots.test.ts (ADM-2) until BT-1, then e2e/admin/admin-screens-shots.test.ts until FT-1, which moved it
// here with the other screenshot scripts: its one check (nothing wider than the phone) runs in CI now, in
// e2e/admin/admin-phone-width.test.ts. Usage: FOCUSTIME_SHOTS=screenshots/adm2 npm run shots -- e2e/shot-scripts/admin-screens-shots.ts.
// ADM-2: the screenshots for the report (demo data only), when FOCUSTIME_SHOTS names a folder: Admin › Clients
// (Customers and All accounts), Admin › AI, Admin › People (the rows, the Not Cooptimizers fold, the mapping table),
// Admin › Status, the side menu scrolled to the bottom with Admin folded and unfolded, and the phone picker; at
// 1920×1080, 1366×768, Text size Larger and a phone (390×844, a 17px root font as on iPhone).
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS } from "../shots.ts";

const T = 300_000;

async function openAdmin(page: Page, item: string) {
  await page.getByRole("button", { name: /^More: the Guide/ }).click();
  await page.getByRole("menuitem", { name: "Admin" }).click();
  await page.locator(`.ps-rail [data-settings-section="admin-${item.toLowerCase()}"]`).click();
  await page.locator(".ps-head h2", { hasText: `Admin › ${item}` }).waitFor();
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
      // The rail at its bottom (ST-1: no folds).
      await page.locator(".ps-side").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await snap("menu-bottom");
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
    // ST-1: the phone opens the section as a page; Back shows the rail as a list page.
    await page.locator(".ps-head h2", { hasText: "Admin › Clients" }).waitFor();
    await page.locator(".ps-head").getByRole("button", { name: "Settings" }).click();
    await page.locator(".ps-rail").waitFor();
    await page.screenshot({ path: `${SHOTS}/adm2-phone-picker.png` });
    for (const id of ["admin-clients", "admin-people", "admin-status"]) {
      await page.evaluate((x) => (location.hash = `#/settings/${x}`), id);
      await page.locator(".ps-head h2").waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/adm2-phone-${id}.png` });
    }
    await page.close();
  }, T);
});
