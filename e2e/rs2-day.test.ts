// RS-2 part A in a real browser, on the demo (a fictional person, given a working Friday through hours.set_day): Day
// shows the catch-up day's blocks as Week does, in Cards, Timeline and on the phone; Add, tick, move and timebox work
// there, with Undo; a person who hid the catch-up day on Week still sees it on Day; and over the demo's whole week, each
// day's blocks on Day are Week's cards for that day.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";

const T = 240_000;
const FRI = "2026-11-06";
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", FRI];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }>;
const panel = (page: Page) => page.locator("aside.block-panel");
const toast = (page: Page) => page.locator(".undo-toast");
const block = (page: Page, date: string, half: string) => page.locator(`[data-drop="${date}:${half}"]`).first();
const titles = (l: Locator) => l.locator(".pr-title").allInnerTexts();

async function goTo(page: Page, address: string, ready: Locator) {
  const set = () => page.evaluate((a) => void (location.hash !== a && (location.hash = a)), address);
  await set();
  await expect.poll(async () => (await ready.isVisible()) || (await set(), false), { timeout: 30_000, interval: 250 }).toBe(true);
}
/** A real pointer drag (the HTML5 drag starts once the pointer moves), ending over `to`. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + Math.min(40, a.width / 2), a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + Math.min(40, a.width / 2) + 12, a.y + a.height / 2 + 12, { steps: 4 });
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 2);
  await page.mouse.up();
}
const day = (page: Page, date: string) => goTo(page, `#/day/${date}`, page.locator(".day-view .day-bar").first());
async function cardsOrTimeline(page: Page, which: "Cards" | "Timeline") {
  const b = page.locator(".day-switch button", { hasText: which }).first();
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
  await page.waitForTimeout(400);
}
/** Friday Nov 6 from 9 to 5: the demo person's catch-up day with working hours. */
async function workingFriday(page: Page) {
  expect((await call(page, "hours.set_day", { date: FRI, segments: ["09:00-17:00"] })).ok).toBe(true);
}
/** Which blocks a screen draws for a date: the half of each card (or "day" for one whole-day cell). */
const drawn = (scope: Locator, date: string) =>
  scope.locator(`[data-drop^="${date}:"]`).evaluateAll((els) => els.map((e) => (e.classList.contains("whole") ? (e.classList.contains("pto") ? "pto" : "day") : (e.getAttribute("data-drop") ?? "").split(":")[1]!)));

