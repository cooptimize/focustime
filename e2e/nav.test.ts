// Step 16.2: four tabs (1–4), one mode switch per tab, planning as a mode with Done, addresses (back and reload), P,
// entry points from the Week and notification routes. Demo mode (fictional data), clock pinned to Mon Nov 2, 9:30 AM.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const hash = (page: Page) => page.evaluate(() => location.hash);
const tab = (page: Page) => page.locator(".views .view-tab[aria-current=page]").textContent();
const mode = (page: Page) => page.locator(".mode-switch .ms-btn[aria-current=page]").first().textContent();
const route = (page: Page, r: string) => page.evaluate((r) => window.dispatchEvent(new CustomEvent("coopilot:open-route", { detail: r })), r);

describe.skipIf(!CHROMIUM)("Navigation: tabs, modes and addresses (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("four tabs in order, no Plan tab, no ritual chips, no context line; 1–4 switch them", async () => {
    const { page, errors } = await freshPage(h);
    await expect(page.locator(".views .view-tab").allTextContents()).resolves.toEqual(["Today", "Week", "Roadmap", expect.stringMatching(/^Inbox/)]);
    await expect(page.locator(".ritual-bar, .context-line, .weeknav").count()).resolves.toBe(0);
    for (const [k, name, h2] of [["2", "Week", "#/week"], ["3", "Roadmap", "#/roadmap"], ["4", "Inbox", "#/inbox"], ["1", "Today", "#/today"]] as const) {
      await page.keyboard.press(k);
      await expect.poll(() => tab(page)).toMatch(new RegExp(`^${name}`));
      expect(await hash(page)).toBe(h2);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Today's switch: Now · Plan · Check-in · Close out with a due dot on Plan in the morning; P toggles; Done commits and returns", async () => {
    const { page } = await freshPage(h);
    await expect(page.locator(".mode-switch .ms-btn").allTextContents()).resolves.toEqual(["Now", expect.stringMatching(/^Plan/), "Check-in", "Close out"]);
    // Demo Monday 9:30 AM, not planned yet: Plan is due.
    await expect(page.locator(".mode-switch .ms-btn", { hasText: "Plan" }).locator(".ms-due").count()).resolves.toBe(1);
    await page.keyboard.press("p");
    await page.waitForSelector(".pd2-left");
    expect(await hash(page)).toBe("#/today/plan");
    await expect(page.locator(".pd2-title h2").textContent()).resolves.toContain("Plan today");
    await expect.poll(() => mode(page)).toMatch(/^Plan/);
    await page.keyboard.press("p");
    await expect.poll(() => mode(page)).toBe("Now");
    // Back in the browser returns to Plan; forward to Now.
    await page.goBack();
    await page.waitForSelector(".pd2-left");
    await page.goForward();
    await expect.poll(() => hash(page)).toBe("#/today");
    // Plan, add one pick, Done: committed (✓ on Plan) and back to Now.
    await page.keyboard.press("p");
    await page.waitForSelector(".pd2-left");
    await page.locator(".pd2-right li.pd2-add:not(.planned) button.pd2-plus").first().click();
    await page.locator(".pd2-right li.pd2-add.planned").first().waitFor();
    await page.locator(".pd2-head .done-btn").click();
    // The first Done may offer Timebox my day; Not now, then Done again goes back.
    await expect.poll(async () => (await hash(page)) === "#/today" || (await page.locator(".pd-committed").count()) > 0).toBe(true);
    if (await page.locator(".pd-committed").count()) {
      await page.locator(".pd-committed").getByRole("button", { name: "Not now" }).click();
      await page.locator(".pd2-head .done-btn").click();
    }
    await expect.poll(() => hash(page)).toBe("#/today");
    await expect.poll(() => page.locator(".mode-switch .ms-btn", { hasText: "Plan" }).locator(".ms-done").count()).toBe(1);
    await page.close();
  }, T);

  it("Check-in Done shows ✓ and returns to Now; Close out has its own day in the address", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("m");
    await expect.poll(() => hash(page)).toBe("#/today/checkin");
    await page.locator(".mode-checkin .done-btn").click();
    await expect.poll(() => hash(page)).toBe("#/today");
    await expect.poll(() => page.locator(".mode-switch .ms-btn", { hasText: "Check-in" }).locator(".ms-done").count()).toBe(1);
    await page.keyboard.press("e");
    await expect.poll(() => hash(page)).toBe("#/today/closeout");
    await page.locator(".closeout-panel .co-step button[aria-label='Previous day']").click();
    await expect.poll(() => hash(page)).toBe("#/today/closeout/2026-11-01");
    await page.close();
  }, T);

  it("Week: header with the week and musts, Plan the week defaults to next week with ‹ ›; W and P toggle", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    await expect(page.locator(".week-head h2").textContent()).resolves.toMatch(/^Week of Nov 2/);
    await expect(page.locator(".mode-switch .ms-btn").allTextContents()).resolves.toEqual(["Week", expect.stringMatching(/^Plan the week/)]);
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/week/plan");
    await expect.poll(() => page.locator(".planweek h2").first().textContent()).toBe("Plan the week of Nov 9");
    await page.locator(".planweek .co-step button[aria-label='Previous week']").click();
    await expect.poll(() => hash(page)).toBe("#/week/plan/2026-11-02");
    await expect.poll(() => page.locator(".planweek h2").first().textContent()).toBe("Plan the week of Nov 2");
    await page.keyboard.press("w");
    await expect.poll(() => mode(page)).toBe("Week");
    await page.close();
  }, T);

  it("a Week day header's Plan chip opens Today › Plan on that day; the address survives a reload", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const tue = page.locator(".day-plan").nth(1);
    await tue.click();
    await expect.poll(() => hash(page)).toBe("#/today/plan/2026-11-03");
    await expect.poll(() => tab(page)).toBe("Today");
    await expect.poll(() => page.locator(".pd2-title h2").textContent()).toContain("Plan Tuesday, Nov 3");
    await page.reload();
    await page.waitForSelector(".pd2-left");
    await expect(page.locator(".pd2-title h2").textContent()).resolves.toContain("Plan Tuesday, Nov 3");
    await page.close();
  }, T);

  it("+ Add work on a Week card: Today › Plan on that day and block", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const card = page.locator(".half", { hasText: "Northwind" }).first();
    await card.click({ position: { x: 12, y: 12 } });
    await card.getByRole("button", { name: "+ Add work" }).click();
    await page.locator(".pd2-right .pd2-pane-title", { hasText: "Northwind" }).waitFor();
    expect(await hash(page)).toMatch(/^#\/today\/plan\/2026-11-0\d\/(AM|PM)$/);
    await page.close();
  }, T);

  it("Roadmap · Plan ahead; the ⋯ menu has Commands and the keys; the initials menu has Settings", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("3");
    await expect(page.locator(".mode-switch .ms-btn").allTextContents()).resolves.toEqual(["Roadmap", "Plan ahead"]);
    await page.keyboard.press("p");
    await expect.poll(() => hash(page)).toBe("#/roadmap/ahead");
    await page.locator(".plan-ahead .pa-grid").waitFor();
    await page.locator(".roadmap .done-btn").click();
    await expect.poll(() => hash(page)).toBe("#/roadmap");
    await page.locator(".top-more").click();
    await expect(page.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringMatching(/^Commands/), expect.stringMatching(/^Keyboard shortcuts/)]);
    await page.keyboard.press("Escape");
    await page.locator(".person-chip").click();
    await page.getByRole("menuitem", { name: /^Settings/ }).click();
    await expect.poll(() => hash(page)).toBe("#/settings/you");
    await page.keyboard.press("Escape");
    await expect.poll(() => hash(page)).toBe("#/roadmap");
    await page.close();
  }, T);

  it("notification routes open tab and mode", async () => {
    const { page } = await freshPage(h);
    for (const [r, want] of [
      ["checkin", "#/today/checkin"],
      ["closeout", "#/today/closeout"],
      ["planday", "#/today/plan"],
      ["planweek:2026-11-09", "#/week/plan/2026-11-09"],
      ["inbox", "#/inbox"],
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
