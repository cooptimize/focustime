// U3: Week and the shared detail panel (browser, demo mode, clock pinned to Mon Nov 2, 9:30 AM). Behavior only: the
// rail is the one home for meetings, risk with its reason, the Plan chip only on unplanned days, done picks as a count
// off today, "needs stories" on the features line, no AM/PM labels; the panel from a card, a features line and a due
// badge, Esc, ticking in the panel, no Details dialog; the type scale on Today and Week; the Week word guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, timelineOn, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const MON = "2026-11-02";
const TUE = "2026-11-03";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(900);
};

/** Monday planned as in the U1 to U3 screenshots (one done), and Tuesday planned with one done pick. */
async function seed(page: Page): Promise<{ mon: number[]; tue: number[] }> {
  // FN-1: this test checks the plan's own tick; Wrap it up has its own (e2e/fn1.test.ts), so the sheet stays off here.
  expect((await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } })).ok).toBe(true);
  await page.reload();
  const add = async (date: string, half: string, clientKey: string, x: Record<string, unknown>) => (await call(page, "pick.add", { date, half, clientKey, ...x })).data.pick.id as number;
  const mon = [await add(MON, "AM", "Cooptimize", { itemId: 4411, size: "M" }), await add(MON, "AM", "Cooptimize", { itemId: 4412, size: "S" }), await add(MON, "PM", "Northwind", { itemId: 1111, size: "M" })];
  await call(page, "pick.mark_done", { id: mon[0], done: true });
  const tue = [await add(TUE, "AM", "Harbor", { itemId: 2211, size: "S" }), await add(TUE, "AM", "Harbor", { itemId: 2212, size: "S" })];
  await call(page, "pick.mark_done", { id: tue[0], done: true });
  await page.reload();
  await page.waitForSelector(".topbar");
  await go(page, `#/week/${MON}`);
  await page.waitForSelector(".half.focus");
  return { mon, tue };
}

/** U1's method: UI words on screen (the status bar counts, the top bar doesn't), titles and names excluded, as are hidden decorations (the rail's hour marks). */
const uiWords = (page: Page) =>
  page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    const TITLE = ".ev-title, .r-ev, .pr-title, .what, .feat-link, .day-allday .chip, a, input, textarea";
    let n = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t: Node | null;
    while ((t = w.nextNode())) {
      const p = t.parentElement;
      if (!p || !vis(p) || p.closest(".topbar, script, style, svg, .brand-stage, [aria-hidden='true']") || (p.closest(TITLE) && !p.closest(".mode-switch"))) continue;
      n += (t.textContent ?? "").trim().split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
    }
    return n;
  });

/** Every visible text's font size and weight that is off the scale (11, 12, 13, 15 px; 400, 500, 600). */
const offScale = (page: Page) =>
  page.evaluate(() => {
    const sizes = new Set(["11px", "12px", "13px", "15px"]);
    const weights = new Set(["400", "500", "600"]);
    const out: string[] = [];
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || e.closest(".brand-stage, svg, kbd")) continue;
      if (![...e.childNodes].some((x) => x.nodeType === 3 && (x.textContent ?? "").trim())) continue;
      const cs = getComputedStyle(e);
      if (!sizes.has(cs.fontSize) || !weights.has(cs.fontWeight)) out.push(`${cs.fontSize}/${cs.fontWeight} ${e.className} "${(e.textContent ?? "").trim().slice(0, 20)}"`);
    }
    return out;
  });

