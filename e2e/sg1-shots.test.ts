// SG-1: screenshots of the board's suggestions on the demo, Tuesday Nov 3, 9:30 AM (Monday is past, Wednesday
// is the next working day; the demo's Thursday is PTO). Only when SG1_SHOTS names a folder (docs/ux/sg1 or docs/ux/sg1/before); nothing
// runs otherwise. SG1_STAGE=before takes the three "before" views; otherwise the full "after" set at 1440x900 and
// 1280x720, light and dark, and the phone at 390x844.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.SG1_SHOTS ?? null;
const BEFORE = process.env.SG1_STAGE === "before";
const T = 300_000;
const FROM = "2026-11-03";
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const SIZES = BEFORE ? [{ width: 1440, height: 900 }] : [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);
async function themed(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(900);
};
const ready = async (page: Page) => {
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
};

/** Tuesday and later start empty: the demo's own to-dos on them come off (Monday keeps its unfinished ones). */
async function emptyAhead(page: Page) {
  const w = (await call(page, "week.load", {})) as { data?: { plan?: Record<string, { picks: { id: number; status: string }[] }> } };
  for (const [date, d] of Object.entries(w.data?.plan ?? {})) if (date >= FROM) for (const p of d.picks) if (p.status === "planned") await call(page, "pick.remove", { id: p.id });
  await page.reload();
  await ready(page);
}

describe.skipIf(!CHROMIUM || !DIR)("SG-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-03T09:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  for (const size of SIZES)
    for (const theme of THEMES) {
      const tag = `${size.width}x${size.height}-${theme}`;
      it(`Day and Week, ${tag}`, async () => {
        const { page } = await freshPage(h, size);
        const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}-${tag}.png` });
        await emptyAhead(page);
        await themed(page, theme);

        await go(page, "#/day");
        await shot("day");
        await go(page, "#/week");
        await page.locator(".week-head").first().waitFor();
        await shot("week");
        if (BEFORE) {
          // UI-B's unfinished cards and their "Keep all · Review" line, in the block panel's To place.
          const review = page.locator(".to-place-line button", { hasText: "Review" });
          if (await review.count()) {
            await review.first().click();
            await page.waitForTimeout(700);
            await shot("week-carried");
            await page.keyboard.press("Escape");
          }
          await page.close();
          return;
        }

        // A block's line, the day's line, the hover reason.
        const sg = page.locator(".sug-block").first();
        await sg.hover();
        await page.waitForTimeout(300);
        await shot("week-block-line");
        await go(page, "#/day");
        await shot("day-line");
        // The panel on a block with suggestions.
        await page.locator(".half.focus .card-when").first().click();
        await page.locator("aside.block-panel").waitFor();
        await page.waitForTimeout(600);
        await shot("panel");
        await page.keyboard.press("Escape");
        // The Timeline.
        await page.locator(".day-switch button", { hasText: "Timeline" }).click();
        await page.waitForTimeout(800);
        await shot("timeline");
        await page.locator(".day-switch button", { hasText: "Cards" }).click();
        await page.waitForTimeout(500);
        // Clear on a block, with Undo showing.
        await page.locator(".sug-block .sug-clear").first().click();
        await page.waitForTimeout(400);
        await shot("after-clear");
        await page.locator(".undo-toast button", { hasText: "Undo" }).first().click().catch(() => {});
        await page.waitForTimeout(800);
        // Keep all for the day.
        await page.locator(".sug-day .sug-keep-all").first().click();
        await page.waitForTimeout(1200);
        await shot("after-keep-all");
        await page.close();
      }, T);
    }

  it.skipIf(BEFORE)("the phone", async () => {
    const { page } = await freshPage(h, { width: 390, height: 844 });
    await emptyAhead(page);
    for (const theme of THEMES) {
      await themed(page, theme);
      await go(page, "#/day");
      await page.screenshot({ path: `${DIR}/phone-day-390x844-${theme}.png`, fullPage: false });
      await page.locator(".sug-block").first().scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: `${DIR}/phone-block-390x844-${theme}.png`, fullPage: false });
    }
    await page.close();
  }, T);
});
