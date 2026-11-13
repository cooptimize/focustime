// NV-1: the main path through the new navigation, in demo mode on Monday Nov 2 at 9:30.
// WD-1, RF-1, BL-1: tabs Day · Week · Backlog · Status · Inbox (and 1 to 5); Day without modes: what's next, the Plan today card in the
// morning, the Midday check-in card after lunch, the Close out card at the end of the day; Plan today is Week's Board
// focused on today, with everything Plan the day did; Board and Commit; Backlog (was Ahead, was Roadmap); the Inbox; every older
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
  it("tabs and keys, Day's cards, Plan today opens Week with Add work on today, Backlog, the Inbox, Status and the old addresses", async () => {
    const { page, errors } = await freshPage(h);
    page.setDefaultTimeout(30_000);

    // WD-1, RF-1: five tabs, Day first, Status fourth and the Inbox last; 1 to 5 pick them.
    expect(await page.getByRole("navigation", { name: "Tabs" }).getByRole("button").allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/^Day/), expect.stringMatching(/^Week/), expect.stringMatching(/^Backlog/), expect.stringMatching(/^Inbox/), expect.stringMatching(/^Status/)]));
    for (const [key, name, where] of [["2", "Week", "#/week"], ["3", "Backlog", "#/backlog"], ["4", "Status", "#/status"], ["5", "Inbox", "#/inbox"], ["1", "Day", "#/day"]] as const) {
      await page.keyboard.press(key);
      await expect.poll(() => tab(page).textContent()).toMatch(new RegExp(`^${name}`));
      expect(await hash(page)).toBe(where);
    }

    // Day has no modes: what's next, then the morning's card. CF-1: it shows only while today has no to-dos, so take
    // the demo's off first.
    expect(await page.getByRole("navigation", { name: "Today modes" }).count()).toBe(0);
    await page.evaluate(async () => {
      const csrf = document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "";
      const post = (action: string, input: unknown) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action, input }) }).then((r) => r.json());
      const st = await post("planday.start", { date: "2026-11-02" });
      for (const p of st.data.picks as { id: number; status: string }[]) if (p.status === "planned" || p.status === "done") await post("pick.remove", { id: p.id });
    });
    await page.reload();
    await page.locator(".day-view .half.card").first().waitFor();
    const planCard = page.getByRole("region", { name: "Nothing on today yet" });
    await planCard.waitFor();
    expect(await page.getByRole("region", { name: "Midday check-in" }).count()).toBe(0);
    await shotAll(page, "nv1-today-plan-card");

    // WD-2: + Add on the card opens the block panel on Day, on one of today's blocks, the cursor in its Add box.
    await planCard.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => hash(page)).toMatch(/^#\/day\/2026-11-02\/(AM|PM)$/);
    await expect.poll(() => tab(page).textContent()).toMatch(/^Day/);
    await expect.poll(() => page.locator("aside.block-panel").getAttribute("data-block-panel")).toMatch(/^2026-11-02\|/);
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("bp-box"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator("aside.block-panel").count()).toBe(0);
    await expect.poll(() => hash(page)).toBe("#/day");
    // Week has no mode switch.
    await page.keyboard.press("2");
    await page.locator(".half.card").first().waitFor();
    expect(await page.getByRole("navigation", { name: "Week modes" }).count()).toBe(0);

    // AH-1, BL-1: Backlog is Grid and Gantt.
    await page.keyboard.press("3");
    await page.locator("main.roadmap").waitFor();
    await page.getByRole("navigation", { name: "Backlog views" }).waitFor();
    await shotAll(page, "nv1-ahead");

    // The Inbox (IB-4): three lists in one switch, no mode switch.
    await page.keyboard.press("5");
    await page.getByRole("main", { name: "Inbox" }).getByRole("tablist", { name: "Lists" }).waitFor();
    expect(await page.getByRole("navigation", { name: "Inbox modes" }).count()).toBe(0);
    await shotAll(page, "nv1-inbox");

    // Every older address lands on its new home with its date, block or week.
    for (const [old, now] of [
      ["#/today/plan/2026-11-03/PM", "#/week/day/2026-11-03/PM"],
      ["#/today/plan", "#/week/add"],
      ["#/week/plan/2026-11-09", "#/week/2026-11-09/add"],
      ["#/week/status", "#/status"],
      ["#/roadmap", "#/backlog"],
      ["#/roadmap/ahead", "#/backlog/gantt"],
      ["#/ahead/plan", "#/backlog/gantt"],
      ["#/conversations", "#/inbox/chats"],
      ["#/my-promises", "#/inbox/promises"],
      ["#/inbox/conversations", "#/inbox/chats"],
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
    expect(await page.getByRole("region", { name: "Nothing on today yet" }).count()).toBe(0);
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
    // WD-2: the Coop brief is in a feature's ⋯ in the block panel (Day's This week chips are gone).
    await page.locator('.day-view [data-drop="2026-11-02:PM"] .card-when').click();
    const feature = page.locator("aside.block-panel .aw-feature", { hasText: "Supplier onboarding" }).first();
    await feature.waitFor();
    await feature.locator(".aw-feat-head").getByRole("button", { name: /^More for/ }).click();
    await page.getByRole("menuitem", { name: /Coop brief/ }).click();
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

    await page.locator("aside.block-panel .aw-feature", { hasText: "Supplier onboarding" }).first().getByRole("button", { name: /^Break down/ }).first().click();
    await page.locator(".bd-panel:not(.brief-panel)").waitFor();
    await shotAll(page, "nv1-break-down");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);
});
