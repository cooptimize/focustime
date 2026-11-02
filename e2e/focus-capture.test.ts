// Step 15.2: Focus always in the top bar, and Quick capture's client chip, clicked in a real browser on demo data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openPlanDay, selectBlock, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 60_000;

describe.skipIf(!CHROMIUM)("Top bar Focus and Quick capture (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Focus idle opens the start menu with the next pick first; running shows the countdown and opens the focus screen", async () => {
    const { page, errors } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Cooptimize");
    const row = page.locator(".pd2-right li.pd2-add:not(.planned)").first();
    const title = (await row.locator(".pr-title").textContent())!;
    await row.locator("button.pd2-plus").click();
    await page.locator(".pd2-right li.pd2-add.planned").first().waitFor();
    await page.keyboard.press("Escape");
    const focus = page.locator(".top-btn.timer-btn");
    await expect(focus.textContent()).resolves.toMatch(/^Focus/);
    await focus.click();
    const first = page.getByRole("menuitem").first();
    await expect(first.textContent()).resolves.toContain(`Start focus: ${title}`);
    await first.click();
    const timer = page.locator(".top-timer");
    await timer.waitFor();
    await expect(timer.locator(".top-timer-label").textContent()).resolves.toBe(title);
    await expect(timer.locator(".top-timer-count").textContent()).resolves.toMatch(/^\d+:\d\d/);
    expect(await page.locator(".top-btn.timer-btn").count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("1");
    await timer.click();
    await page.locator(".focus-screen").waitFor();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("F opens the same menu; with nothing planned it offers a plain timer", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    await page.keyboard.press("f");
    await expect(page.getByRole("menuitem").first().textContent()).resolves.toMatch(/^Focus/);
    await page.keyboard.press("Escape");
    await page.close();
  }, T);

  it("Quick capture: one client chip; @nickname sets it and leaves the text; a click changes it; the tip shows once", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("n");
    await expect(page.locator(".cap-box input").getAttribute("placeholder")).resolves.toBe("Capture anything…");
    expect(await page.locator(".cap-box select").count()).toBe(0);
    await expect(page.locator(".cap-tip").count()).resolves.toBe(1);
    const input = page.locator(".cap-box input");
    await input.pressSequentially("ask @harbor about the intake form");
    await expect(page.locator(".cap-client").textContent()).resolves.toContain("Harbor");
    await expect(input.inputValue()).resolves.toBe("ask about the intake form");
    await page.locator(".cap-client").click();
    await page.locator(".cap-choose").getByRole("button", { name: /Atlas/ }).click();
    await expect(page.locator(".cap-client").textContent()).resolves.toContain("Atlas");
    await page.locator(".cap-tip .link-btn").click();
    await input.press("Enter");
    await expect(page.locator(".cap-saved").textContent()).resolves.toContain("Atlas");
    await page.keyboard.press("Escape");
    await page.keyboard.press("n");
    await page.locator(".cap-box input").waitFor();
    expect(await page.locator(".cap-tip").count()).toBe(0);
    await page.close();
  }, T);

  it("Quick capture pre-fills the client from the selected block", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    await page.keyboard.press("n");
    await expect(page.locator(".cap-client").textContent()).resolves.toContain("Northwind");
    await page.close();
  }, T);
});
