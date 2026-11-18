// DY-1: Day at the time it is. Day's header stays in view; a block of today that has ended folds to one line, so the
// block under way is on screen on arrival; folds by hand are kept for today in this browser. Demo mode: Mon Nov 2,
// Cooptimize 9:00 to 12:30 and Northwind 12:30 to 5:00; the clock at 3:55 PM (and 12:28 PM for the live fold).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 120_000;
const AFTERNOON = "2026-11-02T15:55:00-05:00";
const AM = '.day-view [data-half="AM"]';
const PM = '.day-view [data-half="PM"]';

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json() as Promise<{ ok: boolean; data?: any }>), [action, input] as const);

async function openDay(page: Page, hash = "#/day") {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.locator(".day-view .card-client").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

const folded = (page: Page, sel: string) => page.locator(sel).evaluate((el) => el.classList.contains("day-folded"));

/** The block's header and first lines are on screen, below Day's header; the now line is in view. */
async function onScreen(page: Page, sel: string) {
  return page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s)!;
    const head = document.querySelector<HTMLElement>(".day-view > .day-bar")!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const line = el.querySelector<HTMLElement>(".now-line:not(.now-tick)")?.getBoundingClientRect() ?? null;
    const vh = window.innerHeight - 40;
    return { head: r.top >= head.bottom - 1 && r.top + 80 <= vh, now: line === null ? null : line.top >= head.bottom && line.bottom <= vh };
  }, sel);
}

