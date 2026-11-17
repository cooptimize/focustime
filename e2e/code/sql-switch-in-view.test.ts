// UC-2 (browser, demo mode): in an open database, the Group by switch (Schema · Type) stays in view while its objects
// scroll: it sticks under the database's own row, at the top, the middle and the end of a long database. Switching
// keeps the place: the object at the top of the list is still there, at the same height. Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
let h: Harness;
const panel = (page: Page) => page.locator("[data-code-page]");
const scrollBox = (page: Page) => panel(page).locator(".cv-side-scroll").first();
/** Whether the switch's buttons are inside the list's visible box and nothing covers them. */
const switchInView = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-code-page] .cv-side-scroll")!.getBoundingClientRect();
    const btns = [...document.querySelectorAll<HTMLElement>("[data-code-page] [data-sql-group-btn]")];
    return btns.length === 2 && btns.every((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && !!hit && b.contains(hit);
    });
  });
/** The first object row showing under the sticky row, and how far down the list it is. */
const topObject = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-code-page] .cv-side-scroll")!.getBoundingClientRect();
    const head = document.querySelector<HTMLElement>("[data-code-page] [data-sql-head]")!.getBoundingClientRect();
    const row = [...document.querySelectorAll<HTMLElement>("[data-code-page] .cv-sql-row[data-code-listed]")].find((r) => r.getBoundingClientRect().top >= head.bottom - 1)!;
    return { listed: row.dataset.codeListed!, top: Math.round(row.getBoundingClientRect().top - box.top) };
  });

describe.skipIf(!CHROMIUM)("UC-2: Code's Schema · Type switch stays in view (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("sticks under the open database's row at its top, middle and end, and a switch keeps the place", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 640 });
    await page.evaluate(() => (location.hash = "#/code/Northwind/kinds"));
    await panel(page).locator("[data-code-kinds]").waitFor({ timeout: 30_000 });
    const dbs = panel(page).locator('[data-code-kind="database"]');
    // Every folder of every database open, then every database but Gold closed again: one long database.
    await dbs.locator("[data-sql-expand]").click();
    const others = dbs.locator('.cv-thing-caret[aria-expanded=true]:not([aria-label="Inside Gold"])');
    while (await others.count()) await others.first().click();
    const gold = dbs.locator("li.cv-thing.db-open");
    await expect.poll(() => gold.count()).toBe(1);
    expect(await gold.locator("[data-sql-head]").getAttribute("data-sql-head")).toBe("Gold");
    // One switch, under the database's own row.
    expect(await panel(page).locator("[data-sql-bar]").count()).toBe(1);
    expect(await gold.locator("[data-sql-head] [data-sql-bar]").count()).toBe(1);
    const goldBox = await gold.boundingBox();
    const view = await scrollBox(page).boundingBox();
    expect(goldBox!.height, "Gold is longer than the list's box").toBeGreaterThan(view!.height * 1.5);
    // The top, the middle and the end of Gold's objects.
    const span = await gold.evaluate((li) => {
      const box = li.closest(".cv-side-scroll") as HTMLElement;
      return { top: li.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop, height: li.getBoundingClientRect().height, view: box.clientHeight };
    });
    for (const [where, y] of [["top", span.top], ["middle", span.top + span.height / 2 - span.view / 2], ["end", span.top + span.height - span.view]] as const) {
      await scrollBox(page).evaluate((el, to) => (el.scrollTop = to), y);
      await page.waitForTimeout(150);
      expect(await switchInView(page), `the switch at Gold's ${where}`).toBe(true);
    }
    // In the middle, a switch keeps the object at the top of the list where it was.
    await scrollBox(page).evaluate((el, to) => (el.scrollTop = to), span.top + span.height / 2 - span.view / 2);
    await page.waitForTimeout(150);
    const before = await topObject(page);
    await panel(page).locator('[data-sql-group-btn="type"]').click();
    await expect.poll(() => panel(page).locator("[data-sql-group]").getAttribute("data-sql-group")).toBe("type");
    await page.waitForTimeout(300);
    const row = panel(page).locator(`.cv-sql-row[data-code-listed="${before.listed}"]`);
    expect(await row.count(), "the object is still shown, its folders opened").toBe(1);
    const at = await row.evaluate((r) => Math.round(r.getBoundingClientRect().top - r.closest(".cv-side-scroll")!.getBoundingClientRect().top));
    expect(Math.abs(at - before.top), `${before.listed} stays at the same height`).toBeLessThanOrEqual(2);
    expect(await switchInView(page)).toBe(true);
    // And back.
    await panel(page).locator('[data-sql-group-btn="schema"]').click();
    await page.waitForTimeout(300);
    expect(await switchInView(page)).toBe(true);
    // By keyboard: the switch's buttons take Tab and Enter.
    await panel(page).locator('[data-sql-group-btn="type"]').focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => panel(page).locator("[data-sql-group]").getAttribute("data-sql-group")).toBe("type");
    await panel(page).locator('[data-sql-group-btn="schema"]').click();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("with several databases open, the one switch sticks at the top of the group", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 640 });
    await page.evaluate(() => (location.hash = "#/code/Northwind/kinds"));
    await panel(page).locator("[data-code-kinds]").waitFor({ timeout: 30_000 });
    await panel(page).locator('[data-code-kind="database"] [data-sql-expand]').click();
    expect(await panel(page).locator("[data-sql-bar]").count()).toBe(1);
    await scrollBox(page).evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
    await page.waitForTimeout(150);
    expect(await switchInView(page)).toBe(true);
    await page.close();
  }, T);
});
