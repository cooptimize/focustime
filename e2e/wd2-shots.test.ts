// WD-2: the "before" screenshots (the two panels, the block's menu and Day as they were), on the demo (Monday Nov 2,
// 9:30 AM) at 1440x900. Only when WD2_BEFORE names a folder (docs/ux/wd2/before); nothing runs otherwise. The "after"
// screenshots are taken by e2e/wd2.test.ts with FOCUSTIME_SHOTS.
import { afterAll, beforeAll, describe, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.WD2_BEFORE ?? null;
const T = 180_000;

describe.skipIf(!CHROMIUM || !DIR)("WD-2 before screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("Week's two panels, the block menu, and Day", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}.png` });
    await page.keyboard.press("2");
    await page.locator(".week-head").first().waitFor();
    await page.locator('[data-drop="2026-11-02:PM"] .add-work.add-row').first().click();
    await page.locator("aside.add-work-panel").waitFor();
    await page.waitForTimeout(500);
    await shot("week-add-work");
    await page.keyboard.press("Escape");
    await page.locator("aside.add-work-panel").waitFor({ state: "detached" });
    await page.locator('[data-drop="2026-11-02:AM"] .card-head .card-client').first().click();
    await page.locator("aside.detail-panel").waitFor();
    await page.waitForTimeout(500);
    await shot("week-details");
    await page.keyboard.press("Escape");
    const card = page.locator('[data-drop="2026-11-02:AM"]').first();
    await card.click({ button: "right", position: { x: 40, y: 12 } });
    await page.locator('[role="menu"]').first().waitFor();
    await page.waitForTimeout(200);
    await shot("block-menu");
    await page.keyboard.press("Escape");
    await page.keyboard.press("1");
    await page.locator(".today-view").waitFor();
    await page.waitForTimeout(600);
    await shot("day-today-cards");
    await page.locator(".today-block header").first().click();
    await page.locator("aside.detail-panel").waitFor();
    await page.waitForTimeout(400);
    await shot("day-details");
    await page.keyboard.press("Escape");
    await page.keyboard.press("b");
    await page.waitForTimeout(700);
    await shot("day-today-timeline");
    await page.keyboard.press("b");
    await page.keyboard.press("]");
    await page.waitForTimeout(800);
    await shot("day-ahead");
    await page.close();
  }, T);
});