describe.skipIf(!CHROMIUM)("DY-1: Day at the time it is (browser, demo mode, 3:55 PM)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, AFTERNOON);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("arrives on the block under way, in Timeline and Cards, at 1440x900 and 1280x720, the morning folded", async () => {
    const { page, errors } = await freshPage(h);
    for (const timeline of [true, false]) {
      await call(page, "ui.set_today_timeline", { show: timeline });
      for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(size);
        await openDay(page);
        expect(await folded(page, AM)).toBe(true);
        expect(await folded(page, PM)).toBe(false);
        const at = await onScreen(page, PM);
        expect(at.head, `${timeline ? "Timeline" : "Cards"} ${size.width}`).toBe(true);
        if (timeline) expect(at.now, `now line, ${size.width}`).toBe(true);
      }
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the folded line counts done and not done (late), the meetings, and a call to review whose mark opens it", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const a = await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Tidy the release notes", size: "S" });
    await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Answer the sizing question", size: "S" });
    expect((await call(page, "pick.mark_done", { id: a.data.pick.id, done: true })).ok).toBe(true);
    await call(page, "ui.set_today_timeline", { show: true });
    await openDay(page);
    const line = page.locator(`${AM} .day-fold-sum`);
    await expect(line.locator(".dfs-done").textContent()).resolves.toBe("1 done");
    await expect(line.locator(".dfs-left.late").textContent()).resolves.toBe("1 not done");
    await expect(line.locator(".dfs-meetings").textContent()).resolves.toMatch(/^\d+ meetings?$/);
    // The afternoon has the weekly call to review: fold it by hand and its mark is on the line, and opens the call.
    await page.locator(`${PM} .day-fold-arrow`).click();
    const mark = page.locator(`${PM} .day-fold-sum .call-mark`);
    await mark.waitFor();
    await mark.click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/meetings\/\d+/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("unfolds and folds by hand; a reload keeps it; the next day forgets it; with storage refused it lasts the visit", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ui.set_today_timeline", { show: true });
    await openDay(page);
    const arrow = page.locator(`${AM} .day-fold-arrow`);
    await expect(arrow.getAttribute("aria-expanded")).resolves.toBe("false");
    await arrow.click();
    expect(await folded(page, AM)).toBe(false);
    await expect(arrow.getAttribute("aria-expanded")).resolves.toBe("true");
    // The block under way folds by hand too, by the keyboard.
    await page.locator(`${PM} .day-fold-arrow`).focus();
    await page.keyboard.press("Enter");
    expect(await folded(page, PM)).toBe(true);
    await openDay(page);
    expect(await folded(page, AM)).toBe(false);
    expect(await folded(page, PM)).toBe(true);
    // Pressing the folded line unfolds it.
    await page.locator(`${PM} .tt-head`).click({ position: { x: 400, y: 10 } });
    expect(await folded(page, PM)).toBe(false);
    // The next day: what was kept is another day's, and forgotten.
    await page.evaluate(() => localStorage.setItem("focustime.dayFolds", JSON.stringify({ date: "2026-11-01", folds: { AM: false, PM: true } })));
    await openDay(page);
    expect(await folded(page, AM)).toBe(true);
    expect(await folded(page, PM)).toBe(false);
    expect(errors).toEqual([]);
    await page.close();

    const refused = await freshPage(h, { width: 1440, height: 900 }, {
      before: (p) => p.addInitScript(() => {
        const s = Storage.prototype;
        const get = s.getItem;
        const set = s.setItem;
        s.getItem = function (k: string) { if (k === "focustime.dayFolds") throw new Error("refused"); return get.call(this, k); };
        s.setItem = function (k: string, v: string) { if (k === "focustime.dayFolds") throw new Error("refused"); return set.call(this, k, v); };
      }),
    });
    await call(refused.page, "ui.set_today_timeline", { show: true });
    await openDay(refused.page);
    expect(await folded(refused.page, AM)).toBe(true);
    await refused.page.locator(`${AM} .day-fold-arrow`).click();
    expect(await folded(refused.page, AM)).toBe(false);
    await refused.page.locator(`${AM} .day-fold-arrow`).click();
    expect(await folded(refused.page, AM)).toBe(true);
    expect(refused.errors).toEqual([]);
    await refused.page.close();
  }, T);

  it("never folds by itself: a focus session in it, another day, Midday check-in, Timebox my day", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ui.set_today_timeline", { show: true });
    const a = await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Finish the export notes", size: "S" });
    expect((await call(page, "timer.start", { kind: "focus", minutes: 25, pickId: a.data.pick.id })).ok).toBe(true);
    await openDay(page);
    expect(await folded(page, AM)).toBe(false);
    await call(page, "timer.stop", {});
    await openDay(page);
    expect(await folded(page, AM)).toBe(true);
    // Another day: tomorrow.
    await openDay(page, "#/day/2026-11-03");
    expect(await page.locator(".day-view .day-folded").count()).toBe(0);
    expect(await page.locator(".day-view .day-fold-arrow").count()).toBe(0);
    // Midday check-in.
    await page.evaluate(() => (location.hash = "#/today/checkin"));
    await page.waitForTimeout(800);
    expect(await page.locator(".day-view .day-folded").count()).toBe(0);
    // Timebox my day's suggestions.
    await openDay(page);
    const tb = page.getByRole("button", { name: /Timebox my day/ });
    if (await tb.count()) {
      await tb.first().click();
      await page.waitForTimeout(800);
      if (await page.locator(".tt-bar").count()) expect(await page.locator(".day-view .day-folded").count()).toBe(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a drag over a folded block opens it until the drag ends (Cards)", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ui.set_today_timeline", { show: false });
    expect((await call(page, "pick.add", { date: "2026-11-02", half: "PM", clientKey: "Northwind", itemId: 1112, size: "M" })).ok).toBe(true);
    await openDay(page);
    expect(await folded(page, AM)).toBe(true);
    const row = page.locator(`${PM} .pr-title`).first();
    await row.waitFor();
    const a = (await row.boundingBox())!;
    await page.mouse.move(a.x + 20, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 32, a.y + a.height / 2 + 12, { steps: 4 });
    const b = (await page.locator(AM).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 2);
    await expect.poll(() => folded(page, AM)).toBe(false);
    // Dropped back where it came from: the drag ends and the morning folds again.
    await page.mouse.move(a.x + 20, a.y + a.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => folded(page, AM)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the option: off draws every block open, on folds again; stored and kept after a reload", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openDay(page);
    const option = async () => {
      await page.getByRole("button", { name: "View options for Day" }).click();
      return page.getByRole("menuitemcheckbox", { name: /Fold blocks that have ended/ });
    };
    let item = await option();
    await expect(item.getAttribute("aria-checked")).resolves.toBe("true");
    await item.click();
    await expect.poll(() => folded(page, AM)).toBe(false);
    await openDay(page);
    expect(await folded(page, AM)).toBe(false);
    item = await option();
    await expect(item.getAttribute("aria-checked")).resolves.toBe("false");
    await item.click();
    await expect.poll(() => folded(page, AM)).toBe(true);
    await openDay(page);
    expect(await folded(page, AM)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day's header and a block's header stay while the page scrolls; Tab never lands focus under them", async () => {
    const { page, errors } = await freshPage(h, { width: 1280, height: 720 });
    await call(page, "ui.set_today_timeline", { show: true });
    await openDay(page);
    await page.locator(`${AM} .day-fold-arrow`).click();
    const main = page.locator("main.day-view");
    await main.evaluate((m) => (m.scrollTop = 0));
    const before = await page.locator(".day-view > .day-bar").boundingBox();
    // Into the (unfolded) morning, halfway down its hours.
    await page.locator(AM).evaluate((el) => {
      const m = el.closest("main")!;
      m.scrollTop += el.getBoundingClientRect().top - m.getBoundingClientRect().top + 150;
    });
    await page.waitForTimeout(200);
    const after = await page.locator(".day-view > .day-bar").boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    // The morning's header sits right under Day's header while its hours scroll by.
    const ph = await page.locator(`${AM} .tt-head`).boundingBox();
    expect(ph!.y).toBeGreaterThanOrEqual(after!.y + after!.height - 2);
    expect(ph!.y).toBeLessThan(after!.y + after!.height + 30);
    // Tab through Day: every focused thing outside the headers is below them.
    await main.evaluate((m) => (m.scrollTop = 0));
    await page.locator(".day-view > .day-bar").getByRole("button", { name: "View options for Day" }).focus();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        const bar = document.querySelector<HTMLElement>(".day-view > .day-bar");
        if (!a || !bar || !a.closest("main.day-view") || bar.contains(a)) return null;
        const head = a.closest(".tt-head, .card-head");
        const box = a.getBoundingClientRect();
        const covers = [bar, ...[...document.querySelectorAll<HTMLElement>(".day-view .tt-head, .day-view .day-cards .card-head")].filter((x) => x !== head && !x.contains(a))];
        const hidden = covers.some((c) => {
          const cr = c.getBoundingClientRect();
          return cr.height > 0 && box.top < cr.bottom - 1 && box.bottom > cr.top + 1 && box.left < cr.right && box.right > cr.left && getComputedStyle(c).position === "sticky" && cr.top <= bar.getBoundingClientRect().bottom + 1;
        });
        return { hidden, what: a.getAttribute("aria-label") ?? a.textContent?.slice(0, 40) ?? "" };
      });
      if (r) expect(r.hidden, `focus on "${r.what}" is under a header`).toBe(false);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("DY-1: a block folds as the clock passes its end (browser, demo mode, 12:28 PM)", () => {
  let h: Harness;
  const START = "2026-11-02T12:28:00-05:00";
  beforeAll(async () => {
    h = await startDemo("chromium", {}, START);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("folds the morning once 12:30 passes, unless the person is in it; then once they leave", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, { before: (p) => p.clock.install({ time: Date.parse(START) }) });
    await call(page, "ui.set_today_timeline", { show: true });
    // The harness pins the page's clock with ?now=; here the page's own (installed) clock runs, so it can pass 12:30.
    await page.goto(`${h.url.split("?")[0]}#/day`);
    await openDay(page);
    expect(await folded(page, AM)).toBe(false);
    await page.clock.runFor(3 * 60_000);
    await expect.poll(() => folded(page, AM)).toBe(true);
    // Unfold it by hand, then forget that; with focus inside as it ends, it waits.
    await page.evaluate(() => localStorage.removeItem("focustime.dayFolds"));
    await page.clock.setSystemTime(Date.parse(START));
    await openDay(page);
    expect(await folded(page, AM)).toBe(false);
    await page.locator(`${AM} .day-fold-arrow`).focus();
    await page.mouse.move(0, 0);
    await page.clock.runFor(3 * 60_000);
    await page.waitForTimeout(300);
    expect(await folded(page, AM)).toBe(false);
    await page.locator(".day-view > .day-bar").getByRole("button", { name: "View options for Day" }).focus();
    await expect.poll(() => folded(page, AM)).toBe(true);
    // Its panel open as it ends: it stays open.
    await page.evaluate(() => localStorage.removeItem("focustime.dayFolds"));
    await page.clock.setSystemTime(Date.parse(START));
    await openDay(page);
    await page.locator(`${AM} .tt-head .card-client`).click();
    await page.locator("aside.block-panel").waitFor();
    await page.mouse.move(5, 300);
    await page.locator(".day-view > .day-bar").getByRole("button", { name: "View options for Day" }).focus();
    await page.clock.runFor(3 * 60_000);
    await page.waitForTimeout(300);
    expect(await folded(page, AM)).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
