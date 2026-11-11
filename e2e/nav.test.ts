// Step 16.2, NV-1, WD-1, RF-1: five tabs (1–5: Day · Week · Ahead · Status · Inbox), Week with no switch and the Add work panel,
// Ahead's Grid · Gantt · Readiness · Backlog, addresses (back and reload), P, entry points from the Week and notification routes. Demo mode (fictional data), clock pinned to Mon Nov 2, 9:30 AM.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const hash = (page: Page) => page.evaluate(() => location.hash);
const tab = (page: Page) => page.locator(".views .view-tab[aria-current=page]").textContent();
const route = (page: Page, r: string) => page.evaluate((r) => window.dispatchEvent(new CustomEvent("focustime:open-route", { detail: r })), r);

describe.skipIf(!CHROMIUM)("Navigation: tabs, modes and addresses (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("five tabs in order (Day · Week · Ahead · Status · Inbox), no Plan or Team tab, no ritual chips, no context line; 1–5 switch them", async () => {
    const { page, errors } = await freshPage(h);
    await expect(page.locator(".views .view-tab").allTextContents()).resolves.toEqual(["Day", "Week", "Ahead", "Status", expect.stringMatching(/^Inbox/)]);
    await expect(page.locator(".ritual-bar, .context-line, .weeknav").count()).resolves.toBe(0);
    for (const [k, name, h2] of [["2", "Week", "#/week"], ["3", "Ahead", "#/ahead"], ["4", "Status", "#/status"], ["5", "Inbox", "#/inbox"], ["1", "Day", "#/day"]] as const) {
      await page.keyboard.press(k);
      await expect.poll(() => tab(page)).toMatch(new RegExp(`^${name}`));
      expect(await hash(page)).toBe(h2);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day has no switch; P opens Week with Add work; Back returns; Confirm the day from its header and the card goes", async () => {
    const { page } = await freshPage(h);
    expect(await page.locator(".today-view .mode-switch").count()).toBe(0);
    // Demo Monday 9:30 AM, not planned yet: the Plan today card shows.
    await page.getByRole("region", { name: "Add work" }).waitFor();
    await page.keyboard.press("p");
    await page.locator("aside.add-work-panel").waitFor();
    expect(await hash(page)).toBe("#/week/add");
    await expect.poll(() => tab(page)).toBe("Week");
    // Back in the browser returns to Day; forward to the panel.
    await page.goBack();
    await expect.poll(() => hash(page)).toBe("#/day");
    await page.goForward();
    await page.locator("aside.add-work-panel").waitFor();
    // Add one to-do, then Confirm Mon from its day header: Day's card is gone.
    await page.locator("aside.add-work-panel .aw-row:not(.placed) button.aw-plus").first().click();
    await page.locator("aside.add-work-panel .aw-row.placed").first().waitFor();
    const head = page.locator("header.day-head", { has: page.locator(".dow", { hasText: "Mon" }) }).first();
    await head.hover();
    await head.getByRole("button", { name: /^Actions for Mon/ }).click();
    await page.getByRole("menuitem", { name: /^Confirm Mon, Nov 2/ }).click();
    await page.getByText("Confirmed Mon, Nov 2").first().waitFor();
    await page.keyboard.press("1");
    await page.locator(".today-view").waitFor();
    await expect.poll(() => page.getByRole("region", { name: "Add work" }).count()).toBe(0);
    await page.close();
  }, T);

  it("Midday check-in Done returns to Day; Close out has its own day in the address", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("m");
    await expect.poll(() => hash(page)).toBe("#/day/checkin");
    await page.locator(".mode-checkin .done-btn").click();
    await expect.poll(() => hash(page)).toBe("#/day");
    await page.keyboard.press("e");
    await expect.poll(() => hash(page)).toBe("#/day/closeout");
    await page.locator(".closeout-panel .co-step button[aria-label='Previous day']").click();
    await expect.poll(() => hash(page)).toBe("#/day/closeout/2026-11-01");
    await page.close();
  }, T);

  it("Week: header with the week, no mode switch; P toggles Add work; ] steps to next week and the panel follows", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    await expect(page.locator(".wd1-head h2").first().textContent()).resolves.toMatch(/Nov 2/);
    expect(await page.locator(".week-view .mode-switch, .wd1-head .mode-switch").count()).toBe(0);
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/week/add");
    await page.keyboard.press("]");
    await expect.poll(() => hash(page)).toBe("#/week/2026-11-09/add");
    await page.locator("aside.add-work-panel").waitFor();
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/week/2026-11-09");
    await page.close();
  }, T);

  it("a day header's Add work opens the panel on that day; the address survives a reload", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const head = page.locator("header.day-head", { has: page.locator(".dow", { hasText: "Tue" }) }).first();
    await head.hover();
    await head.getByRole("button", { name: /^Actions for Tue/ }).click();
    await page.getByRole("menuitem", { name: /^Add work to this day/ }).click();
    await expect.poll(() => hash(page)).toMatch(/^#\/week\/day\/2026-11-03/);
    await expect.poll(() => tab(page)).toBe("Week");
    await page.reload();
    await expect.poll(() => page.locator("aside.add-work-panel").getAttribute("data-add-panel")).toMatch(/^2026-11-03\|/);
    await page.close();
  }, T);

  it("+ Add on a Week card: the panel on that day and block", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const card = page.locator(".half", { hasText: "Northwind" }).first();
    await card.locator(".add-work.add-row").click();
    await page.locator("aside.add-work-panel").waitFor();
    expect(await hash(page)).toMatch(/^#\/week\/day\/2026-11-0\d\/(AM|PM)$/);
    await page.close();
  }, T);

  it("Ahead: Grid · Gantt · Fix next; the ⋯ menu has Commands, the Guide, the Technical docs, the keys, Send feedback and About; the initials menu has Settings", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("3");
    await expect.poll(() => page.locator(".mode-switch .ms-btn").allTextContents()).toEqual(["Grid", "Gantt", "Readiness · 8", "Backlog"]);
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/ahead/gantt");
    await page.locator(".ahead .pa-grid").waitFor();
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/ahead");
    await page.locator(".top-more").click();
    await expect(page.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringMatching(/^Notifications/), expect.stringMatching(/^Commands/), expect.stringMatching(/^Guide/), "Technical docs", expect.stringMatching(/^Keyboard shortcuts/), "Send feedback", "Admin", "About"]);
    await page.keyboard.press("Escape");
    await page.locator(".person-chip").click();
    await page.getByRole("menuitem", { name: /^Settings/ }).click();
    await expect.poll(() => hash(page)).toBe("#/settings");
    await page.keyboard.press("Escape");
    await expect.poll(() => hash(page)).toBe("#/ahead");
    await page.close();
  }, T);

  it("notification routes open tab and mode", async () => {
    const { page } = await freshPage(h);
    for (const [r, want] of [
      ["checkin", "#/day/checkin"],
      ["closeout", "#/day/closeout"],
      ["planday", "#/week/add"],
      ["ahead", "#/ahead/gantt"],
      ["aheaditem:1113", "#/ahead/item/1113"],
      ["planweek:2026-11-09", "#/week/2026-11-09/add"],
      ["status", "#/status"],
      ["team", "#/week"],
      ["inbox", "#/inbox/promises"],
      ["followup:1", "#/inbox/item/f1"],
      ["settings:notifications", "#/settings/notifications"],
      ["focus", "#/focus"],
      ["vm", "#/day"],
      ["today", "#/day"],
    ] as const) {
      await route(page, r);
      await expect.poll(() => hash(page), { message: r }).toBe(want);
    }
    await page.close();
  }, T);
});
