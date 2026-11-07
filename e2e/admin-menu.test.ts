// ADM-2, ST-1: the Settings rail on a short window (1366×768): it scrolls on its own, so the last Admin item is reachable
// by the wheel and the keyboard; a deep link marks its item and shows it. A phone gets the rail as its own list page and
// each section as a page with Back. On the demo (its person is an admin in their own demo).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 120_000;

describe.skipIf(!CHROMIUM)("Settings rail", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("at 1366×768 the last Admin item is reachable by scroll and keyboard; a deep link shows its item", async () => {
    const { page, errors } = await freshPage(h, { width: 1366, height: 768 });
    await page.evaluate(() => (location.hash = "#/settings/you"));
    const side = page.locator(".ps-side");
    await side.waitFor();
    const audit = page.locator('.ps-rail [data-settings-section="admin-audit"]');
    await audit.waitFor();
    const inView = async () =>
      page.evaluate(() => {
        const s = document.querySelector(".ps-side")!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>('.ps-rail [data-settings-section="admin-audit"]')!.getBoundingClientRect();
        return b.top >= s.top && b.bottom <= s.bottom + 1 && b.bottom <= innerHeight;
      });
    // Taller than the window: the rail scrolls, not the page.
    const sizes = await side.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    expect(await inView()).toBe(false);
    await side.hover();
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(200);
    expect(await inView()).toBe(true);
    await audit.click();
    await page.waitForFunction(() => location.hash === "#/settings/admin-audit");
    // The keyboard: from the search box, Tab through to the last item; it scrolls into view.
    await side.evaluate((el) => (el.scrollTop = 0));
    await page.getByLabel("Search settings").focus();
    for (let i = 0; i < 40 && !(await audit.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    expect(await audit.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await inView()).toBe(true);
    // A deep link far down the rail, at the largest text size: marked and scrolled into view.
    await page.evaluate(() => (location.hash = "#/today"));
    await side.waitFor({ state: "detached" });
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    await page.evaluate(() => (location.hash = "#/settings/admin-status"));
    const status = page.locator('.ps-rail [data-settings-section="admin-status"]');
    await status.waitFor();
    expect(await status.getAttribute("aria-current")).toBe("page");
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(() => {
        const s = document.querySelector(".ps-side")!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>('.ps-rail [aria-current="page"]')!.getBoundingClientRect();
        return [document.querySelector(".ps-side")!.scrollTop > 0, b.top >= s.top && b.bottom <= s.bottom + 1];
      }),
    ).toEqual([true, true]);
    await page.keyboard.press("Control+0");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a phone gets the rail as a list page, each section a page with Back and ×, and Admin pages fit the width", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    // The phone opens Admin from More.
    await page.getByRole("button", { name: /^More: notifications/ }).click();
    await page.getByRole("menuitem", { name: "Admin" }).click();
    await page.locator(".ps-head h2", { hasText: "Admin › Clients" }).waitFor();
    expect(await page.locator(".ps-side").count()).toBe(0);
    // Back: the list.
    await page.locator(".ps-head").getByRole("button", { name: "Settings" }).click();
    await page.waitForFunction(() => location.hash === "#/settings");
    await page.locator('.ps-rail [data-settings-section="admin-status"]').click();
    await page.waitForFunction(() => location.hash === "#/settings/admin-status");
    // Admin › Organization and Status have tables wider than a phone: they scroll on their own, the page never does.
    for (const id of ["admin-organization", "admin-status", "admin-people", "admin-audit"]) {
      await page.evaluate((x) => (location.hash = `#/settings/${x}`), id);
      await page.locator(".ps-head h2").waitFor();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth])).toEqual([390, 390]);
    }
    await page.locator(".ps-head").getByRole("button", { name: "Settings" }).click();
    await page.locator('.ps-rail [data-settings-section="notifications"]').click();
    await page.waitForFunction(() => location.hash === "#/settings/notifications");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