describe.skipIf(!CHROMIUM)("RS-2: Day shows the catch-up day (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    // Friday 10:00 AM: the catch-up day is today, its morning under way.
    h = await startDemo("chromium", {}, "2026-11-06T10:00:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("Cards: Week's two Catch-up cards; + Add in the header; Add, tick, move, each undone", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await workingFriday(page);
    await page.reload();
    await day(page, FRI);
    await cardsOrTimeline(page, "Cards");
    const cards = page.locator(".day-view .half");
    await expect.poll(() => cards.count()).toBe(2);
    await expect(cards.locator(".card-client").allInnerTexts()).resolves.toEqual(["Catch-up", "Catch-up"]);
    // Add, from the header, on the block under way.
    await page.locator(".day-bar .add-work-head").click();
    await expect.poll(() => panel(page).getAttribute("data-block-panel")).toBe(`${FRI}|AM`);
    // A catch-up block has no client of its own: the panel asks which, as it does on Week.
    await panel(page).locator(".aw-chooser .chip-btn").first().click();
    const box = panel(page).locator("input.bp-box");
    await box.fill("Sort the release notes");
    await panel(page).locator("#bp-results .bp-result", { hasText: "New to-do: Sort the release notes" }).first().click();
    await expect.poll(() => titles(block(page, FRI, "AM"))).toContain("Sort the release notes");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => titles(block(page, FRI, "AM"))).not.toContain("Sort the release notes");
    await box.fill("Sort the release notes");
    await panel(page).locator("#bp-results .bp-result", { hasText: "New to-do: Sort the release notes" }).first().click();
    const row = block(page, FRI, "AM").locator("li.pick-row", { hasText: "Sort the release notes" });
    await row.waitFor();
    // The next to-do on today's catch-up block has Start focus.
    await row.locator(".start-focus").waitFor();
    // Tick, and untick (its undo).
    await row.locator("input[type=checkbox]").check();
    await expect.poll(() => row.getAttribute("class")).toContain("done");
    await row.locator("input[type=checkbox]").uncheck();
    await expect.poll(() => row.getAttribute("class")).toContain("planned");
    // Move it to the afternoon block by dragging it there, then Undo.
    await drag(page, row, block(page, FRI, "PM"));
    await toast(page).getByText(/^Moved to /).waitFor();
    await expect.poll(() => titles(block(page, FRI, "PM"))).toContain("Sort the release notes");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => titles(block(page, FRI, "AM"))).toContain("Sort the release notes");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Timeline: two Catch-up bands in the neutral color, and a to-do timeboxed there with T, then undone", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 1200 });
    await workingFriday(page);
    const added = await call(page, "pick.add", { date: FRI, half: "PM", clientKey: "Northwind", intention: "Tidy the sprint board", size: "S" });
    expect(added.ok).toBe(true);
    const id = (added.data.pick as { id: number }).id;
    await page.reload();
    await day(page, FRI);
    await cardsOrTimeline(page, "Timeline");
    const bands = page.locator(".today-tl .tt-block");
    await expect.poll(() => bands.count()).toBe(2);
    await expect(bands.locator(".card-client").allInnerTexts()).resolves.toEqual(["Catch-up", "Catch-up"]);
    await expect(bands.first().getAttribute("class")).resolves.toContain("overflow");
    const r = page.locator(`.today-tl [data-tt="p${id}"]`).first();
    await r.focus();
    await page.keyboard.press("t");
    await toast(page).getByText(/^Timeboxed: Tidy the sprint board/).waitFor();
    await expect.poll(async () => ((await call(page, "week.load", { weekStart: "2026-11-02" })).data.timeboxes as { pickId: number; removedAt: string | null }[]).filter((t) => t.pickId === id && !t.removedAt).length).toBe(1);
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => ((await call(page, "week.load", { weekStart: "2026-11-02" })).data.timeboxes as { pickId: number; removedAt: string | null }[]).filter((t) => t.pickId === id && !t.removedAt).length).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a person who hid the catch-up day on Week still sees it on Day", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await workingFriday(page);
    expect((await call(page, "ui.set_week_days", { catchUp: false })).ok).toBe(true);
    await page.reload();
    await goTo(page, "#/week", page.locator(".week-head").first());
    await expect.poll(() => page.locator(`main [data-drop^="${FRI}:"]`).count()).toBe(0);
    await day(page, FRI);
    await cardsOrTimeline(page, "Cards");
    await expect.poll(() => page.locator(".day-view .half").count()).toBe(2);
    expect((await call(page, "ui.set_week_days", { catchUp: true })).ok).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the phone's Day on the catch-up day: its blocks, named Catch-up, with their to-dos", async () => {
    const page = await phonePage(h, 390);
    await workingFriday(page);
    expect((await call(page, "pick.add", { date: FRI, half: "AM", clientKey: "Northwind", intention: "Reply to the release question", size: "S" })).ok).toBe(true);
    await page.reload();
    await day(page, FRI);
    const heads = page.locator(".ph-todos .ph-block-head");
    await expect.poll(() => heads.count()).toBe(2);
    await expect.poll(async () => (await heads.allInnerTexts()).map((t) => t.split("·")[0]!.trim())).toEqual(["Catch-up", "Catch-up"]);
    await page.locator(".ph-todos", { hasText: "Reply to the release question" }).waitFor();
    await page.close();
  }, T);

  for (const friday of ["no hours", "working"] as const)
    it(`over the demo's week (Friday: ${friday}), each day's blocks on Day are Week's cards, in Cards and in Timeline`, async () => {
      const { page, errors } = await freshPage(h, { width: 1920, height: 1200 });
      if (friday === "working") await workingFriday(page);
      await page.reload();
      await goTo(page, "#/week", page.locator(".week-head").first());
      await page.locator("main .half.card").first().waitFor();
      const week: Record<string, string[]> = {};
      for (const d of WEEK) week[d] = await drawn(page.locator("main"), d);
      for (const d of WEEK) {
        // A PTO day or holiday is unchanged by RS-2: Day shows "You're off" and only what is still planned.
        if (week[d]!.includes("pto")) continue;
        await day(page, d);
        await cardsOrTimeline(page, "Cards");
        await expect.poll(() => drawn(page.locator(".day-view"), d), { timeout: 10_000 }).toEqual(week[d]);
        await cardsOrTimeline(page, "Timeline");
        // A day Week draws as one cell (PTO, a catch-up day with no hours) is one cell on the timeline too.
        const tl = await page.locator(".today-tl").count() ? page.locator(".today-tl .tt-block").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").length > 0)) : Promise.resolve([] as boolean[]);
        const whole = await page.locator(".today-tl .tt-off").count();
        const n = (await tl).length + whole;
        expect(n, `${d} in Timeline`).toBe(week[d]!.includes("day") ? 1 : week[d]!.length);
        await cardsOrTimeline(page, "Cards");
      }
      expect(errors).toEqual([]);
      await page.close();
    }, T);
});
