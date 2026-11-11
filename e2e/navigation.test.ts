// NV-1: the main path through the new navigation, in demo mode on Monday Nov 2 at 9:30.
// WD-1, RF-1: tabs Day · Week · Ahead · Status · Inbox (and 1 to 5); Day without modes: what's next, the Plan today card in the
// morning, the Midday check-in card after lunch, the Close out card at the end of the day; Plan today is Week's Board
// focused on today, with everything Plan the day did; Board and Commit; Ahead (was Roadmap); the Inbox; every older
// address landing on its new home with its date kept. Edge cases are unit tests (ui/nav.test.ts, plan/modes.test.ts,
// plan/urgent.test.ts, ui/inboxcount.test.ts). Screenshots at 1920, 1366 by 768, Text size Larger and the phone
// (390 wide, a 17px root font as on iPhone) when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "./harness.ts";
import { shotBoth, SHOTS } from "./shots.ts";

let h: Harness;
beforeAll(async () => void (h = await startDemo()), 120_000);
afterAll(async () => void (await h?.stop()));

const hash = (page: Page) => page.evaluate(() => location.hash);
const tab = (page: Page) => page.getByRole("navigation", { name: "Tabs" }).locator("[aria-current=page]");
/** The same clock day at another time (the UI's ?now=). */
const at = (time: string) => `${h.url.split("?")[0]}?now=${encodeURIComponent(NOW.replace("09:30", time))}`;

/** 1920 and Larger, 1366 by 768, then the phone (390 by 844, a 17px root font), and back to 1920. */
async function shotAll(page: Page, name: string) {
  if (!SHOTS) return;
  await shotBoth(page, name);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}-1366.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png` });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${name}: wider than the phone`).toBeLessThanOrEqual(0);
  await page.evaluate(() => void (document.documentElement.style.fontSize = ""));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(200);
}

