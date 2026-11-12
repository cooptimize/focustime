// PS-1: the polish sweep's browser checks, measured rather than looked at. Holidays show like PTO with their name (F);
// every clickable thing on Day, Week and the panel is at least 28px (44px on the phone); a card's chips never touch its
// ⋯; the cards in a row start their first lines at one height; nothing sits under the phone's capture button at the end
// of a scroll; the header's + Add is on Day and Week at every width and is the only filled button there; and Day opens
// with its panel on a wide window and stays closed once closed. PS-2: no line of text shows in part (a line is whole or
// hidden, never a sliver under a title) and no title link's focus ring is cut, at Default and the largest Text size.
// Demo data only (e2e/ps1-states.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { buildState, PS_CLOCK, type PsState } from "./ps1-states.ts";
import { chipTouchesMore, clippedLines, cutFocusRings, headTops, smallTargets, underCapture } from "./ps1-audit.ts";

const DEFAULT = { dayPanel: "default" } as const;
const T = 300_000;
const HOLIDAY = "2026-11-05";
const HOLIDAY_NAME = "Founders Day (observed)";
const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
];
const SCOPE = "main, aside.block-panel, .page-head, .week-head, .day-head";

const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(900);
};
const closePanel = async (page: Page) => {
  for (let i = 0; i < 2 && (await page.locator("aside.block-panel").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
};

const PANEL_SCOPE = "main, aside.block-panel";
/** Opens the block under way (today's morning) in the panel, as a click on its card's head does. */
const openBlock = async (page: Page) => {
  if (await page.locator("aside.block-panel").count()) return;
  await page.locator("main .half.focus .card-head").first().click({ position: { x: 4, y: 4 }, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
};
/**
 * Opens the panel's folds (More in <client>, To place, You sent, N done) as a click would, from the page: a fold that
 * isn't drawn (or is under something) would make a pointer click wait out its timeout.
 */
const openFolds = async (page: Page) => {
  for (let round = 0; round < 3; round++) {
    const opened = await page.evaluate(() => {
      const folds = [...document.querySelectorAll<HTMLButtonElement>("aside.block-panel .pl-fold[aria-expanded=false]")];
      for (const f of folds) f.click();
      return folds.length;
    });
    if (!opened) break;
    await page.waitForTimeout(600);
  }
};

/** The header's + Add: shown, and the only button in its header with the main action's fill. */
async function addIsTheOneFill(page: Page): Promise<{ shown: boolean; filled: number }> {
  return page.evaluate(() => {
    const add = [...document.querySelectorAll<HTMLElement>(".add-work-head")].find((b) => b.getBoundingClientRect().width > 0);
    if (!add) return { shown: false, filled: 0 };
    const head = add.closest(".page-head, .week-head, .day-head") ?? add.parentElement!;
    const fill = getComputedStyle(add).backgroundColor;
    const filled = [...head.querySelectorAll<HTMLElement>("button")].filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).backgroundColor === fill).length;
    return { shown: true, filled };
  });
}

describe.skipIf(!CHROMIUM)("PS-1: polish sweep on Day and Week", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  it("a holiday shows like PTO, by its name, on Week, on Day and on the phone, with no + Add or suggestions", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, DEFAULT);
    await buildState(page, "empty");
    await go(page, "#/week");
    const thu = page.locator("main.grid .half.whole.holiday");
    await expect.poll(() => thu.count()).toBe(1);
    expect(await thu.textContent()).toContain(HOLIDAY_NAME);
    expect(await page.locator(".holiday-pill").first().textContent()).toBe("Holiday");
    expect(await thu.locator(".add-work, .sug-list").count()).toBe(0);
    // At the largest Text size the name wraps in its narrow cell; it is never cut.
    await page.setViewportSize({ width: 1280, height: 720 });
    for (let i = 0; i < 2; i++) await page.keyboard.press("Control+Equal");
    await page.waitForTimeout(500);
    const cut = await thu.locator(".whole-label").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(cut).toBe(false);
    await page.keyboard.press("Control+0");
    await page.setViewportSize({ width: 1440, height: 900 });

    await go(page, `#/day/${HOLIDAY}`);
    await expect.poll(() => page.locator(".day-view").textContent()).toContain(`${HOLIDAY_NAME}. You're off`);
    expect(await page.locator(".day-view .holiday-pill").textContent()).toBe("Holiday");
    expect(await page.locator(".day-view .add-work.add-row, .day-view .sug-list").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();

    const phone = await freshPage(h, { width: 390, height: 844 }, DEFAULT);
    await buildState(phone.page, "empty");
    await go(phone.page, `#/day/${HOLIDAY}`);
    await expect.poll(() => phone.page.locator("main").textContent()).toContain(HOLIDAY_NAME);
    expect(await phone.page.locator("main .add-work.add-row, main .sug-list").count()).toBe(0);
    await go(phone.page, "#/week");
    await phone.page.locator(".ph-week button", { hasText: /^Thu/ }).first().click().catch(() => {});
    await phone.page.waitForTimeout(500);
    expect(await phone.page.locator("main").textContent()).toContain(HOLIDAY_NAME);
    expect(phone.errors).toEqual([]);
    await phone.page.close();
  }, T);

  for (const state of ["ordinary", "heavy"] as PsState[])
    for (const size of SIZES)
      it(`${state} at ${size.width}: targets, chips, first lines, the capture button, one filled + Add`, async () => {
        const { page, errors } = await freshPage(h, size, DEFAULT);
        await buildState(page, state);
        const phone = size.width < 600;
        for (const hash of ["#/week", "#/day"]) {
          await go(page, hash);
          await page.evaluate(() => window.scrollTo(0, 0));
          const where = `${state} ${hash} at ${size.width}`;
          expect(await smallTargets(page, SCOPE, phone ? 44 : 28), where).toEqual([]);
          expect(await chipTouchesMore(page), where).toEqual([]);
          for (const row of await headTops(page, "main")) expect(new Set(row).size, `${where}: first lines ${row}`).toBe(1);
          const add = await addIsTheOneFill(page);
          expect(add, where).toEqual({ shown: true, filled: 1 });
          if (phone) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(300);
            expect(await underCapture(page), where).toEqual([]);
          }
          // The panel, opened on the block under way, meets the same sizes.
          if (!phone && hash === "#/day") {
            await page.locator("aside.block-panel").waitFor({ timeout: 10_000 });
            expect(await smallTargets(page, "aside.block-panel", 28), `${where} panel`).toEqual([]);
          }
        }
        expect(errors).toEqual([]);
        await page.close();
      }, T);

  // PS-2: measured, not compared: every line of text inside an element that clips is fully inside or fully outside.
  // Week, Day's Cards with its panel (opened on the block under way), Day's Timeline, and the panel on Week, with its
  // folds open; at the largest Text size too.
  for (const state of ["ordinary", "heavy"] as PsState[])
    for (const size of SIZES)
      for (const larger of [false, true])
        it(`${state} at ${size.width}${larger ? ", Larger text" : ""}: no line of text shows in part, no focus ring is cut`, async () => {
          const { page, errors } = await freshPage(h, size, DEFAULT);
          await buildState(page, state);
          if (larger) {
            for (let i = 0; i < 2; i++) await page.keyboard.press("Control+Equal");
            await page.waitForTimeout(400);
          }
          const phone = size.width < 600;
          const where = `${state} at ${size.width}${larger ? " Larger" : ""}`;
          const look = async (what: string) => {
            await page.evaluate(() => window.scrollTo(0, 0));
            expect(await clippedLines(page, PANEL_SCOPE), `${where} ${what}`).toEqual([]);
            expect(await cutFocusRings(page, PANEL_SCOPE), `${where} ${what}: focus rings`).toEqual([]);
          };
          await go(page, "#/week");
          await look("Week");
          await openBlock(page);
          if (await page.locator("aside.block-panel").count()) {
            await openFolds(page);
            await look("Week's panel");
          }
          await closePanel(page);
          await go(page, "#/day");
          if (!phone) await page.locator("aside.block-panel").waitFor({ timeout: 10_000 });
          await look("Day");
          if (!phone) {
            await openFolds(page);
            await look("Day's panel, folds open");
            await page.locator(".day-switch button", { hasText: "Timeline" }).first().click();
            await page.waitForTimeout(700);
            await look("Day's Timeline");
          } else {
            await openBlock(page);
            await openFolds(page);
            await look("the phone's block");
          }
          expect(errors).toEqual([]);
          await page.close();
        }, T);

  it("a tick on a heavy block today keeps focus on its checkbox (the row doesn't fold away)", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await buildState(page, "heavy");
    await go(page, "#/day");
    // A plain to-do (a DevOps one's tick offers Mark done in DevOps, which takes focus on purpose).
    const box = page.locator(".day-view .half.card.focus").first().locator('.checklist input[type=checkbox][aria-label="Done: Update the onboarding checklist"]').first();
    await box.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)).toBe("checkbox");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.checked)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day opens with its panel on a wide window; closed once, it stays closed; a narrow window opens without it", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, DEFAULT);
    await buildState(page, "ordinary");
    await go(page, "#/day");
    await page.locator("aside.block-panel").waitFor({ timeout: 10_000 });
    await closePanel(page);
    expect(await page.locator("aside.block-panel").count()).toBe(0);
    await page.reload();
    await page.waitForSelector(".day-view", { timeout: 60_000 });
    await page.waitForTimeout(800);
    expect(await page.locator("aside.block-panel").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();

    const narrow = await freshPage(h, { width: 1100, height: 800 }, DEFAULT);
    await buildState(narrow.page, "ordinary");
    await go(narrow.page, "#/day");
    await narrow.page.waitForTimeout(600);
    expect(await narrow.page.locator("aside.block-panel").count()).toBe(0);
    await narrow.page.close();
  }, T);
});
