// WK-5: the before and after screenshots of Week on a Thursday (e2e/wk5-states.ts), both themes, at 1440x900 and
// 1280x720, Cards and Timeline, the block panel closed and open on today's morning block. The after set adds the
// catch-up day and the weekend hidden (with the note), a folded day and past days with their to-dos. Only when
// WK5_SHOTS names a folder (docs/ux/wk5/before or docs/ux/wk5); nothing runs otherwise. Demo data only.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { buildWk5, WK5_CLOCK } from "./wk5-states.ts";
import { call } from "./sg1-helpers.ts";

const DIR = process.env.WK5_SHOTS ?? null;
const AFTER = !!DIR && !DIR.endsWith("before");
const T = 600_000;
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const SIZES = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];

async function themed(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
const closePanel = async (page: Page) => {
  for (let i = 0; i < 2 && (await page.locator("aside.block-panel").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
};
async function layout(page: Page, which: "Cards" | "Timeline") {
  const b = page.locator(".week-head .day-switch button", { hasText: which }).first();
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
  await page.waitForTimeout(700);
}
/** Today's morning block opens its panel. */
async function openToday(page: Page) {
  const card = page.locator(".day.today .half.focus").first();
  await card.locator(".card-head").first().click({ position: { x: 4, y: 4 } });
  await page.locator("aside.block-panel").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
}

describe.skipIf(!CHROMIUM || !DIR)("WK-5 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, WK5_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  for (const size of SIZES)
    it(`Week on a Thursday at ${size.width}x${size.height}`, async () => {
      const { page } = await freshPage(h, size);
      await buildWk5(page);
      await page.evaluate(() => (location.hash = "#/week"));
      await page.waitForTimeout(1200);
      for (const theme of THEMES) {
        await themed(page, theme);
        const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}-${size.width}x${size.height}-${theme}.png` });
        for (const which of ["Cards", "Timeline"] as const) {
          await layout(page, which);
          await closePanel(page);
          await shot(`week-${which.toLowerCase()}`);
          await openToday(page);
          await shot(`week-${which.toLowerCase()}-panel`);
          await closePanel(page);
        }
        if (AFTER) {
          await layout(page, "Cards");
          // The catch-up day and the weekend hidden, with the note.
          await call(page, "ui.set_week_days", { catchUp: false, weekend: false });
          await page.reload();
          await page.waitForSelector(".week-head", { timeout: 60_000 });
          await themed(page, theme);
          await page.waitForTimeout(800);
          await shot("week-hidden");
          await openToday(page);
          await shot("week-hidden-panel");
          await closePanel(page);
          await call(page, "ui.set_week_days", { catchUp: true, weekend: true });
          await page.reload();
          await page.waitForSelector(".week-head", { timeout: 60_000 });
          await themed(page, theme);
          await page.waitForTimeout(800);
          // A folded day: the panel open at the largest text size folds the farthest days.
          await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
          await page.waitForTimeout(500);
          await openToday(page);
          await shot("week-folded-larger");
          await closePanel(page);
          await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
          await page.waitForTimeout(500);
        }
      }
      await page.close();
    }, T);
});
