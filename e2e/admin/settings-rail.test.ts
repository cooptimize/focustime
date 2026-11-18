// Was e2e/admin-menu.test.ts until BT-1.
// ADM-2, ST-1, SA-4: the Settings rail on a short window (1366×768) reaches its Admin line by the wheel and the keyboard;
// Admin's own rail marks a deep link and shows it; old addresses land on their new place. A phone gets Admin's parts as
// a list page and each part as a page with Back. On the demo (its person is an admin in their own demo).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 120_000;

describe.skipIf(!CHROMIUM)("Settings rail", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("at 1366×768 Settings' rail scrolls to its Admin line; Admin's own rail marks a deep link and shows it", async () => {
    const { page, errors } = await freshPage(h, { width: 1366, height: 768 });
    await page.evaluate(() => (location.hash = "#/settings/you"));
    const side = page.locator(".ps-side");
    await side.waitFor();
    // SA-4: Settings' rail ends with one line for Admin (admins only).
    const admin = page.locator('.ps-rail [data-settings-section="admin"]');
    await admin.waitFor();
    const inView = async (sel: string) =>
      page.evaluate((q) => {
        const s = document.querySelector(".ps-side")!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>(q)!.getBoundingClientRect();
        return b.top >= s.top && b.bottom <= s.bottom + 1 && b.bottom <= innerHeight;
      }, sel);
    const sizes = await side.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    if (sizes.scroll > sizes.client) {
      await side.hover();
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(200);
    }
    expect(await inView('.ps-rail [data-settings-section="admin"]')).toBe(true);
    // The keyboard: from the search box, Tab through to the Admin line.
    await side.evaluate((el) => (el.scrollTop = 0));
    await page.getByLabel("Search settings").focus();
    for (let i = 0; i < 60 && !(await admin.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    expect(await admin.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash === "#/admin");
    await page.locator('.ps-rail [data-settings-section="clients"][aria-current="page"]').waitFor();
    // A deep link to a client's page at the largest text size: its rail line is marked and in view.
    await page.evaluate(() => (location.hash = "#/today"));
    await side.waitFor({ state: "detached" });
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    await page.evaluate(() => (location.hash = "#/admin/clients/Tailspin/backlog"));
    const tail = page.locator('.ps-rail [data-settings-section="client:Tailspin"]');
    await tail.waitFor();
    expect(await tail.getAttribute("aria-current")).toBe("page");
    await page.getByRole("tab", { name: "Backlog rules", selected: true }).waitFor();
    await page.waitForTimeout(150);
    expect(await inView('.ps-rail [aria-current="page"]')).toBe(true);
    // An old address lands on its new place, and the address bar says so.
    await page.evaluate(() => (location.hash = "#/settings/admin-status"));
    await page.waitForFunction(() => location.hash === "#/admin/health");
    await page.locator('.ps-rail [data-settings-section="health"][aria-current="page"]').waitFor();
    await page.keyboard.press("Control+0");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a phone gets Admin as a list of parts, each a page with Back and ×, and Admin pages fit the width", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    // PH-1: More › Everything else › Admin.
    await page.locator(".bottom-bar").getByRole("button", { name: /^More/ }).click();
    await page.getByRole("button", { name: /Everything else/ }).click();
    await page.locator('.mr-row[data-row="admin"]').click();
    await page.waitForFunction(() => location.hash === "#/admin");
    // The list of parts, no side rail.
    await page.locator('.ps-rail [data-settings-section="health"]').waitFor();
    expect(await page.locator(".ps-side").count()).toBe(0);
    await page.locator('.ps-rail [data-settings-section="health"]').click();
    await page.waitForFunction(() => location.hash === "#/admin/health");
    await page.locator(".ps-head h2", { hasText: "Health" }).waitFor();
    // Back: the list.
    await page.locator(".ps-head").getByRole("button", { name: "Admin" }).click();
    await page.waitForFunction(() => location.hash === "#/admin");
    // Each part and a client's page fit the phone: the page never scrolls sideways.
    for (const at of ["defaults/planning", "health", "people", "audit", "clients", "clients/Atlas/backlog"]) {
      await page.evaluate((x) => (location.hash = `#/admin/${x}`), at);
      await page.locator(".ps-head h2").waitFor();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]), at).toEqual([390, 390]);
    }
    // From a client's page, Back goes to Clients.
    await page.locator(".ps-head").getByRole("button", { name: "Clients" }).click();
    await page.waitForFunction(() => location.hash === "#/admin/clients");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
