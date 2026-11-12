// PS-1: the before and after screenshots of Day, Week and the block panel, in three states (e2e/ps1-states.ts), both
// themes, at 1440x900, 1280x720 and the phone at 390x844. Only when PS1_SHOTS names a folder (docs/ux/ps1/before or
// docs/ux/ps1); nothing runs otherwise. Demo data only.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { buildState, PS_CLOCK, type PsState } from "./ps1-states.ts";

const DIR = process.env.PS1_SHOTS ?? null;
const T = 600_000;
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const STATES: PsState[] = ["empty", "ordinary", "heavy"];
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
async function cardsOrTimeline(page: Page, which: "Cards" | "Timeline") {
  const b = page.locator(".day-switch button", { hasText: which }).first();
  if (await b.count()) await b.click();
  await page.waitForTimeout(700);
}
/** The block under way (today's morning) opens its panel. */
async function openPanel(page: Page) {
  if (await page.locator("aside.block-panel").count()) return;
  const card = page.locator(".half.focus.today-block, .half.focus").first();
  await card.locator(".card-head").first().click({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.locator("aside.block-panel").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

describe.skipIf(!CHROMIUM || !DIR)("PS-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  for (const state of STATES)
    for (const size of DESKTOP)
      it(`${state} at ${size.width}x${size.height}`, async () => {
        const { page } = await freshPage(h, size);
        await buildState(page, state);
        for (const theme of THEMES) {
          await themed(page, theme);
          const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}-${state}-${size.width}x${size.height}-${theme}.png` });
          await go(page, "#/week");
          await closePanel(page);
          await page.locator(".week-head").first().waitFor().catch(() => {});
          await shot("week");
          await go(page, "#/day");
          await cardsOrTimeline(page, "Cards");
          await closePanel(page);
          await shot("day");
          await cardsOrTimeline(page, "Timeline");
          await closePanel(page);
          await shot("timeline");
          await cardsOrTimeline(page, "Cards");
          await openPanel(page);
          await shot("panel");
          await closePanel(page);
        }
        await page.close();
      }, T);

  for (const state of STATES)
    it(`${state} on the phone`, async () => {
      const { page } = await freshPage(h, PHONE);
      await buildState(page, state);
      for (const theme of THEMES) {
        await themed(page, theme);
        const shot = (name: string) => page.screenshot({ path: `${DIR}/phone-${name}-${state}-390x844-${theme}.png` });
        await go(page, "#/week");
        await shot("week");
        await go(page, "#/day");
        await shot("day");
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);
        await shot("day-end");
        await page.evaluate(() => window.scrollTo(0, 0));
        await openPanel(page);
        await shot("panel");
        await closePanel(page);
      }
      await page.close();
    }, T);
});
