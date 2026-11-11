// WD-2: the "after" screenshots, on the demo (Monday Nov 2, 9:30 AM; Tuesday for a past day). Only when WD2_SHOTS
// names a folder (docs/ux/wd2); nothing runs otherwise. 1440x900 and 1280x720, light and dark, and the phone at
// 390x844. The "before" ones (docs/ux/wd2/before) were taken from main before the change.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";

const DIR = process.env.WD2_SHOTS ?? null;
const T = 300_000;
const MON = "2026-11-02";
const TUE = "2026-11-03";
const SIZES = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }] as const;
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
  await page.waitForTimeout(700);
};
const panel = (page: Page) => page.locator("aside.block-panel");
/** Monday with work on both blocks (each demo session has its own plan), so the cards, the panel and the timeline have something. */
async function seed(page: Page) {
  const adds: [string, string, Record<string, unknown>][] = [
    ["AM", "Cooptimize", { itemId: 4411, size: "M" }],
    ["AM", "Cooptimize", { itemId: 4412, size: "S" }],
    ["PM", "Northwind", { itemId: 1112, size: "M" }],
    ["PM", "Northwind", { intention: "Review the export spec with Dana", size: "S" }],
  ];
  for (const [half, clientKey, x] of adds) await call(page, "pick.add", { date: MON, half, clientKey, ...x });
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}
const block = (page: Page, date: string, half: string, scope = "main.grid") => page.locator(`${scope} [data-drop="${date}:${half}"]`).first();

describe.skipIf(!CHROMIUM || !DIR)("WD-2 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const size of SIZES)
    for (const theme of THEMES) {
      const tag = `${size.width}x${size.height}-${theme}`;
      it(`Week and Day, ${tag}`, async () => {
        const { page } = await freshPage(h, size);
        const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}-${tag}.png` });
        await seed(page);
        await themed(page, theme);

        // Week with the panel on a block with work.
        await go(page, "#/week");
        await page.locator(".week-head").waitFor();
        await block(page, MON, "PM").locator(".card-when").click();
        await panel(page).locator(".aw-features").waitFor();
        await page.waitForTimeout(500);
        await shot("week-panel-work");

        // The Add list before typing is that panel; then while typing, and with no match.
        await panel(page).locator("input.bp-box").click();
        await page.keyboard.type("export");
        await panel(page).locator("#bp-results .bp-result").first().waitFor();
        await page.waitForTimeout(200);
        await shot("add-typing");
        await panel(page).locator("input.bp-box").fill("Ring the print shop about proofs");
        await page.waitForTimeout(250);
        await shot("add-no-match");
        await panel(page).locator("input.bp-box").fill("");

        // The drop area while a to-do is dragged off its block.
        // From the panel's own row (at 720 high the card's rows can be below the fold); a card's row drags the same way.
        const todo = panel(page).locator(".bp-on li.pick-row.planned").first();
        const a = (await todo.boundingBox())!;
        await page.mouse.move(a.x + Math.min(40, a.width / 2), a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + Math.min(40, a.width / 2) + 12, a.y + a.height / 2 + 12, { steps: 4 });
        const zone = panel(page).locator(".bp-takeoff");
        await zone.waitFor();
        const z = (await zone.boundingBox())!;
        await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 8 });
        await page.mouse.move(z.x + z.width / 2 + 2, z.y + z.height / 2 + 2);
        await page.waitForTimeout(250);
        await shot("drag-off-drop-area");
        // Let go back on its own block: nothing changes.
        const home = (await block(page, MON, "AM").boundingBox())!;
        await page.mouse.move(home.x + 40, home.y + 20, { steps: 8 });
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await page.waitForTimeout(400);
        await page.locator(".undo-toast").getByRole("button", { name: "Dismiss" }).click().catch(() => undefined);

        // The panel on an empty block.
        await block(page, TUE, "PM").locator(".card-when").click();
        await panel(page).getByText("Nothing here yet.").waitFor();
        await page.waitForTimeout(500);
        await shot("week-panel-empty");
        await page.keyboard.press("Escape");
        await panel(page).waitFor({ state: "detached" });

        // The block's ⋯ menu.
        await block(page, MON, "PM").click({ button: "right", position: { x: 60, y: 14 } });
        await page.locator(".popup-menu").last().waitFor();
        await page.waitForTimeout(200);
        await shot("block-menu");
        await page.keyboard.press("Escape");

        // Day today: cards with the panel, then the timeline with the panel.
        await go(page, `#/day/${MON}/PM`);
        await panel(page).locator(".aw-features").waitFor();
        await page.waitForTimeout(500);
        await shot("day-today-cards-panel");
        await page.locator(".day-switch").getByRole("button", { name: "Timeline" }).click();
        await page.locator(".today-tl .tt-block").first().waitFor();
        await page.waitForTimeout(500);
        await shot("day-today-timeline-panel");
        await page.locator(".day-switch").getByRole("button", { name: "Cards" }).click();
        await panel(page).getByRole("button", { name: /Close/ }).first().click();
        await panel(page).waitFor({ state: "detached" });
        await page.waitForTimeout(300);
        await shot("day-today-cards");

        // A day ahead.
        await go(page, `#/day/${TUE}`);
        await page.locator(`.day-view [data-drop="${TUE}:AM"]`).waitFor();
        await page.waitForTimeout(400);
        await shot("day-ahead");
        await page.close();
      }, T);
    }

  it("the phone, 390x844", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    for (const theme of THEMES) {
      await themed(page, theme);
      await go(page, "#/day");
      await page.locator(".ph-todos").waitFor();
      await page.screenshot({ path: `${DIR}/phone-day-390x844-${theme}.png` });
      await page.locator(".ph-todos .ph-add").last().click();
      await panel(page).locator(".aw-features").waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${DIR}/phone-sheet-390x844-${theme}.png` });
      await panel(page).getByRole("button", { name: /Close/ }).first().click();
      await panel(page).waitFor({ state: "detached" });
    }
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM || !DIR)("WD-2 screenshots: a past day (demo on Tuesday)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-03T09:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  for (const size of SIZES)
    for (const theme of THEMES)
      it(`Day on a past day, ${size.width}x${size.height}-${theme}`, async () => {
        const { page } = await freshPage(h, size);
        await themed(page, theme);
        await go(page, `#/day/${MON}`);
        const card = page.locator(".day-view .half.card", { has: page.locator(".checklist li") }).first();
        await card.locator(".card-when").click();
        await panel(page).locator(".bp-past").waitFor();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${DIR}/day-past-${size.width}x${size.height}-${theme}.png` });
        await page.close();
      }, T);
});
