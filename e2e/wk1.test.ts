// WK-1: Week fits laptops and smaller windows, in demo mode. At 1920, 1600, 1440, 1366, 1280 and 1024, with the detail
// panel open and closed, at Default and Larger text: the page never scrolls sideways, every day column is fully in view
// and clear of the panel, and each day answers a dragged story (its fit tip, or why it can't take it), with real drops
// on Monday and Friday. The now line and the PTO day show in every tier (rail, ruler, strip, mini, and on a folded
// strip). UI-B's unfinished suggestions still show at a mid-week clock (Wednesday 2:00 PM).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 240_000;
const WIDTHS: [number, number][] = [[1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768]];
const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const MON_AM = '[data-drop="2026-11-02:AM"]';
const FRI = '[data-drop="2026-11-06:AM"]';

const larger = (page: Page, on: boolean) =>
  page.evaluate((v) => (v ? document.documentElement.setAttribute("data-text-size", "larger") : document.documentElement.removeAttribute("data-text-size")), on).then(() => page.waitForTimeout(200));

/** No sideways scroll, and every day column (open or folded) fully in the window and clear of the panel. */
async function fits(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const grid = document.querySelector<HTMLElement>("main.grid")!;
    const panel = document.querySelector("aside.detail-panel")?.getBoundingClientRect() ?? null;
    const days = [...grid.querySelectorAll<HTMLElement>(":scope > section.day")].map((d) => {
      const b = d.getBoundingClientRect();
      return { label: d.getAttribute("aria-label"), left: b.left, right: b.right, width: b.width };
    });
    return { page: [de.scrollWidth, de.clientWidth], grid: [grid.scrollWidth, grid.clientWidth], days, panelLeft: panel?.left ?? null, w: innerWidth };
  });
  expect(m.page[0], "page scrolls sideways").toBe(m.page[1]);
  expect(m.grid[0], "grid scrolls sideways").toBe(m.grid[1]);
  expect(m.days).toHaveLength(5);
  for (const d of m.days) {
    expect(d.width, `${d.label} width`).toBeGreaterThan(30);
    expect(d.left, `${d.label} left`).toBeGreaterThanOrEqual(0);
    expect(d.right, `${d.label} right`).toBeLessThanOrEqual(m.w + 0.5);
    if (m.panelLeft !== null) expect(d.right, `${d.label} under the panel`).toBeLessThanOrEqual(m.panelLeft + 0.5);
  }
}

const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 60) };
};

/** Drags `from` over each day (each answers with its tip), then drops it on `to`; waits for the toast and dismisses it. */
async function dragAcross(page: Page, from: Locator, to: string, toast: RegExp): Promise<void> {
  const a = await center(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y + 10, { steps: 3 });
  for (const date of DAYS) {
    const target = page.locator(`main.grid [data-drop="${date}:AM"]`);
    const c = await center(target);
    await page.mouse.move(c.x, c.y, { steps: 6 });
    // A real browser keeps sending dragover while the pointer rests; Playwright's drag doesn't, so nudge it.
    await expect.poll(async () => {
      await page.mouse.move(c.x + 1, c.y + 1);
      await page.mouse.move(c.x, c.y);
      return (await target.locator(".drop-tip").count()) > 0 && /drop-(over|no)/.test((await target.getAttribute("class")) ?? "");
    }, { message: `${date} answers the drag (its tip, the half marked)` }).toBe(true);
  }
  const c = await center(page.locator(`main.grid ${to}`));
  await page.mouse.move(c.x, c.y, { steps: 6 });
  await page.mouse.up();
  const t = page.locator(".undo-toast", { hasText: toast });
  await t.waitFor();
  await t.getByRole("button", { name: "Dismiss" }).click();
  await t.waitFor({ state: "detached" });
}

async function openPanel(page: Page): Promise<Locator> {
  await page.locator(`main.grid ${MON_AM}`).click({ position: { x: 14, y: 12 } });
  const panel = page.getByRole("region", { name: "Your stories for Cooptimize" });
  await panel.waitFor();
  return panel;
}

async function closePanel(page: Page): Promise<void> {
  await page.locator("aside.detail-panel").getByRole("button", { name: /Close/ }).first().click();
  await page.locator("aside.detail-panel").waitFor({ state: "detached" });
}

const pickIn = (page: Page, sel: string) => page.locator(`main.grid ${sel} li[draggable='true']`).first();

