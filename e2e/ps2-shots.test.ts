// PS-2: before and after screenshots of the clipped text under titles (docs/ux/ps2/). Day with the panel open on the
// morning block (three long DevOps to-dos, e2e/ps1-states.ts), Day without it, Day's Timeline and Week, at 1440x900 and
// 1280x720 in both themes, the phone at 390x844, and close crops of a card's to-do rows and the panel's rows. Only when
// PS2_SHOTS names a folder; nothing runs otherwise. Demo data only.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { buildState, PS_CLOCK } from "./ps1-states.ts";

const DIR = process.env.PS2_SHOTS ?? null;
const DEFAULT = { dayPanel: "default" } as const;
const T = 600_000;
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const DESKTOP = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];
const PHONE = { width: 390, height: 844 };

async function themed(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(1000);
};
const closePanel = async (page: Page) => {
  for (let i = 0; i < 2 && (await page.locator("aside.block-panel").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
};
async function layout(page: Page, which: "Cards" | "Timeline") {
  const b = page.locator(".day-switch button", { hasText: which }).first();
  if (await b.count()) await b.click();
  await page.waitForTimeout(700);
}
async function openPanel(page: Page) {
  if (await page.locator("aside.block-panel").count()) return;
  const card = page.locator(".half.focus").first();
  await card.locator(".card-head").first().click({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.locator("aside.block-panel").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(700);
}
/** A close crop of one element, padded a little, when it is on screen. */
async function crop(page: Page, selector: string, path: string) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return;
  const b = await el.boundingBox();
  if (!b) return;
  const vp = page.viewportSize()!;
  const x = Math.max(0, b.x - 8), y = Math.max(0, b.y - 8);
  await page.screenshot({ path, clip: { x, y, width: Math.min(vp.width - x, b.width + 16), height: Math.min(vp.height - y, b.height + 16) } });
}
// The morning card (the one with the long DevOps titles), the panel's ON THIS BLOCK and Assigned to you, a Timeline row.
const CARD = "main .half.focus:has(a[data-card])";
const TIMELINE_ROWS = ".day-view .pick-row.dens-today";
const PANEL_TODOS = "aside.block-panel .bp-todos";
const PANEL_ASSIGNED = "aside.block-panel section:has(.aw-feat-name)";
/** Crops at 1280 (where Day's card shows the cut on main) in the light theme. */
const CROP_AT = 1280;

describe.skipIf(!CHROMIUM || !DIR)("PS-2 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  for (const state of ["ordinary", "heavy"] as const)
    for (const size of DESKTOP)
      it(`${state} at ${size.width}x${size.height}`, async () => {
        const { page } = await freshPage(h, size, DEFAULT);
        await buildState(page, state);
        for (const theme of THEMES) {
          await themed(page, theme);
          const name = (what: string) => `${DIR}/${what}-${state}-${size.width}x${size.height}-${theme}.png`;
          await go(page, "#/week");
          await closePanel(page);
          await page.screenshot({ path: name("week") });
          if (size.width === CROP_AT && theme === "light") await crop(page, CARD, name("crop-week-card"));
          await go(page, "#/day");
          await layout(page, "Cards");
          await openPanel(page);
          await page.screenshot({ path: name("day-panel") });
          if (size.width === CROP_AT && theme === "light") {
            await crop(page, CARD, name("crop-day-card"));
            await crop(page, PANEL_TODOS, name("crop-panel-todos"));
            await crop(page, PANEL_ASSIGNED, name("crop-panel-assigned"));
          }
          await closePanel(page);
          await page.screenshot({ path: name("day") });
          await layout(page, "Timeline");
          await page.screenshot({ path: name("timeline") });
          if (size.width === CROP_AT && theme === "light") await crop(page, TIMELINE_ROWS, name("crop-timeline-row"));
          await layout(page, "Cards");
        }
        await page.close();
      }, T);

  for (const state of ["ordinary", "heavy"] as const)
    it(`${state} on the phone`, async () => {
      const { page } = await freshPage(h, PHONE, DEFAULT);
      await buildState(page, state);
      for (const theme of THEMES) {
        await themed(page, theme);
        const name = (what: string) => `${DIR}/phone-${what}-${state}-390x844-${theme}.png`;
        await go(page, "#/week");
        await page.screenshot({ path: name("week"), fullPage: true });
        if (theme === "light") await crop(page, CARD, name("crop-card"));
        await go(page, "#/day");
        await page.screenshot({ path: name("day"), fullPage: true });
      }
      await page.close();
    }, T);
});
