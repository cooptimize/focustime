// Scratch: a look at the new screens while building (WD2_LOOK names a folder). Removed before the pull request.
import { afterAll, beforeAll, describe, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.WD2_LOOK ?? null;
describe.skipIf(!CHROMIUM || !DIR)("WD-2 look", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, 180_000);
  afterAll(async () => h?.stop());
  it("looks", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}.png` });
    await page.keyboard.press("2");
    await page.locator(".week-head").first().waitFor();
    await page.locator('[data-drop="2026-11-02:PM"] .add-work.add-row').first().click();
    await page.locator("aside.block-panel").waitFor();
    await page.waitForTimeout(700);
    await shot("week-panel");
    await page.keyboard.type("export");
    await page.waitForTimeout(300);
    await shot("week-panel-typing");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    await shot("week-panel-added");
    await page.keyboard.press("Escape");
    await page.keyboard.press("1");
    await page.locator(".day-view").waitFor();
    await page.waitForTimeout(800);
    await shot("day-today");
    console.log("W", JSON.stringify(await page.evaluate(() => [".today-body.day-cards", "main.grid.day-only", "main.grid.day-only .day", "main.grid.day-only .half"].map((q) => { const e = document.querySelector(q) as HTMLElement | null; const c = e ? getComputedStyle(e) : null; return e ? [q, e.offsetWidth, c!.display, c!.gridTemplateColumns, c!.justifyItems, c!.justifySelf, c!.width] : [q, null]; }))));
    await page.locator('.day-view [data-drop="2026-11-02:PM"] .card-head .card-client').click();
    await page.waitForTimeout(700);
    await shot("day-panel");
    await page.keyboard.press("]");
    await page.waitForTimeout(800);
    await shot("day-tomorrow");
    console.log("ERRORS", JSON.stringify(errors));
    await page.close();
  }, 180_000);
});
