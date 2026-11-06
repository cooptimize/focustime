// MC-1: meeting capture's main path in demo mode. Wednesday's Northwind weekly status call shows on its Week card with
// what it needs from me; the mark opens the review screen ("Update Northwind's plan") with each proposal and its quotes;
// I skip one, Confirm shows every write first, and one Confirm makes the rest; the skipped one stays Skipped and the
// call reads Reviewed. The clock is pinned to Thursday Nov 5, 2026 10:00 AM ET (the seed's call was the day before).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 120_000;

describe.skipIf(!CHROMIUM)("meeting capture (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("the Week card's call mark opens the review; skip one, Confirm the rest, the call is reviewed", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/week"));
    const mark = page.locator(".call-mark").first();
    await mark.waitFor({ timeout: 30_000 });
    await expect(mark.textContent()).resolves.toBe("Weekly status call· Review 6 proposals");
    await mark.click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    await expect(page.locator(".mtg-prop").count()).resolves.toBe(6);
    await expect(page.locator(".mtg-prop").first().locator(".mtg-quotes blockquote").first().textContent()).resolves.toContain("Dana Brooks");
    // Skip the status comment, then Confirm: every write is shown before anything runs.
    const status = page.locator(".mtg-prop").filter({ hasText: "ready for Northwind to try" });
    await status.getByRole("button", { name: "Skip" }).click();
    await page.getByRole("button", { name: "Confirm 5" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm these changes" });
    await dialog.waitFor();
    await expect(dialog.textContent()).resolves.toMatch(/Create a DevOps item.*Add a comment to a DevOps item/s);
    await expect(dialog.textContent()).resolves.not.toContain("ready for Northwind to try");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.locator(".mtg-done").waitFor({ timeout: 30_000 });
    await expect(page.locator(".mtg-done").textContent()).resolves.toContain("5 done");
    await expect(status.textContent()).resolves.toContain("Skipped");
    // Back on the list, the call is reviewed and nothing is left to do.
    await page.getByRole("button", { name: "Back to client calls" }).first().click();
    await expect.poll(() => page.locator(".mtg-series").first().textContent()).toContain("Reviewed");
    expect(errors).toEqual([]);
  }, T);
});
