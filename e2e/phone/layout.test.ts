// Was e2e/phone.test.ts until BT-1.
// P1: the phone layout (under 600 px) in the browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM. The layout
// (MB-1: Today, Week, Capture, Inbox and Ask in the bottom bar, the status dot and ⋯ at the top, no hover-only controls, Commit and Ahead read-only) and the main path: Today, start focus, mark done, capture,
// then ⋯ › Notifications.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS } from "../shots.ts";

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

  it("has the bottom bar and a small top bar, no hover-only controls, Add work as a sheet on the phone, Ahead read-only", async () => {
    const { page, errors } = await freshPage(h, PHONE);
    await open(page, "#/today");
    // PH-1: the bar is Day, Week, the raised Capture, Inbox and More; the top bar the date, the VM and Ask.
    expect(await page.locator(".bottom-bar .pb-tab .pb-label").allTextContents()).toEqual(["Day", "Week", "Inbox", "More"]);
    expect(await page.locator(".bottom-bar .pb-capture").count()).toBe(1);
    expect(await page.locator(".topbar .views").count()).toBe(0);
    expect(await page.locator(".topbar .capture-btn, .topbar .timer-btn, .topbar .phone-capture").count()).toBe(0);
    expect(await page.locator(".topbar .status-dot-btn, .topbar .top-more").count()).toBe(0);
    expect(await page.locator(".topbar .ph1-date").count()).toBe(1);
    expect(await page.locator(".topbar .ph-ask").count()).toBe(1);
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

    // WD-1: Add work works on the phone as a bottom sheet (the old Plan today and Commit addresses open it), no read-only line.
    for (const hash of ["#/week/day", "#/week/commit"]) {
      await open(page, hash);
      await page.locator("aside.block-panel.sheet").waitFor();
      expect(await page.locator(".phone-ro").count()).toBe(0);
    }
    // Ahead read only, with the line, Copy link, and nothing to tap inside, once opened anyway (MB-1).
    await open(page, "#/ahead");
    await page.getByRole("button", { name: "Open anyway" }).click();
    await page.waitForSelector(".phone-ro");
    expect(await page.locator(".phone-ro-bar button", { hasText: "Copy link" }).count()).toBe(1);
    expect(await page.locator(".phone-ro-body").evaluate((e) => (e as HTMLElement).inert)).toBe(true);
    expect(errors).toEqual([]);
  }, T);

  it("runs the day: Today, start focus, mark done, capture", async () => {
    const { page, errors } = await freshPage(h, PHONE);
    // FN-1: this test checks the plan's own tick; Wrap it up has its own (e2e/week/story-card.test.ts), so the sheet stays off here.
    expect((await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } })).ok).toBe(true);
    await page.reload();
    for (const input of [
      { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "S" },
      { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Write the release notes", size: "S" },
    ]) expect((await call(page, "pick.add", input)).ok).toBe(true);

    // Today: Now leads with the block and its next to-do; one Start focus on the page (PH-1).
    await open(page, "#/today");
    const now = page.locator(".pn-card");
    await now.getByRole("button", { name: "Start focus" }).waitFor();
    const first = (await now.locator(".pn-title").textContent())!;
    expect(await page.getByRole("button", { name: "Start focus" }).count()).toBe(1);

    // Start, back to Today: the timer is in the Now card; Done ends it and ticks the to-do.
    await now.getByRole("button", { name: "Start focus" }).click();
    // The timer has started (the focus screen runs) before the reload reads it back.
    await page.locator("main.focus-screen:not(.idle)").waitFor();
    await open(page, "#/today");
    await now.locator(".pn-count").waitFor();
    await now.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => (await page.locator(".pn-card .pn-title").textContent()) !== first, { timeout: 15_000 }).toBe(true);

    // Done on the next to-do: its Done box.
    await now.getByRole("checkbox", { name: /^Done: / }).click();
    await expect.poll(async () => ((await call(page, "week.load", {})).data.plan["2026-11-02"].picks as { status: string }[]).filter((p) => p.status === "done").length).toBe(2);

    // Capture from the bottom bar's raised +: a full-screen sheet, Enter saves.
    await page.locator(".bottom-bar .pb-capture").click();
    const sheet = page.locator(".cap-dialog");
    await sheet.waitFor();
    expect(await sheet.evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(PHONE.width);
    await sheet.locator("textarea").first().fill("Ask Jordan about the invoice");
    await page.keyboard.press("Enter");
    await expect.poll(async () => JSON.stringify((await call(page, "capture.load", {})).data)).toContain("Ask Jordan about the invoice");
    // Esc closes it.
    if (await sheet.count()) await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });

    // Part B: this morning's notifications: More › Everything else says "1 new" (PH-1: was ⋯'s dot); in the list the
    // new one keeps its mark while it's open.
    await open(page, "#/today");
    const moreBtn = page.locator(".bottom-bar").getByRole("button", { name: /^More/ });
    await moreBtn.click();
    await page.getByRole("button", { name: /Everything else/ }).click();
    await expect.poll(() => page.locator('.mr-row[data-row="notifications"] .mr-line').textContent()).toMatch(/new$/);
    await page.locator('.mr-row[data-row="notifications"]').click();
    const panel = page.locator(".notices-panel");
    await panel.waitFor();
    expect(await panel.locator(".notice-row").count()).toBeGreaterThanOrEqual(2);
    expect(await panel.locator(".notice-row.unread .nr-title").first().textContent()).toContain("Promises due");
    await panel.getByRole("button", { name: "Close" }).click();
    // Read now: More's Notifications row no longer counts them.
    expect((await call(page, "notices.list", {})).data.unread).toBe(0);
    await open(page, "#/today");
    await moreBtn.click();
    await page.getByRole("button", { name: /Everything else/ }).click();
    expect(await page.locator('.mr-row[data-row="notifications"]').textContent()).not.toContain("new");
    expect(errors).toEqual([]);
  }, T);

  it("CV-3 (PH-1): the top bar's date, Demo, the VM and Ask stay whole at the phone's 17px root font (and 21px), with no sideways overflow; the person is a row in More › Everything else", async () => {
    // iPhone Safari's text is 17px and up (-apple-system-body); Chromium needs it set by hand (through the CSSOM, which the CSP allows).
    const { page } = await freshPage(h, { width: 390, height: 844 });
    for (const px of [17, 21]) {
      await page.evaluate((n) => document.documentElement.style.setProperty("font-size", `${n}px`, "important"), px);
      await page.waitForFunction((n) => getComputedStyle(document.documentElement).fontSize === `${n}px` && !!document.querySelector(".topbar .ph1-date"), px);
      // Measured once layout settles (a busy machine can be a frame behind).
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".topbar .ph1-date, .topbar .demo-tag, .topbar .ph-ask")].filter((e) => Math.round(e.getBoundingClientRect().width) + 1 < e.scrollWidth).map((e) => `${e.className} ${Math.round(e.getBoundingClientRect().width)}/${e.scrollWidth}`)), `whole at ${px}px`).toEqual([]);
      const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, right: Math.max(...[...document.querySelectorAll(".topbar *")].map((e) => e.getBoundingClientRect().right)), chip: !!document.querySelector(".topbar .person-chip") }));
      expect(m.doc).toBeLessThanOrEqual(390);
      expect(m.right).toBeLessThanOrEqual(390.5);
      expect(m.chip).toBe(false);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cv3-phone-topbar-${px}px.png`, clip: { x: 0, y: 0, width: 390, height: 120 } });
    }
    await page.locator(".bottom-bar").getByRole("button", { name: /^More/ }).click();
    await page.getByRole("button", { name: /Everything else/ }).click();
    await expect.poll(() => page.locator('.mr-row[data-row="account"]').textContent()).toMatch(/^Alex Rivera/);
    await page.close();
  }, T);
});
