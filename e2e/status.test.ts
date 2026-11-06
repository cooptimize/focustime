// SR-1: Week › Status on the demo, Thursday Nov 5: the count, a line added to a feature with no update yet, Push all's
// one preview and its writes (the demo's in-memory DevOps), the line now a bullet in Preview. With FOCUSTIME_SHOTS:
// Status at 1920, 1366 and on the phone, light and dark, Larger text at 1920, and the Push all preview.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const THURSDAY = "2026-11-05T10:00:00-05:00";

async function openStatus(page: Page) {
  await page.goto(`${new URL(page.url()).origin}/#/week/status`);
  await page.getByRole("heading", { name: /Status report · for Monday, Nov 9/ }).waitFor({ timeout: 30_000 });
  await page.locator(".st-count").waitFor();
}

describe.skipIf(!CHROMIUM)("Status (SR-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, THURSDAY);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("adds a line to a feature with no update yet and pushes it, one preview for all", async () => {
    const { page, errors } = await freshPage(h);
    await openStatus(page);
    await expect.poll(() => page.locator(".st-count").textContent()).toBe("5 features · 2 with an update · 3 without");
    // The mode switch has the fourth segment, current.
    await expect.poll(() => page.locator('.mode-switch .ms-btn[aria-current="page"]').textContent()).toBe("Status");
    if (SHOTS) await shotBoth(page, "sr1-status-1920");
    const supplier = page.getByRole("article", { name: "Supplier onboarding" });
    await expect.poll(() => supplier.locator(".st-badge").textContent()).toBe("No update yet");
    await supplier.getByRole("button", { name: "+ Add a line" }).click();
    await supplier.getByRole("textbox", { name: "New line for Supplier onboarding" }).fill("Sign-up form designed; review with purchasing on Friday.");
    await expect.poll(() => page.locator(".st-push .muted").textContent()).toBe("1 line to push");
    await page.getByRole("button", { name: "Push all" }).click();
    const dialog = page.getByRole("dialog", { name: "Push 1 line to DevOps" });
    await dialog.waitFor();
    await expect.poll(() => dialog.locator(".st-preview-text").first().textContent()).toBe("Sign-up form designed; review with purchasing on Friday.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr1-push-preview-1920.png` });
    await dialog.getByRole("button", { name: "Push 1 line to DevOps" }).click();
    await dialog.locator(".dw-ok").waitFor({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect.poll(() => page.locator(".st-count").textContent()).toBe("5 features · 3 with an update · 2 without");
    await page.locator(".st-pushed").getByRole("button", { name: "Undo" }).waitFor();
    // Preview reads like the email: the line is a bullet under its heading, with its author.
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect.poll(() => page.getByRole("article", { name: "Supplier onboarding" }).locator(".st-bullets li").first().textContent()).toContain("Sign-up form designed");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  describe.skipIf(!SHOTS)("screenshots", () => {
    for (const [w, ht] of [[1920, 1080], [1366, 768], [390, 844]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        it(`Status at ${w}, ${scheme}`, async () => {
          const { page } = await freshPage(h, { width: w, height: ht });
          await page.emulateMedia({ colorScheme: scheme });
          await openStatus(page);
          if (scheme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-light"));
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${SHOTS}/sr1-status-${w}-${scheme}.png`, fullPage: w >= 1366 });
          if (w >= 1366) {
            await page.getByRole("button", { name: "Preview", exact: true }).click();
            await page.waitForTimeout(200);
            await page.screenshot({ path: `${SHOTS}/sr1-preview-${w}-${scheme}.png`, fullPage: true });
          }
          await page.close();
        }, T);
      }
    }
  });
});
