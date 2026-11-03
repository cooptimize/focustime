// E2 (D446): estimating in hours. A feature's load comes from its stories on the list (S 1h, M 2h, L 4h, unsized 2h)
// once one is sized, else its estimate in whole hours (the shared "− 6h +" stepper); a client's fit is its real free
// time against its musts ("8h free · 10h planned", the amber "about 2h over"). Profile photos, in demo mode (fictional
// data, generated avatars, no Graph calls). The scans read every view for decimals and fractions, and Plan the week,
// Plan the day and Plan ahead for blocks used as an amount: none may show anywhere (hours are the unit).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openPlanDay, startDemo, weekClient, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
/** Decimals and fractions: "0.8 blocks", "1.5 h", "½", "¼", "¾". Times (9:30) and dates are fine. */
const FRACTION = /(?<![\d:])\d+[.,]\d+(?![\d:])|½|¼|¾/i;
/** A block as an amount of work: "2 blocks", "1½ blocks", "half a block free", "blocks planned". A block as the place is fine. */
const BLOCK_AMOUNT = /\d\s*(½\s*)?blocks?\b|½\s*blocks?|half a block\b|\bblocks? (free|planned|available|over|left)\b|\bof \d+ blocks?/i;

describe.skipIf(!CHROMIUM)("estimating in hours and photos (browser, demo mode)", () => {
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

  it("each client: its free time and what's planned in hours, amber when over, never red; the over line names the way out", async () => {
    const { page, errors } = await planWeek();
    const nw = await weekClient(page, "Northwind");
    const northwind = nw.locator(".pw-card-head");
    await expect.poll(() => northwind.locator(".pw-fit2").textContent()).toBe("8h free · 10h planned · about 2h over");
    await expect(northwind.locator(".pw-fit2 .over-word").textContent()).resolves.toBe(" · about 2h over");
    await expect(northwind.locator(".pw-fit2").evaluate((e) => getComputedStyle(e).color)).resolves.toBe(await page.evaluate(() => { const d = document.createElement("span"); d.style.color = "var(--watch)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }));
    await expect(northwind.locator(".pw-budget").getAttribute("title")).resolves.toMatch(/^Free focus time in Northwind's blocks this week, after meetings/);
    await expect(nw.locator("p.pw-over").textContent()).resolves.toBe("About 2h more than Northwind's free time this week. Make one a nice to have, or borrow Friday.");
    await expect((await weekClient(page, "Cooptimize")).locator(".pw-card-head .pw-fit2").textContent()).resolves.toBe("2h free · 2h planned");
    // The client lines say the same.
    await expect(page.locator('.pw-line[aria-label="Northwind"] .pl-fit').textContent()).resolves.toBe("8h free · 10h planned · about 2h over");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("stories nest in their feature and its load is their hours; no stepper; sizing a story changes it", async () => {
    const { page } = await planWeek();
    const harbor = await weekClient(page, "Harbor");
    const feature = harbor.locator(".pw-row").first();
    await expect.poll(() => feature.locator(".pw-nested > li").count()).toBe(2);
    // An S and an S: 2h, exact (every story sized). Its estimate (4h) is ignored.
    const load = feature.locator(":scope > .hours-stepper .hs-value");
    await expect(load.textContent()).resolves.toBe("2h");
    await expect(load.getAttribute("title")).resolves.toBe("From its stories");
    await expect(feature.locator(":scope > .hours-stepper button").count()).resolves.toBe(0);
    await expect(feature.locator(":scope > .pw-fill").textContent()).resolves.toBe("from stories");
    await expect(feature.locator(".pw-nested > li .size-chip").allTextContents()).resolves.toEqual(["S · 1h", "S · 1h"]);
    // The first S becomes an L: 5h.
    await feature.locator(".pw-nested > li").first().locator(".size-chip").click();
    await expect(page.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringContaining("S · 1h"), expect.stringContaining("M · 2h"), expect.stringContaining("L · 4h"), expect.stringContaining("Clear")]);
    await page.getByRole("menuitem", { name: /^L · 4h/ }).click();
    await expect.poll(() => load.textContent()).toBe("5h");
    await expect.poll(() => harbor.locator(".pw-card-head .pw-fit2").textContent()).toBe("2h free · 5h planned · about 3h over");
    // Clearing a size: it counts as 2h, marked as an estimate, never an error.
    await feature.locator(".pw-nested > li").first().locator(".size-chip").click();
    await page.getByRole("menuitem", { name: /^Clear/ }).click();
    await expect.poll(() => feature.locator(".pw-nested > li").first().locator(".size-chip").textContent()).toBe("Size? · 2h");
    await expect.poll(() => load.textContent()).toBe("about 3h");
    await page.close();
  }, T);

  it("a feature with no stories on the list: its estimate on the stepper, 1h steps, click to type; Enter saves, Esc cancels", async () => {
    const { page } = await planWeek();
    const northwind = await weekClient(page, "Northwind");
    const est = northwind.locator(".pw-row", { has: page.locator(":scope > .hours-stepper:not(.derived)") }).first();
    const value = est.locator(":scope > .hours-stepper .hs-value");
    await expect(value.textContent()).resolves.toBe("about 4h");
    await est.hover();
    await est.getByRole("button", { name: "More: 5h" }).click();
    await expect.poll(() => value.textContent()).toBe("about 5h");
    await expect.poll(() => northwind.locator(".pw-card-head .pw-fit2").textContent()).toBe("8h free · 11h planned · about 3h over");
    // Click the value: a number box. Esc keeps the old value; Enter saves whole hours.
    await value.click();
    const box = est.locator(".hs-input");
    await box.fill("30");
    await box.press("Escape");
    await expect.poll(() => value.textContent()).toBe("about 5h");
    await value.click();
    await box.fill("12");
    await box.press("Enter");
    await expect.poll(() => value.textContent()).toBe("about 12h");
    // Above 8h the arrows step 2h.
    await est.hover();
    await est.getByRole("button", { name: "More: 14h" }).click();
    await expect.poll(() => value.textContent()).toBe("about 14h");
    // A typed value out of range changes nothing.
    await value.click();
    await box.fill("81");
    await box.press("Enter");
    await expect.poll(() => value.textContent()).toBe("about 14h");
    // Down to 1h, the floor.
    await value.click();
    await box.fill("1");
    await box.press("Enter");
    await expect.poll(() => value.textContent()).toBe("about 1h");
    await est.hover();
    await expect(est.locator(":scope > .hours-stepper .hs-step").first().isDisabled()).resolves.toBe(true);
    // A story has a size chip, never hours of its own to set: S, M, L, or a muted Size?.
    const story = northwind.locator(".pw-row").first().locator(".pw-nested > li");
    await expect(story.locator(".size-chip").allTextContents()).resolves.toEqual(["L · 4h", "Size? · 2h"]);
    await expect(story.nth(1).locator(".size-chip").evaluate((e) => e.classList.contains("unsized"))).resolves.toBe(true);
    await page.close();
  }, T);

  it("the feature's panel has the same stepper and size chips", async () => {
    const { page, errors } = await planWeek();
    const northwind = await weekClient(page, "Northwind");
    await northwind.locator(".pw-row .pw-open", { hasText: "Order history export" }).click();
    const panel = page.locator(".dp-section[aria-label='Estimate']");
    await expect(panel.locator(".hs-value").textContent()).resolves.toBe("about 6h");
    await expect(panel.locator(".muted").first().textContent()).resolves.toBe("from stories");
    await expect(panel.locator(".size-chip").allTextContents()).resolves.toEqual(["L · 4h", "Size? · 2h"]);
    await panel.locator(".size-chip").nth(1).click();
    await page.getByRole("menuitem", { name: /^S · 1h/ }).click();
    await expect.poll(() => panel.locator(".hs-value").textContent()).toBe("5h");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a feature's other stories are one muted count line, not their titles; it opens the feature's panel with owner and state", async () => {
    const { page, errors } = await planWeek();
    const line = page.locator(".pw-client .pw-row > .pw-kids").first();
    await line.waitFor({ timeout: 10_000 });
    const text = (await line.textContent()) ?? "";
    expect(text).toMatch(/^\d+ more stor(y|ies)( · \d+ assigned to others)?$/);
    expect(text).not.toMatch(/ · 0 assigned/);
    await line.click();
    const panel = page.locator(".dp-section[aria-label='Stories'] .pw-pstories li");
    await expect.poll(() => panel.count()).toBeGreaterThanOrEqual(Number(text.split(" ")[0]));
    await expect(panel.first().locator(".muted").textContent()).resolves.toMatch(/ · /);
    expect(errors).toEqual([]);
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

  it("no decimals or fractions anywhere: Plan the week, Week, Today, Plan the day, Check-in, Close out, Roadmap, Plan ahead", async () => {
    for (const bad of ["Room for about 1.5 blocks more", "0.8 blocks", "¼ block", "¾ blocks", "1.5 h", "½ block", "2½ planned"]) expect(bad).toMatch(FRACTION);
    for (const ok of ["9:30 AM", "Nov 2, 2026", "8h free · 10h planned", "about 6h", "1:30 PM to 5:00 PM"]) expect(ok).not.toMatch(FRACTION);
    const { page } = await freshPage(h);
    const views: [string, string][] = [
      ["#/week/plan/2026-11-02", ".pw-client"],
      ["#/week", ".week-head"],
      ["#/today", ".today-view"],
      ["#/today/plan", ".pd2-status"],
      ["#/today/checkin", "main"],
      ["#/today/closeout", "main"],
      ["#/roadmap", ".dl-row"],
      ["#/roadmap/ahead", ".pa-cap"],
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

  it("no block as an amount in Plan the week, Plan the day or Plan ahead: estimates are hours, with about where estimated", async () => {
    for (const bad of ["2 blocks", "1½ blocks", "½ block", "half a block free", "2 blocks free", "1 of 2 blocks", "blocks planned"]) expect(bad).toMatch(BLOCK_AMOUNT);
    for (const ok of ["One focus block", "Pinned to this block", "No block", "Click a block to plan", "8h free · 10h planned", "Free focus time in Northwind's blocks this week"]) expect(ok).not.toMatch(BLOCK_AMOUNT);
    const { page, errors } = await freshPage(h);
    const scan = async (where: string) => {
      const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      const titles = await page.locator("[title], [aria-label]").evaluateAll((els) => els.flatMap((e) => [e.getAttribute("title") ?? "", e.getAttribute("aria-label") ?? ""]));
      for (const t of [text, ...titles]) expect(t.match(BLOCK_AMOUNT)?.[0] ?? null, `${where}: ${t.slice(Math.max(0, t.search(BLOCK_AMOUNT) - 40), t.search(BLOCK_AMOUNT) + 40)}`).toBeNull();
      // Every estimate a stepper shows is whole hours, "about" unless it comes from sized stories.
      for (const v of await page.locator(".hours-stepper .hs-value").allTextContents()) expect(v, where).toMatch(/^(about )?\d+h$/);
      for (const v of await page.locator(".size-chip").allTextContents()) expect(v, where).toMatch(/^(S|M|L|Size\?)( · \d+h)?$/);
    };
    await page.evaluate(() => (location.hash = "#/week/plan/2026-11-02"));
    await page.locator(".pw-client").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    for (const n of ["Cooptimize", "Northwind", "Harbor", "Atlas"]) {
      await weekClient(page, n);
      await scan(`Plan the week, ${n}`);
    }
    await openPlanDay(page);
    await page.waitForTimeout(600);
    await scan("Plan the day");
    await page.evaluate(() => (location.hash = "#/roadmap/ahead"));
    await page.locator(".pa-cap").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    await scan("Plan ahead");
    await expect(page.locator(".pa-cell .hs-value").first().textContent()).resolves.toMatch(/^(about )?\d+h$/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
