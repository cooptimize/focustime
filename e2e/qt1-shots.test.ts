// QT-1: screenshots of Week and Day on the demo, Wednesday Nov 4, 2:30 PM (Monday and Tuesday are past, Wednesday's
// morning has ended). Only when QT1_SHOTS names a folder (docs/ux/qt1 or docs/ux/qt1/before); nothing runs otherwise.
// 1440x900, light and dark. The same script took the "before" set from main and the "after" set from the branch.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.QT1_SHOTS ?? null;
const T = 300_000;
const WED = "2026-11-04";
const NEXT_TUE = "2026-11-10";
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);
async function themed(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(800);
};
const panel = (page: Page) => page.locator("aside.block-panel");
const block = (page: Page, date: string, half: string) => page.locator(`main.grid [data-drop="${date}:${half}"]`).first();

/** Wednesday afternoon over-planned (more than its free time, one done), next Tuesday with a little. Monday and Tuesday are past: the demo's own. */
async function seed(page: Page) {
  const adds: [string, string, string, Record<string, unknown>][] = [
    [WED, "PM", "Northwind", { itemId: 1112, size: "L" }],
    [WED, "PM", "Northwind", { intention: "Draft the cutover checklist", size: "L" }],
    [WED, "PM", "Northwind", { intention: "Answer the pricing questions", size: "M" }],
    [WED, "PM", "Northwind", { intention: "Walk through the import errors", size: "L" }],
    [NEXT_TUE, "PM", "Atlas", { intention: "Rate table follow-up", size: "S" }],
  ];
  const made: { date: string; id: number }[] = [];
  for (const [date, half, clientKey, x] of adds) {
    const r = (await call(page, "pick.add", { date, half, clientKey, ...x })) as { ok: boolean; data?: { pick?: { id: number } } };
    if (r.ok && r.data?.pick) made.push({ date, id: r.data.pick.id });
  }
  // The first of Wednesday's to-dos done.
  if (made[0]) await call(page, "pick.mark_done", { id: made[0].id, done: true });
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}

describe.skipIf(!CHROMIUM || !DIR)("QT-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-04T14:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  for (const theme of THEMES) {
    it(`Week and Day, ${theme}`, async () => {
      const { page } = await freshPage(h, { width: 1440, height: 900 });
      const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}-1440x900-${theme}.png` });
      await seed(page);
      await themed(page, theme);

      await go(page, "#/week");
      await page.locator(".week-head").first().waitFor();
      await page.waitForTimeout(500);
      await shot("week");

      await block(page, WED, "PM").locator(".card-when").click();
      await panel(page).waitFor();
      await page.waitForTimeout(600);
      await shot("week-panel");
      await page.keyboard.press("Escape");

      await go(page, `#/day/${WED}`);
      await page.waitForTimeout(600);
      await shot("day-today");

      await go(page, `#/day/${NEXT_TUE}`);
      await page.waitForTimeout(600);
      await shot("day-ahead");

      await go(page, "#/week/2026-10-26");
      await page.locator(".week-head").first().waitFor();
      await page.waitForTimeout(600);
      await shot("week-past");
      await page.close();
    }, T);
  }
});