describe.skipIf(!CHROMIUM)("WK-1: Week fits every width from 1024", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const [width, height] of WIDTHS) {
    it(`${width}: no sideways scroll, every day in view, each day takes a drag (panel open and closed, Default and Larger)`, async () => {
      const { page, errors } = await freshPage(h, { width, height });
      await page.keyboard.press("2");
      await page.locator("main.grid").waitFor();

      // Panel open, Default: a story from the panel over every day, onto Friday's catch-up.
      let panel = await openPanel(page);
      await fits(page);
      await dragAcross(page, panel.locator(".ps-row[data-story]").first(), FRI, /^Added to Fri/);

      // Panel closed, Default: Friday's pick over every day, back to Monday.
      await closePanel(page);
      await fits(page);
      await dragAcross(page, pickIn(page, FRI), MON_AM, /^Moved to Mon/);

      // Panel closed, Larger: Monday's pick over every day, to Friday.
      await larger(page, true);
      await fits(page);
      await dragAcross(page, pickIn(page, MON_AM), FRI, /^Moved to Fri/);

      // Panel open, Larger: another story from the panel over every day (Friday may be folded now), onto Friday.
      panel = await openPanel(page);
      await fits(page);
      await dragAcross(page, panel.locator(".ps-row[data-story]").nth(1), FRI, /^Added to Fri/);
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  }

  // Each tier, how to reach it on the demo week (Thursday is PTO, so Thursday and Friday take the light share).
  const TIERS: { tier: string; width: number; height: number; panel: boolean; big: boolean; fold?: boolean }[] = [
    { tier: "rail", width: 1920, height: 1080, panel: false, big: false },
    { tier: "ruler", width: 1440, height: 900, panel: false, big: false },
    { tier: "strip", width: 1024, height: 768, panel: false, big: false },
    { tier: "mini", width: 1280, height: 800, panel: true, big: true },
    { tier: "mini", width: 1024, height: 768, panel: true, big: true, fold: true },
  ];
  for (const t of TIERS) {
    it(`the now line and the PTO day show in the ${t.fold ? "fold" : t.tier} tier (${t.width}${t.panel ? ", panel" : ""}${t.big ? ", Larger" : ""})`, async () => {
      const { page, errors } = await freshPage(h, { width: t.width, height: t.height });
      await page.keyboard.press("2");
      await page.locator("main.grid").waitFor();
      if (t.big) await larger(page, true);
      if (t.panel) await openPanel(page);
      const grid = page.locator("main.grid");
      await expect.poll(() => grid.getAttribute("class")).toContain(`tier-${t.tier}`);
      const mon = grid.locator("> section.day").first();
      const thu = grid.locator("> section.day").nth(3);
      if (t.fold) {
        // Monday is selected: Thursday is a folded strip, hatched PTO. Then open Thursday: Monday folds, with its now line.
        await expect.poll(() => grid.getAttribute("class")).toContain("folded");
        await expect(thu.getAttribute("class")).resolves.toContain("folded");
        await expect(thu.locator(".fold-half.whole.pto").count()).resolves.toBe(1);
        await expect(mon.locator(".now-line").count()).resolves.toBeGreaterThan(0);
        await thu.locator(".fold-half").first().click();
        await expect.poll(() => mon.getAttribute("class")).toContain("folded");
        await expect(mon.locator(".fold-half .now-line").count()).resolves.toBe(1);
        await expect(mon.locator(".fold-risk").count()).resolves.toBeGreaterThan(0);
        await expect(thu.locator(".half.whole.pto").count()).resolves.toBe(1);
        await fits(page);
      } else {
        await expect(mon.locator(".now-line").count()).resolves.toBeGreaterThan(0);
        await expect(thu.locator(".half.whole.pto").count()).resolves.toBe(1);
        // The card draws exactly its tier's element.
        const am = mon.locator(MON_AM);
        const expectRail = t.tier === "rail" ? ".ruler:not(.slim)" : t.tier === "ruler" ? ".ruler.slim" : ".day-strip";
        await expect(am.locator(expectRail).count()).resolves.toBe(1);
        if (t.tier === "strip" || t.tier === "mini") await expect(am.locator(".day-strip .now-tick").count()).resolves.toBe(1);
        if (t.tier === "mini") await expect(am.locator(".pill-reason").isVisible()).resolves.toBe(false);
        // The block's time is always visible.
        await expect(am.locator(".card-when").isVisible()).resolves.toBe(true);
      }
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  }
});

describe.skipIf(!CHROMIUM)("WK-1: unfinished suggestions at every tier (Wednesday 2:00 PM)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-04T14:00:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  for (const [width, height, big] of [[1920, 1080, false], [1440, 900, false], [1024, 768, false], [1024, 768, true]] as const) {
    it(`shows them at ${width}${big ? ", Larger" : ""}, with the panel open and closed`, async () => {
      const { page, errors } = await freshPage(h, { width, height });
      await page.keyboard.press("2");
      await page.locator("main.grid").waitFor();
      if (big) await larger(page, true);
      const card = page.locator("main.grid .suggested-card").first();
      await card.waitFor();
      await expect(card.isVisible()).resolves.toBe(true);
      // Open the panel on Wednesday PM (today, where the suggestion sits): still in view beside it.
      await page.locator('main.grid [data-drop="2026-11-04:PM"]').click({ position: { x: 14, y: 12 } });
      await page.locator("aside.detail-panel").waitFor();
      await expect(card.isVisible()).resolves.toBe(true);
      await fits(page);
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  }
});
