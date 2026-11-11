// P1: the phone layout (under 600 px) in the browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM. The layout
// (MB-1: Today, Week, Capture, Inbox and Ask in the bottom bar, the status dot and ⋯ at the top, no hover-only controls, Commit and Ahead read-only) and the main path: Today, start focus, mark done, capture,
// then ⋯ › Notifications.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

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
    // MB-1: the bottom bar is Today, Week, the raised Capture, Inbox and Ask; the top bar only the logo, the status dot and ⋯.
    expect(await page.locator(".bottom-bar .bb-tab").allTextContents()).toEqual(["Day", "Week", expect.stringMatching(/^Inbox/), "Ask"]);
    expect(await page.locator(".bottom-bar .bb-capture").count()).toBe(1);
    expect(await page.locator(".topbar .views").count()).toBe(0);
    expect(await page.locator(".topbar .capture-btn, .topbar .timer-btn, .topbar .phone-capture").count()).toBe(0);
    expect(await page.locator(".topbar .status-dot-btn").count()).toBe(1);
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

    // WD-1: Add work works on the phone as a bottom sheet (the old Plan today and Commit addresses open it), no read-only line.
    for (const hash of ["#/week/day", "#/week/commit"]) {
      await open(page, hash);
      await page.locator("aside.add-work-panel.sheet").waitFor();
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
    // FN-1: this test checks the plan's own tick; Wrap it up has its own (e2e/fn1.test.ts), so the sheet stays off here.
    expect((await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } })).ok).toBe(true);
    await page.reload();
    for (const input of [
      { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", itemId: 4411, size: "S" },
      { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Write the release notes", size: "S" },
    ]) expect((await call(page, "pick.add", input)).ok).toBe(true);

    // Today: Now leads with the block and its next to-do; one Start on the page (MB-1).
    await open(page, "#/today");
    const now = page.locator(".ph-now");
    await now.getByRole("button", { name: "Start", exact: true }).waitFor();
    const first = (await now.locator(".pnt-title").textContent())!;
    // One Start for focus (the VM's morning prompt has its own Start for the VM).
    expect(await page.getByRole("button", { name: "Start", exact: true }).count()).toBe((await page.locator(".att-chip.vm").getByRole("button", { name: "Start", exact: true }).count()) + 1);

    // Start, back to Today: the timer is in the Now card; Done ends it and ticks the to-do.
    await now.getByRole("button", { name: "Start", exact: true }).click();
    // The timer has started (the focus screen runs) before the reload reads it back.
    await page.locator("main.focus-screen:not(.idle)").waitFor();
    await open(page, "#/today");
    await now.locator(".pnt-count").waitFor();
    await now.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => (await page.locator(".ph-now .pnt-title").textContent()) !== first).toBe(true);

    // Done on the next to-do.
    await now.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => ((await call(page, "week.load", {})).data.plan["2026-11-02"].picks as { status: string }[]).filter((p) => p.status === "done").length).toBe(2);

    // Capture from the bottom bar's raised +: a full-screen sheet, Enter saves.
    await page.locator(".bottom-bar .bb-capture").click();
    const sheet = page.locator(".cap-dialog");
    await sheet.waitFor();
    expect(await sheet.evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(PHONE.width);
    await sheet.locator("textarea").first().fill("Ask Jordan about the invoice");
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
    expect(await panel.locator(".notice-row.unread .nr-title").first().textContent()).toContain("Promises due");
    await panel.getByRole("button", { name: "Close" }).click();
    // Read now: ⋯ no longer counts them.
    expect((await call(page, "notices.list", {})).data.unread).toBe(0);
    await page.locator(".topbar .top-more").click();
    expect(await page.getByRole("menuitem", { name: /Notifications/ }).textContent()).not.toContain("new");
    expect(errors).toEqual([]);
  }, T);

  it("CV-3: the FocusTime name stays whole at the phone's 17px root font (and 21px), with no sideways overflow; the person chip is ⋯'s first row", async () => {
    // iPhone Safari's text is 17px and up (-apple-system-body); Chromium needs it set by hand (through the CSSOM, which the CSP allows).
    const { page } = await freshPage(h, { width: 390, height: 844 });
    for (const px of [17, 21]) {
      await page.evaluate((n) => document.documentElement.style.setProperty("font-size", `${n}px`, "important"), px);
      await page.waitForFunction((n) => getComputedStyle(document.documentElement).fontSize === `${n}px` && !!document.querySelector(".topbar .brand .name"), px);
      // Measured once layout settles (a busy machine can be a frame behind).
      await expect.poll(() => page.evaluate(() => { const n = document.querySelector<HTMLElement>(".topbar .brand .name")!; return Math.round(n.getBoundingClientRect().width) >= n.scrollWidth; })).toBe(true);
      const m = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
        const name = document.querySelector<HTMLElement>(".topbar .brand .name")!;
        return { nameW: name.getBoundingClientRect().width, nameSW: name.scrollWidth, name: r(".topbar .brand .name")!, actions: r(".topbar .top-actions")!, doc: document.documentElement.scrollWidth, chip: !!document.querySelector(".topbar .person-chip") };
      });
      expect(Math.round(m.nameW)).toBeGreaterThanOrEqual(m.nameSW);
      expect(m.name.right).toBeLessThanOrEqual(m.actions.left);
      expect(m.doc).toBeLessThanOrEqual(390);
      expect(m.chip).toBe(false);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cv3-phone-topbar-${px}px.png`, clip: { x: 0, y: 0, width: 390, height: 120 } });
    }
    await page.locator(".topbar .top-more").click();
    const first = page.getByRole("menu").getByRole("menuitem").first();
    await expect.poll(() => first.textContent()).toMatch(/^Alex Rivera/);
    await page.close();
  }, T);
});
