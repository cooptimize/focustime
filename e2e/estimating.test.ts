// Step 16.4: simple estimating (whole blocks and S/M/L) and profile photos, in demo mode (fictional data, generated
// avatars, no Graph calls). The scan reads every view's text for fractional amounts: none may show anywhere.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, weekClient, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
/** Decimals and fractions: "0.8 blocks", "1.5 h", "half a block", "½". Times (9:30) and dates are fine. */
const FRACTION = /(?<![\d:])\d+[.,]\d+(?![\d:])|half a block|½|¼|¾/i;

describe.skipIf(!CHROMIUM)("simple estimating and photos (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const planWeek = async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("2");
    await page.keyboard.press("p");
    await page.locator(".planweek .co-step button[aria-label='Previous week']").click();
    await page.locator(".pw-client").first().waitFor();
    return { page, errors };
  };

  it("each client: its whole blocks, a plain status, and why a half-day doesn't count", async () => {
    const { page, errors } = await planWeek();
    const northwind = (await weekClient(page, "Northwind")).locator(".pw-card-head");
    await expect.poll(() => northwind.locator(".pw-fit2").textContent()).toBe("3 planned, 2 available");
    // U4: why a half-day doesn't count is on hover over the fit words (and in the client's panel).
    await expect(northwind.locator(".pw-budget").getAttribute("title")).resolves.toMatch(/^2 blocks this week\. Not counted: Wed AM: mostly meetings/);
    await expect((await weekClient(page, "Cooptimize")).locator(".pw-card-head .pw-fit2").textContent()).resolves.toBe("All 1 planned");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("stories nest in their feature and fill it; over asks once to raise, one click", async () => {
    const { page } = await planWeek();
    const harbor = await weekClient(page, "Harbor");
    const feature = harbor.locator(".pw-row").first();
    await expect.poll(() => feature.locator(".pw-nested > li").count()).toBe(2);
    await expect(feature.locator(".pw-raise").textContent()).resolves.toContain("Stories need more than 1 block. Raise to 2?");
    await feature.getByRole("button", { name: "Raise to 2" }).click();
    await expect.poll(() => feature.locator(".pw-stepper .pw-chip-btn").textContent()).toBe("2 blocks");
    await expect.poll(() => feature.locator(".pw-raise").count()).toBe(0);
    // Northwind's export: an L and an M in 2 blocks needs more stories (no numbers).
    const exp = (await weekClient(page, "Northwind")).locator(".pw-row").first();
    await expect(exp.locator(".pw-fill").textContent()).resolves.toBe("needs more stories");
    await page.close();
  }, T);

  it("whole-block steppers; a story has S, M or L, never blocks", async () => {
    const { page } = await planWeek();
    const feature = (await weekClient(page, "Northwind")).locator(".pw-row").first();
    await feature.getByRole("button", { name: "One block more" }).click();
    await expect.poll(() => feature.locator(".pw-stepper .pw-chip-btn").first().textContent()).toBe("3 blocks");
    await feature.getByRole("button", { name: "One block less" }).first().click();
    await expect.poll(() => feature.locator(".pw-stepper .pw-chip-btn").first().textContent()).toBe("2 blocks");
    const story = feature.locator(".pw-nested > li").first();
    await story.locator(".pw-size").click();
    await expect(page.getByRole("menuitem").allTextContents()).resolves.toEqual(expect.arrayContaining([expect.stringContaining("S · about an hour"), expect.stringContaining("M · a couple of hours"), expect.stringContaining("L · about a whole block")]));
    await page.keyboard.press("Escape");
    await page.close();
  }, T);

  it("a story without its feature on the list says where it belongs; Add the feature moves it under", async () => {
    const { page } = await planWeek();
    const atlas = await weekClient(page, "Atlas");
    await expect(atlas.locator(".pw-parent").first().textContent()).resolves.toContain("Under Shipment tracking dashboard");
    await atlas.getByRole("button", { name: "Add the feature" }).click();
    await expect.poll(() => atlas.locator(".pw-nested > li").count(), { timeout: 10_000 }).toBe(1);
    await expect(atlas.locator(".pw-parent").count()).resolves.toBe(0);
    await page.close();
  }, T);

  it("photos: generated avatars with presence on the corner; initials when someone has none", async () => {
    const { page, errors } = await planWeek();
    await expect.poll(() => page.locator(".topbar .person-chip .avatar img").count(), { timeout: 10_000 }).toBe(1);
    await page.locator(".pw-row").first().hover();
    await page.locator(".pw-row button.more").first().click();
    await page.getByRole("menuitem", { name: /Needs help from/ }).click();
    const dlg = page.getByRole("dialog", { name: /Needs help from/ });
    await expect.poll(() => dlg.locator(".help-people .avatar img").count(), { timeout: 10_000 }).toBe(3);
    await expect(dlg.locator(".help-people .avatar-initials").allTextContents()).resolves.toEqual(["AK"]);
    await expect(dlg.locator(".help-people .avatar .pres").count()).resolves.toBe(4);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("no fractional amounts anywhere: Plan the week, Week, Today, Plan the day, Check-in, Close out, Roadmap", async () => {
    // The scan catches what step 16.4 removed, and leaves times and dates alone.
    for (const bad of ["Room for about 1.5 blocks more", "0.8 blocks", "About half a block over", "1.5 h"]) expect(bad).toMatch(FRACTION);
    for (const ok of ["9:30 AM", "Nov 2, 2026", "3 planned, 2 available", "1:30 PM to 5:00 PM"]) expect(ok).not.toMatch(FRACTION);
    const { page } = await freshPage(h);
    const views: [string, string][] = [
      ["#/week/plan/2026-11-02", ".pw-client"],
      ["#/week", ".week-head"],
      ["#/today", ".today-view"],
      ["#/today/plan", ".pd2-status"],
      ["#/today/checkin", "main"],
      ["#/today/closeout", "main"],
      ["#/roadmap", ".dl-row"],
    ];
    for (const [hash, ready] of views) {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.locator(ready).first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(600);
      const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      const titles = await page.locator("[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
      for (const t of [text, ...titles]) expect(t.match(FRACTION)?.[0] ?? null, `${hash}: ${t.slice(Math.max(0, (t.search(FRACTION) ?? 0) - 40), (t.search(FRACTION) ?? 0) + 40)}`).toBeNull();
    }
    await page.close();
  }, T);
});
