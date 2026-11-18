// RQ-1: a call's rows with Northwind's process requiring a Target Date on new features and stories (demo mode,
// FOCUSTIME_DEMO_DEVOPS_RULES=target). A story row marks Target Date Needed and holds Create, and its three questions
// take the row's width. A row changed to the feature tier says the same, has no three questions, and offers Create and
// break down: Not now opens nothing; confirmed, Break down opens on the new feature with Run started, and the row keeps
// a Break down button. Clock: Thursday Nov 5, 2026 10:00 AM ET (the call was Monday).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { onePreview } from "../one-preview.ts";

const T = 240_000;
async function pickDate(page: Page, scope: Locator, label: RegExp, day: string) {
  await scope.getByRole("button", { name: label }).first().click();
  await page.locator(".dp-pop input.dp-box").fill(day);
  await page.locator(".dp-pop input.dp-box").press("Enter");
  await page.locator(".dp-pop").waitFor({ state: "detached" });
}

describe.skipIf(!CHROMIUM)("RQ-1: a call's rows ask what the process needs (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_DEVOPS_RULES: "target" }, "2026-11-05T10:00:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("Needed on a story row and a feature row; the questions at story level only; Create and break down", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/week"));
    const mark = page.locator(".call-mark").first();
    await mark.waitFor({ timeout: 30_000 });
    await mark.click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });

    // A story: Target Date Needed when the row opens, Create waits; the three questions take the row's width.
    const story = page.locator(".mtg-prop").filter({ has: page.locator("input[value='Monthly statement as a PDF']") });
    await expect.poll(() => story.locator(".mtg-need").first().textContent(), { timeout: 20_000 }).toContain("Target Date");
    await expect(story.getByRole("button", { name: "Create in DevOps" }).isDisabled()).resolves.toBe(true);
    await story.getByRole("button", { name: /^More: description, size and details/ }).click();
    await expect(story.locator("textarea.tq-box").count()).resolves.toBe(3);
    const widths = await story.evaluate((el) => ({ row: el.querySelector(".mtg-prop-body")!.getBoundingClientRect().width, box: el.querySelector("textarea.tq-box")!.getBoundingClientRect().width }));
    expect(widths.box).toBeGreaterThan(widths.row * 0.5);

    // The Epic changed to a Feature: Needed again, no questions, and Create and break down.
    const row = page.locator(".mtg-prop").filter({ has: page.locator("input[value='Accountant reporting area']") });
    await row.getByRole("radio", { name: "Feature" }).click();
    const both = row.getByRole("button", { name: "Create and break down" });
    await both.waitFor({ timeout: 20_000 });
    await expect.poll(() => row.locator(".mtg-need").first().textContent(), { timeout: 20_000 }).toContain("Target Date");
    await expect(both.isDisabled()).resolves.toBe(true);
    await expect(row.locator("textarea.tq-box").count()).resolves.toBe(0);
    await pickDate(page, row, /^Target date for Accountant reporting area/, "2026-12-18");
    await expect.poll(() => both.isDisabled(), { timeout: 15_000 }).toBe(false);

    // Not now: nothing is written and Break down doesn't open.
    await both.click();
    let d = onePreview(page);
    await d.waitFor({ timeout: 20_000 });
    await d.getByRole("button", { name: "Not now" }).click();
    await d.waitFor({ state: "detached" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog", { name: /^Break down / }).count()).resolves.toBe(0);

    // Confirmed: Break down opens on the new feature with Run started (cards come without pressing Run).
    await both.click();
    d = onePreview(page);
    await d.waitFor({ timeout: 20_000 });
    await expect(d.textContent()).resolves.toContain("2026-12-18");
    await d.locator("button.commit").click();
    const panel = page.getByRole("dialog", { name: /^Break down Feature: Accountant reporting area/ });
    await panel.waitFor({ timeout: 30_000 });
    await panel.getByRole("listitem", { name: /^Card / }).first().waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    // The created row keeps a Break down button.
    await page.locator(".mtg-fold button").first().click();
    await expect.poll(() => page.locator(".mtg-prop.confirmed").filter({ hasText: "Accountant reporting area" }).getByRole("button", { name: /Break down/ }).count(), { timeout: 15_000 }).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
