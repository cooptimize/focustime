// Step 16.2, NV-1: four tabs (1–4: Today · Week · Ahead · Inbox), Week's Board · Commit and Ahead's Grid · Gantt · Fix next (AH-1),
// Plan today as the Board focused on a day, addresses (back and reload), P, entry points from the Week and notification routes. Demo mode (fictional data), clock pinned to Mon Nov 2, 9:30 AM.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const hash = (page: Page) => page.evaluate(() => location.hash);
const tab = (page: Page) => page.locator(".views .view-tab[aria-current=page]").textContent();
const mode = (page: Page) => page.locator(".mode-switch .ms-btn[aria-current=page]").first().textContent();
const route = (page: Page, r: string) => page.evaluate((r) => window.dispatchEvent(new CustomEvent("focustime:open-route", { detail: r })), r);

describe.skipIf(!CHROMIUM)("Navigation: tabs, modes and addresses (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("four tabs in order, no Plan tab, no ritual chips, no context line; 1–4 switch them", async () => {
    const { page, errors } = await freshPage(h);
    await expect(page.locator(".views .view-tab").allTextContents()).resolves.toEqual(["Today", "Week", "Ahead", expect.stringMatching(/^Inbox/)]);
    await expect(page.locator(".ritual-bar, .context-line, .weeknav").count()).resolves.toBe(0);
    for (const [k, name, h2] of [["2", "Week", "#/week"], ["3", "Ahead", "#/ahead"], ["4", "Inbox", "#/inbox"], ["1", "Today", "#/today"]] as const) {
      await page.keyboard.press(k);
      await expect.poll(() => tab(page)).toMatch(new RegExp(`^${name}`));
      expect(await hash(page)).toBe(h2);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Today has no switch; P opens Plan today on Week's Board; Back returns; Commit today commits and the card goes", async () => {
    const { page } = await freshPage(h);
    expect(await page.locator(".today-view .mode-switch").count()).toBe(0);
    // Demo Monday 9:30 AM, not planned yet: the Plan today card shows and Week's Board has the due dot.
    await page.getByRole("region", { name: "Plan today" }).waitFor();
    await page.keyboard.press("p");
    await page.waitForSelector(".pd2-left");
    expect(await hash(page)).toBe("#/week/day");
    await expect(page.locator(".pd2-title h2").textContent()).resolves.toContain("Plan today");
    await expect.poll(() => tab(page)).toBe("Week");
    expect(await page.locator(".mode-switch .ms-btn", { hasText: "Board" }).locator(".ms-due").count()).toBe(1);
    // Back in the browser returns to Today; forward to Plan today.
    await page.goBack();
    await expect.poll(() => hash(page)).toBe("#/today");
    await page.goForward();
    await page.waitForSelector(".pd2-left");
    // Add one pick, Commit today: committed and back to the Board; Today's card is gone.
    await page.locator(".pd2-right li.pd2-add:not(.planned) button.pd2-plus").first().click();
    await page.locator(".pd2-right li.pd2-add.planned").first().waitFor();
    await page.locator(".pd2-head .done-btn").click();
    await expect.poll(async () => /^#\/week(\/2026-11-02)?$/.test(await hash(page)) || (await page.locator(".pd-committed").count()) > 0).toBe(true);
    if (await page.locator(".pd-committed").count()) {
      await page.locator(".pd-committed").getByRole("button", { name: "Not now" }).click();
      await page.locator(".pd2-head .done-btn").click();
    }
    await expect.poll(() => hash(page)).toMatch(/^#\/week(\/2026-11-02)?$/);
    await page.keyboard.press("1");
    await page.locator(".today-view .card, .today-view .tc-card").first().waitFor().catch(() => undefined);
    await expect.poll(() => page.getByRole("region", { name: "Plan today" }).count()).toBe(0);
    await page.close();
  }, T);

  it("Midday check-in Done returns to Today; Close out has its own day in the address", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("m");
    await expect.poll(() => hash(page)).toBe("#/today/checkin");
    await page.locator(".mode-checkin .done-btn").click();
    await expect.poll(() => hash(page)).toBe("#/today");
    await page.keyboard.press("e");
    await expect.poll(() => hash(page)).toBe("#/today/closeout");
    await page.locator(".closeout-panel .co-step button[aria-label='Previous day']").click();
    await expect.poll(() => hash(page)).toBe("#/today/closeout/2026-11-01");
    await page.close();
  }, T);

  it("Week: header with the week and musts, Board · Commit; Commit defaults to next week with ‹ ›; W and P toggle", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    await expect(page.locator(".week-head h2").textContent()).resolves.toMatch(/^Week of Nov 2/);
    await expect(page.locator(".mode-switch .ms-btn").allTextContents()).resolves.toEqual([expect.stringMatching(/^Board/), "Plan", "Team"]);
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/week/commit");
    await expect.poll(() => page.locator(".planweek h2").first().textContent()).toBe("Plan the week of Nov 9");
    await page.locator(".planweek .co-step button[aria-label='Previous week']").click();
    await expect.poll(() => hash(page)).toBe("#/week/commit/2026-11-02");
    await expect.poll(() => page.locator(".planweek h2").first().textContent()).toBe("Plan the week of Nov 2");
    await page.keyboard.press("w");
    await expect.poll(() => mode(page)).toMatch(/^Board/);
    await page.close();
  }, T);

  it("a Week day header's Plan chip opens Plan today's Board on that day; the address survives a reload", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const tue = page.locator(".day-plan").nth(1);
    await tue.click();
    await expect.poll(() => hash(page)).toBe("#/week/day/2026-11-03");
    await expect.poll(() => tab(page)).toBe("Week");
    await expect.poll(() => page.locator(".pd2-title h2").textContent()).toContain("Plan Tuesday, Nov 3");
    await page.reload();
    await page.waitForSelector(".pd2-left");
    await expect(page.locator(".pd2-title h2").textContent()).resolves.toContain("Plan Tuesday, Nov 3");
    await page.close();
  }, T);

  it("+ Add work on a Week card: the Board focused on that day and block", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const card = page.locator(".half", { hasText: "Northwind" }).first();
    await card.click({ position: { x: 12, y: 12 } });
    await card.getByRole("button", { name: "+ Add work" }).click();
    await page.locator(".pd2-right .pd2-pane-title", { hasText: "Northwind" }).waitFor();
    expect(await hash(page)).toMatch(/^#\/week\/day\/2026-11-0\d\/(AM|PM)$/);
    await page.close();
  }, T);

  it("Ahead: Grid · Gantt · Fix next; the ⋯ menu has Commands, the Guide, the keys, Send feedback and About; the initials menu has Settings", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("3");
    await expect.poll(() => page.locator(".mode-switch .ms-btn").allTextContents()).toEqual(["Grid", "Gantt", "Fix next · 7"]);
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/ahead/gantt");
    await page.locator(".ahead .pa-grid").waitFor();
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/ahead");
    await page.locator(".top-more").click();
    await expect(page.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringMatching(/^Notifications/), expect.stringMatching(/^Commands/), expect.stringMatching(/^Guide/), expect.stringMatching(/^Keyboard shortcuts/), "Send feedback", "Admin", "About"]);
    await page.keyboard.press("Escape");
    await page.locator(".person-chip").click();
    await page.getByRole("menuitem", { name: /^Settings/ }).click();
    await expect.poll(() => hash(page)).toBe("#/settings/you");
    await page.keyboard.press("Escape");
    await expect.poll(() => hash(page)).toBe("#/ahead");
    await page.close();
  }, T);

  it("notification routes open tab and mode", async () => {
    const { page } = await freshPage(h);
    for (const [r, want] of [
      ["checkin", "#/today/checkin"],
      ["closeout", "#/today/closeout"],
      ["planday", "#/week/day"],
      ["ahead", "#/ahead/gantt"],
      ["aheaditem:1113", "#/ahead/item/1113"],
      ["planweek:2026-11-09", "#/week/commit/2026-11-09"],
      ["inbox", "#/inbox/captures"],
      ["followup:1", "#/inbox/1"],
      ["settings:notifications", "#/settings/notifications"],
      ["focus", "#/focus"],
      ["vm", "#/today"],
      ["today", "#/today"],
    ] as const) {
      await route(page, r);
      await expect.poll(() => hash(page), { message: r }).toBe(want);
    }
    await page.close();
  }, T);
});
