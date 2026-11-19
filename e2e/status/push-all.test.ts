// Was e2e/status.test.ts until BT-1.
// SR-1: Week › Status on the demo, Thursday Nov 5: the count, a line added to a feature with no update yet, Push to
// DevOps's one preview and its writes (the demo's in-memory DevOps), the line now a bullet in Preview (ST-1: and not
// before it is pushed). With FOCUSTIME_SHOTS:
// Status at 1920, 1366 and on the phone, light and dark, Larger text at 1920, and the Push to DevOps preview.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS, shotBoth } from "../shots.ts";
import { onePreview } from "../one-preview.ts";

const T = 300_000;
const THURSDAY = "2026-11-05T10:00:00-05:00";

async function openStatus(page: Page) {
  await page.goto(`${new URL(page.url()).origin}/#/status`);
  await page.getByRole("heading", { name: "Status report" }).waitFor({ timeout: 30_000 });
  await page.locator("[data-updated]").waitFor();
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
    await expect.poll(() => page.locator(".st-sends").textContent()).toBe("For Monday, Nov 9 · Kat sends it 7:00 AM");
    await expect.poll(() => page.locator("[data-updated]").textContent()).toBe("2 of 5 features have an update");
    await expect.poll(() => page.locator("[data-show=needs] .seg-count").textContent()).toBe("3");
    await page.locator("[data-show=all]").click();
    // WD-1: Status is its own tab, current.
    await expect.poll(() => page.locator('.views .view-tab[aria-current="page"]').textContent()).toMatch(/^Status/);
    if (SHOTS) await shotBoth(page, "sr1-status-1920");
    const supplier = page.getByRole("article", { name: "Supplier onboarding" });
    await expect.poll(() => supplier.locator(".st-part-count").first().textContent()).toBe("· nothing yet");
    await supplier.getByRole("button", { name: "Write a line" }).click();
    await supplier.getByRole("textbox", { name: "New line for Supplier onboarding" }).fill("Sign-up form designed; review with purchasing on Friday.");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("1 line ready to push");
    // ST-1: Preview shows only what is in DevOps: the line isn't a bullet yet, the top line counts it, Show them draws it
    // in its own look.
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const sup = page.getByRole("article", { name: "Supplier onboarding" });
    await expect.poll(() => sup.locator(".st-none").textContent()).toBe("No update yet");
    expect(await sup.locator(".st-bullets li").count()).toBe(0);
    await expect.poll(() => page.locator("[data-preview-top] span").first().textContent()).toBe("1 line isn't on the report yet");
    await page.getByRole("button", { name: "Show them" }).click();
    await expect.poll(() => sup.locator('[data-state="ready"] .st-pending-tag').textContent()).toBe("Ready to push");
    await page.getByRole("button", { name: "Write", exact: true }).click();
    // OP-1: Push to DevOps opens the app's one preview.
    await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
    const dialog = onePreview(page);
    await dialog.waitFor();
    await expect.poll(() => dialog.locator(".wd-fields").textContent()).toContain("Sign-up form designed; review with purchasing on Friday.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr1-push-preview-1920.png` });
    await dialog.getByRole("button", { name: "Add comment in DevOps" }).click();
    await dialog.waitFor({ state: "detached", timeout: 30_000 });
    await expect.poll(() => page.locator("[data-updated]").textContent()).toBe("3 of 5 features have an update");
    expect(await page.locator("[data-foot-bar]").count()).toBe(0);
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