describe.skipIf(!CHROMIUM)("NV-1 navigation", () => {
  it("tabs and keys, Day's cards, Plan today opens Week with Add work on today, Ahead, the Inbox, Status and the old addresses", async () => {
    const { page, errors } = await freshPage(h);
    page.setDefaultTimeout(30_000);

    // WD-1: five tabs, Day first and Status last; 1 to 5 pick them.
    expect(await page.getByRole("navigation", { name: "Tabs" }).getByRole("button").allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/^Day/), expect.stringMatching(/^Week/), expect.stringMatching(/^Ahead/), expect.stringMatching(/^Inbox/), expect.stringMatching(/^Status/)]));
    for (const [key, name, where] of [["2", "Week", "#/week"], ["3", "Ahead", "#/ahead"], ["4", "Inbox", "#/inbox"], ["5", "Status", "#/status"], ["1", "Day", "#/day"]] as const) {
      await page.keyboard.press(key);
      await expect.poll(() => tab(page).textContent()).toMatch(new RegExp(`^${name}`));
      expect(await hash(page)).toBe(where);
    }

    // Day has no modes: what's next, then the morning's Plan today card (Monday isn't confirmed yet).
    expect(await page.getByRole("navigation", { name: "Today modes" }).count()).toBe(0);
    await page.locator(".phone-now").waitFor();
    const planCard = page.getByRole("region", { name: "Add work" });
    await planCard.waitFor();
    expect(await page.getByRole("region", { name: "Midday check-in" }).count()).toBe(0);
    await shotAll(page, "nv1-today-plan-card");

    // Plan today: Week with the Add work panel on today; Week has no mode switch.
    await planCard.getByRole("button", { name: "Add work" }).click();
    await expect.poll(() => hash(page)).toMatch(/^#\/week\/day\/2026-11-02/);
    await expect.poll(() => tab(page).textContent()).toMatch(/^Week/);
    expect(await page.getByRole("navigation", { name: "Week modes" }).count()).toBe(0);
    await expect.poll(() => page.locator("aside.add-work-panel").getAttribute("data-add-panel")).toMatch(/^2026-11-02\|/);
    await page.getByPlaceholder(/^Type a story for /).waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator("aside.add-work-panel").count()).toBe(0);

    // AH-1: Ahead is Grid, Gantt, Readiness and Backlog.
    await page.keyboard.press("3");
    await page.locator("main.roadmap").waitFor();
    await page.getByRole("navigation", { name: "Ahead modes" }).waitFor();
    await shotAll(page, "nv1-ahead");

    // The Inbox (IB-1): one list with views, no mode switch.
    await page.keyboard.press("5");
    await page.getByRole("navigation", { name: "Inbox views and clients" }).waitFor();
    expect(await page.getByRole("navigation", { name: "Inbox modes" }).count()).toBe(0);
    await shotAll(page, "nv1-inbox");

    // Every older address lands on its new home with its date, block or week.
    for (const [old, now] of [
      ["#/today/plan/2026-11-03/PM", "#/week/day/2026-11-03/PM"],
      ["#/today/plan", "#/week/add"],
      ["#/week/plan/2026-11-09", "#/week/2026-11-09/add"],
      ["#/week/status", "#/status"],
      ["#/roadmap", "#/ahead"],
      ["#/roadmap/ahead", "#/ahead/gantt"],
      ["#/ahead/plan", "#/ahead/gantt"],
      ["#/conversations", "#/inbox/needs-you"],
      ["#/my-promises", "#/inbox/promises"],
      ["#/inbox/conversations", "#/inbox/needs-you"],
      ["#/inbox/my-promises", "#/inbox/promises"],
      ["#/inbox/conversation/7", "#/inbox/item/v7"],
      ["#/inbox/promise/7", "#/inbox/item/c7"],
      ["#/inbox/7", "#/inbox/item/f7"],
    ] as const) {
      await page.evaluate((x) => (location.hash = x), old);
      await expect.poll(() => hash(page), { message: old }).toBe(now);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 240_000);

  it("the Midday check-in card after lunch and the Close out card at the end of the day open their flows; done is one small line", async () => {
    const { page, errors } = await freshPage(h);
    page.setDefaultTimeout(30_000);
    await page.goto(at("13:40"));
    const checkin = page.getByRole("region", { name: "Midday check-in" });
    await checkin.waitFor();
    expect(await page.getByRole("region", { name: "Add work" }).count()).toBe(0);
    await shotAll(page, "nv1-today-checkin-card");
    await checkin.getByRole("button", { name: "Check in" }).click();
    await expect.poll(() => hash(page)).toBe("#/day/checkin");
    await page.getByRole("heading", { name: /^Midday check-in/ }).waitFor();
    await page.locator(".today-head .done-btn").click();
    await expect.poll(() => hash(page)).toBe("#/day");
    await page.getByText("Midday check-in done").waitFor();
    await page.getByRole("button", { name: "Reopen" }).waitFor();

    await page.goto(at("16:30"));
    const close = page.getByRole("region", { name: "Close out" });
    await close.waitFor();
    await shotAll(page, "nv1-today-closeout-card");
    await close.getByRole("button", { name: "Close out" }).click();
    await expect.poll(() => hash(page)).toBe("#/day/closeout");
    await page.getByRole("complementary", { name: "Close out" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it("Coop brief opens Break down's side panel: copies at once, Copy again and Close; Break down's panel beside it", async () => {
    const { page, errors } = await freshPage(h);
    page.setDefaultTimeout(30_000);
    await page.getByRole("button", { name: "Coop brief" }).first().click();
    const panel = page.locator(".bd-panel.brief-panel");
    await panel.waitFor();
    await panel.getByText("Coop brief").first().waitFor();
    await panel.locator(".brief-text").waitFor();
    expect(await panel.locator(".brief-text").inputValue()).toContain("Supplier onboarding");
    await expect.poll(() => panel.locator(".brief-status").textContent()).toMatch(/Copied|Press Ctrl\+C to copy/);
    await panel.getByText("What's in the brief").waitFor();
    await panel.getByRole("button", { name: "Copy again" }).waitFor();
    await shotAll(page, "nv1-coop-brief");
    await panel.getByRole("button", { name: "Close" }).last().click();
    await expect.poll(() => panel.count()).toBe(0);

    await page.getByRole("button", { name: /^Break down / }).first().click();
    await page.locator(".bd-panel:not(.brief-panel)").waitFor();
    await shotAll(page, "nv1-break-down");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);
});
