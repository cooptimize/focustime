// Step 16.3: teammates' presence (demo mode: fictional people and presence, no Graph calls), deep focus and the focus
// screen's Teams line, Settings > Focus, and the VM notification route opening the header chip's menu.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("Teams presence and status (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Needs help from…: a mark and a word for each Cooptimizer, Available now first", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("2");
    await page.keyboard.press("p");
    // This week has the demo's week lists.
    await page.locator(".planweek .co-step button[aria-label='Previous week']").click();
    await page.locator(".pw-row").first().hover();
    await page.locator(".pw-row button.more").first().click();
    await page.getByRole("menuitem", { name: /Needs help from/ }).click();
    const dlg = page.getByRole("dialog", { name: /Needs help from/ });
    await dlg.waitFor();
    const marks = dlg.locator(".help-people .pres");
    await expect.poll(() => marks.count(), { timeout: 10_000 }).toBe(4);
    // Never color alone: each mark has its word.
    await expect(marks.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).sort())).resolves.toEqual(["Available", "Away", "Do not disturb", "In a meeting"]);
    // Available now first in its tier.
    const first = dlg.locator(".help-tier li").first();
    await expect(first.textContent()).resolves.toContain("Jordan Lee");
    await expect(first.locator(".pres").getAttribute("aria-label")).resolves.toBe("Available");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("deep focus from the Focus button: the focus screen says Teams: Do not disturb until …; switching to plain says Busy", async () => {
    const { page, errors } = await freshPage(h);
    await page.locator(".topbar .timer-btn").click();
    await page.getByRole("menuitem", { name: /^Deep focus/ }).click();
    await page.getByRole("menuitem").first().click();
    await page.locator(".focus-screen").waitFor();
    const line = page.locator(".teams-line");
    await expect.poll(() => line.textContent(), { timeout: 15_000 }).toMatch(/^Teams: Do not disturb until \d{1,2}:\d{2} (AM|PM)$/);
    await expect.poll(() => page.locator(".focus-deep input").isChecked()).toBe(true);
    await page.locator(".focus-deep input").click();
    await expect.poll(() => line.textContent(), { timeout: 15_000 }).toMatch(/^Teams: Busy until /);
    await page.locator(".focus-screen").getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator(".today-view").waitFor();
    await openSettings(page);
    await page.locator(".set-nav").getByRole("button", { name: "Data", exact: true }).click();
    const log = page.locator('[aria-label="Teams status log"]');
    await expect.poll(() => log.textContent(), { timeout: 15_000 }).toMatch(/Cleared \(back to automatic\)/);
    await expect(log.textContent()).resolves.toMatch(/Set Do not disturb/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Settings > Focus: Teams status on by default, plain focus sets Busy", async () => {
    const { page } = await freshPage(h);
    await openSettings(page);
    await page.locator(".set-nav").getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.getByLabel("Set my status while I focus").isChecked()).resolves.toBe(true);
    await expect(page.locator("select", { has: page.locator("option", { hasText: "Leave my status alone" }) }).inputValue()).resolves.toBe("busy");
    await expect.poll(() => page.locator(".set-teams-access").textContent(), { timeout: 10_000 }).toContain("Teams is connected");
    await page.close();
  }, T);

  it("the VM notifications open the header chip's menu", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("focustime:open-route", { detail: "vm" })));
    await expect.poll(() => page.getByRole("menuitem", { name: /Delay shutdown 1h/ }).count(), { timeout: 10_000 }).toBe(1);
    await page.close();
  }, T);
});
