// ADM-2: the Settings and Admin side menu on a short window (1366×768): it scrolls on its own, so the last Admin item
// is reachable by the wheel and the keyboard; a deep link highlights its item and shows it; the groups fold and the
// fold is remembered; a phone gets the picker. On the demo (its person is an admin in their own demo).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 120_000;

describe.skipIf(!CHROMIUM)("Settings side menu", () => {
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
    const side = page.locator(".set-side");
    await side.waitFor();
    const audit = page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Audit", exact: true });
    await audit.waitFor();
    const inView = async () =>
      page.evaluate(() => {
        const s = document.querySelector(".set-side")!.getBoundingClientRect();
        const b = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Admin sections"] .set-tab')].at(-1)!.getBoundingClientRect();
        return b.top >= s.top && b.bottom <= s.bottom + 1 && b.bottom <= innerHeight;
      });
    // Taller than the window: the column scrolls, not the page.
    const sizes = await side.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    expect(await inView()).toBe(false);
    // The wheel scrolls the column to its end.
    await side.hover();
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(200);
    expect(await inView()).toBe(true);
    await audit.click();
    await page.waitForFunction(() => location.hash === "#/settings/admin-audit");
    // The keyboard: back to the top, then Tab through to the last item; it scrolls into view.
    await side.evaluate((el) => (el.scrollTop = 0));
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button").nth(1).focus();
    for (let i = 0; i < 40 && !(await audit.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    expect(await audit.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await inView()).toBe(true);
    // A deep link far down the list (About at the largest text size; Admin deep links wait on NV-1's routes):
    // highlighted and scrolled into view.
    await page.evaluate(() => (location.hash = "#/today"));
    await side.waitFor({ state: "detached" });
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    await page.evaluate(() => (location.hash = "#/settings/about"));
    const about = page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "About", exact: true });
    await about.waitFor();
    expect(await about.getAttribute("aria-current")).toBe("page");
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(() => {
        const s = document.querySelector(".set-side")!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>('.set-side [aria-current="page"]')!.getBoundingClientRect();
        return [document.querySelector(".set-side")!.scrollTop > 0, b.top >= s.top && b.bottom <= s.bottom + 1];
      }),
    ).toEqual([true, true]);
    await page.keyboard.press("Control+0");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the groups fold, the fold is remembered, and an Admin page opens with Admin unfolded", async () => {
    const { page } = await freshPage(h, { width: 1366, height: 768 });
    await page.evaluate(() => (location.hash = "#/settings/you"));
    const adminHead = page.locator('nav[aria-label="Admin sections"] .set-group-head');
    await adminHead.click();
    await expect.poll(() => adminHead.getAttribute("aria-expanded")).toBe("false");
    expect(await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Audit", exact: true }).count()).toBe(0);
    await page.reload();
    await page.waitForSelector(".topbar");
    await page.evaluate(() => (location.hash = "#/settings/you"));
    await adminHead.waitFor();
    expect(await adminHead.getAttribute("aria-expanded")).toBe("false");
    // On an Admin page, Admin is open whatever the fold (⋯ › Admin opens Admin › Clients).
    await page.evaluate(() => (location.hash = "#/today"));
    await page.locator(".set-side").waitFor({ state: "detached" });
    await page.getByRole("button", { name: /^More: the Guide/ }).click();
    await page.getByRole("menuitem", { name: "Admin" }).click();
    await expect.poll(() => page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Clients", exact: true }).getAttribute("aria-current")).toBe("page");
    expect(await adminHead.getAttribute("aria-expanded")).toBe("true");
    await page.close();
  }, T);

  it("a phone gets the Settings picker instead of the column", async () => {
    const { page } = await freshPage(h, { width: 390, height: 844 });
    // The phone opens Admin from More.
    await page.getByRole("button", { name: /^More: notifications/ }).click();
    await page.getByRole("menuitem", { name: "Admin" }).click();
    const pick = page.getByRole("combobox", { name: "Settings section" });
    await pick.waitFor();
    expect(await pick.inputValue()).toBe("admin-clients");
    expect(await page.locator(".set-side").count()).toBe(0);
    await pick.selectOption("admin-status");
    await page.waitForFunction(() => location.hash === "#/settings/admin-status");
    await pick.selectOption("notifications");
    await page.waitForFunction(() => location.hash === "#/settings/notifications");
    await page.close();
  }, T);
});