describe.skipIf(!CHROMIUM)("Week and the detail panel (U3)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("cards: meetings only on the rail, risk with its reason in the tooltip, no AM/PM labels; no Plan chip; done as a count off today; needs stories on the chip; under 175 words", async () => {
    const { page, errors } = await freshPage(h);
    await timelineOn(page);
    await seed(page);
    // No meeting title both on a card's rail and in its text.
    const dup = await page.evaluate(() =>
      [...document.querySelectorAll(".half.card")].flatMap((card) => {
        const rail = [...card.querySelectorAll(".ruler .r-ev")].map((e) => (e.textContent ?? "").trim()).filter(Boolean);
        // The risk chip's tooltip names the event on purpose; nothing else in the card body may.
        const body = card.querySelector(".card-body")?.cloneNode(true) as HTMLElement | undefined;
        body?.querySelector(".card-status")?.remove();
        const text = body?.textContent ?? "";
        return rail.filter((t) => text.includes(t));
      }),
    );
    expect(await page.locator(".ruler .r-ev").count()).toBeGreaterThan(0);
    expect(dup).toEqual([]);
    // WD-1: one status chip that never wraps; its reason is in the tooltip ("At risk: Dentist 12:00").
    const risks = page.locator(".half .status-pill.at_risk");
    expect(await risks.count()).toBeGreaterThan(0);
    for (const t of await risks.evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""))) expect(t).toMatch(/^At risk: \S/);
    // No AM/PM label anywhere on the grid.
    const ampm = await page.evaluate(() => [...document.querySelectorAll(".grid *")].filter((e) => [...e.childNodes].some((x) => x.nodeType === 3 && /^(AM|PM)$/.test((x.textContent ?? "").trim()))).length);
    expect(ampm).toBe(0);
    // WD-1: no Plan chip on a day header (a day header opens Add work), and no "Planned ✓".
    const day = (i: number) => page.locator("section.day").nth(i);
    await expect(page.locator(".day-plan").count()).resolves.toBe(0);
    await expect(page.getByText("Planned ✓").count()).resolves.toBe(0);
    // Done picks: a count on Tuesday, a visible row on today.
    await expect(day(1).locator(".pick-row.done").count()).resolves.toBe(0);
    await expect(day(1).locator(".card-done").first().textContent()).resolves.toBe("1 done");
    await expect(day(0).locator(".pick-row.done").count()).resolves.toBe(1);
    // A client with a feature that has no stories says so: WD-1 moved it from the card's features line to the client chip's badge.
    await expect(page.locator(".client-chips button.cc-chip", { hasText: /^Northwind/ }).locator(".cc-badge").textContent()).resolves.toBe("1");
    // 121: SW-1 adds Team to the mode switch (Board · Commit · Team); 122: UI-B's now line adds its time ("9:30");
    // 145: DM-1's story (From last week's unfinished picks, the late promise, the Out event's risk on Wednesday).
    // 146: SR-1's fourth Week mode (Status) in the mode switch. 147: WK-2's Timeline toggle beside the modes.
    // 151: AS-2's demo seed (Export orders to CSV on Wednesday afternoon, for the script's move by feature).
    // 161: IB-1 slice 4's rail reads the Inbox, so a late promise I added is marked on today's rail too.
    // 175: CW-1's demo call live in Northwind's delivery chat on today's card ("Call live in <chat> · started …", who, Join).
    expect(await uiWords(page)).toBeLessThan(175);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("WD-2: the block panel opens from a card and a due badge; Esc closes it; ticking there updates the card; no Details dialog", async () => {
    const { page, errors } = await freshPage(h);
    const { mon } = await seed(page);
    const card = page.locator(".half.card", { hasText: "Cooptimize" }).first();
    await card.locator(".card-when").click();
    const panel = page.locator(".block-panel");
    await panel.waitFor();
    await expect(panel.locator("h2").textContent()).resolves.toContain("Cooptimize");
    // WD-2 follow-up: one status line under the time; its reasons are on hover and open in place.
    const risk = panel.locator(".bp-head .bp-risk");
    await expect(risk.textContent()).resolves.toMatch(/^At risk · \d+ reasons?$/);
    await expect(risk.getAttribute("title")).resolves.toContain("Dentist");
    expect(await panel.locator(".bp-risks").count()).toBe(0);
    await risk.click();
    await expect(panel.locator(".bp-risks").textContent()).resolves.toContain("Dentist");
    await expect(page.locator("dialog.details").count()).resolves.toBe(0);
    // Ticking a pick in the panel ticks it on the card.
    await panel.locator(`[data-pick="${mon[1]}"] input[type=checkbox]`).check();
    await expect.poll(() => card.locator(`[data-pick="${mon[1]}"]`).getAttribute("class"), { timeout: 10_000 }).toContain("done");
    await page.keyboard.press("Escape");
    await expect.poll(() => panel.count()).toBe(0);
    // WD-2: the panel's Add list has this week's features with their stories (was PV-1's Your stories).
    await page.locator(".half.card", { hasText: "Northwind" }).first().locator(".card-when").click();
    await panel.waitFor();
    await panel.locator(".aw-features .aw-feature").first().waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(() => panel.count()).toBe(0);
    // A due badge opens the panel on that promise's row.
    await page.locator(".due-open").first().click();
    await panel.waitFor();
    await expect.poll(() => panel.locator(".aw-row.dp-focused[data-promise]").count()).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => panel.count()).toBe(0);
    // Enter on the focused card opens the panel (the old Details shortcut), not a dialog.
    await page.locator(".half.card.selected").focus();
    await page.keyboard.press("Enter");
    await panel.waitFor();
    await expect(page.locator("dialog").count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("WD-2: Day uses the same panel from a block card, at its own address", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    await go(page, "#/today");
    await page.waitForSelector(".day-view .half.card");
    await page.locator(".day-view .half.card").first().locator(".card-when").click();
    await page.locator(".block-panel").waitFor();
    await expect(page.locator(".block-panel h2").textContent()).resolves.toContain("Cooptimize");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/day/2026-11-02/AM");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".block-panel").count()).toBe(0);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/day");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("type scale: Day and Week use only 11, 12, 13 and 15 px at 400, 500 and 600, at 1920 and 3840", async () => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 1600 }]) {
      const { page, errors } = await freshPage(h, viewport);
      await seed(page);
      expect(await offScale(page)).toEqual([]);
      await go(page, "#/today");
      await page.waitForSelector(".day-view .half.card");
      expect(await offScale(page)).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 2 * T);
});
