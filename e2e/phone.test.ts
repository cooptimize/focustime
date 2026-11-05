// P1: the phone layout (under 600 px) in the browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM. The layout
// (bottom bar of four tabs, Capture and ⋯ at the top, no hover-only controls, Commit and Ahead read-only) and the main path: Today, start focus, mark done, capture,
// then ⋯ › Notifications.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 120_000;
const PHONE = { width: 393, height: 852 };
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

const base = () => h.url.split("#")[0]!;
async function open(page: Page, hash: string) {
  // A new hash on the same page is not a reload; reload so the app reads the plan as it is now.
  await page.goto(`${base()}${hash}`);
  await page.reload();
  await page.waitForSelector(".topbar");
}

describe.skipIf(!CHROMIUM)("P1: FocusTime on a phone", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(() => h?.stop());

  it("has the bottom bar and a small top bar, no hover-only controls, Plan today on the phone, Commit and Ahead read-only", async () => {
    const { page, errors } = await freshPage(h, PHONE);
    await open(page, "#/today");
    // NV-1: the bottom bar is the four tabs; Capture is the + and ⋯ the menu, in the top bar.
    expect(await page.locator(".bottom-bar .bb-tab").allTextContents()).toEqual(["Today", "Week", "Ahead", expect.stringMatching(/^Inbox/)]);
    expect(await page.locator(".topbar .views").count()).toBe(0);
    expect(await page.locator(".topbar .capture-btn, .topbar .timer-btn").count()).toBe(0);
    expect(await page.locator(".topbar .phone-capture").count()).toBe(1);
    expect(await page.locator(".topbar .top-more").count()).toBe(1);
    // The page itself scrolls (Safari's own scrolling), with nothing left behind the bottom bar at the end.
    const scroll = await page.evaluate(() => {
      const inner = [...document.querySelectorAll(".app *")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2 && !e.closest(".bottom-bar"));
      scrollTo(0, 1e6);
      const bar = document.querySelector(".bottom-bar")!.getBoundingClientRect().top;
      const last = Math.max(...[...document.querySelectorAll(".today-view *")].map((e) => e.getBoundingClientRect().bottom));
      scrollTo(0, 0);
      return { inner: inner.map((e) => e.className), behind: last - bar };
    });
    expect(scroll.inner).toEqual([]);
    expect(scroll.behind).toBeLessThanOrEqual(0);

    // Week: one day at a time; every control that showed on hover is there without one.
    await open(page, "#/week");
    await page.waitForSelector(".grid.narrow .half");
    const hidden = await page.locator(".grid.narrow .card-more, .grid.narrow .day-head .more-btn").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== "1" || getComputedStyle(e).visibility === "hidden").length);
    expect(hidden).toBe(0);
    // A sideways swipe changes the day.
    const before = await page.locator(".day-tab.current").textContent();
    const grid = page.locator(".grid.narrow");
    await grid.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 300, clientY: 400 }] });
    await grid.dispatchEvent("touchend", { changedTouches: [{ identifier: 1, clientX: 100, clientY: 410 }] });
    await expect.poll(() => page.locator(".day-tab.current").textContent()).not.toBe(before);

    // Plan today works on the phone (NV-1 narrows D476): the day arrows and Commit today, no read-only line.
    await open(page, "#/week/day");
    await page.getByRole("button", { name: "Next day (→)" }).waitFor();
    expect(await page.locator(".phone-ro").count()).toBe(0);
    // Commit, Ahead and Plan ahead read only, with the line, Copy link, and nothing to tap inside.
    for (const hash of ["#/week/commit", "#/ahead", "#/ahead/plan"]) {
      await open(page, hash);
      await page.waitForSelector(".phone-ro");
      expect(await page.locator(".phone-ro-bar").textContent()).toContain("Planning works best on a bigger screen");
      expect(await page.locator(".phone-ro-bar button", { hasText: "Copy link" }).count()).toBe(1);
      expect(await page.locator(".phone-ro-body").evaluate((e) => (e as HTMLElement).inert)).toBe(true);
    }
    expect(errors).toEqual([]);
  }, T);

  it("runs the day: Today, start focus, mark done, capture", async () => {
    const { page, errors } = await freshPage(h, PHONE);
    for (const input of [
      { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "S" },
      { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Write the release notes", size: "S" },
    ]) expect((await call(page, "pick.add", input)).ok).toBe(true);
    expect((await call(page, "planday.commit", { date: "2026-11-02" })).ok).toBe(true);

    // Today: Now leads with the block and its next pick; one Start focus on the page.
    await open(page, "#/today");
    const now = page.locator(".phone-now");
    await now.getByRole("button", { name: "Start focus" }).waitFor();
    const first = (await now.locator(".pn-pick").textContent())!;
    expect(await page.getByRole("button", { name: "Start focus" }).count()).toBe(1);

    // Start focus, back to Today: the timer is in the Now card; Done ends it and ticks the pick.
    await now.getByRole("button", { name: "Start focus" }).click();
    // The timer has started (the focus screen runs) before the reload reads it back.
    await page.locator("main.focus-screen:not(.idle)").waitFor();
    await open(page, "#/today");
    await now.locator(".pn-count").waitFor();
    await now.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => (await page.locator(".phone-now .pn-pick").textContent()) !== first).toBe(true);

    // Mark done on the next pick.
    await now.getByRole("button", { name: "Mark done" }).click();
    await expect.poll(async () => ((await call(page, "week.load", {})).data.plan["2026-11-02"].picks as { status: string }[]).filter((p) => p.status === "done").length).toBe(2);

    // Capture from the top bar's +: a full-screen sheet, Enter saves.
    await page.locator(".topbar .phone-capture").click();
    const sheet = page.locator(".cap-dialog");
    await sheet.waitFor();
    expect(await sheet.evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(PHONE.width);
    await sheet.locator("input").first().fill("Ask Jordan about the invoice");
    await page.keyboard.press("Enter");
    await expect.poll(async () => JSON.stringify((await call(page, "capture.load", {})).data)).toContain("Ask Jordan about the invoice");
    // Esc closes it.
    if (await sheet.count()) await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });

    // Part B: this morning's notifications: ⋯ has its dot; in the list the new one keeps its mark while it's open.
    await open(page, "#/today");
    await page.locator(".topbar .top-more .top-dot").waitFor();
    await page.locator(".topbar .top-more").click();
    await page.getByRole("menuitem", { name: /Notifications/ }).click();
    const panel = page.locator(".notices-panel");
    await panel.waitFor();
    expect(await panel.locator(".notice-row").count()).toBeGreaterThanOrEqual(2);
    expect(await panel.locator(".notice-row.unread .nr-title").first().textContent()).toContain("Follow-ups due");
    await panel.getByRole("button", { name: "Close" }).click();
    // Read now: ⋯ no longer counts them.
    expect((await call(page, "notices.list", {})).data.unread).toBe(0);
    await page.locator(".topbar .top-more").click();
    expect(await page.getByRole("menuitem", { name: /Notifications/ }).textContent()).not.toContain("new");
    expect(errors).toEqual([]);
  }, T);
});
