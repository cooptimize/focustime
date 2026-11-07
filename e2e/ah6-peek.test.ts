import { afterAll, beforeAll, describe, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
let h: Harness;
const OUT = process.env.PEEK ?? "/tmp";
describe.skipIf(!CHROMIUM)("peek", () => {
  beforeAll(async () => { h = await startDemo(); }, 120_000);
  afterAll(async () => h?.stop());
  it("shots", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/ahead/gantt"));
    await page.locator(".pa-item").first().waitFor({ timeout: 60_000 });
    await page.locator(".ah-gantt-bar .ah-levels-more").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/menu.png` });
    console.log("ITEMS", await page.getByRole("menuitem").allTextContents());
    await page.getByRole("menuitem", { name: "Collapse all" }).click();
    await page.waitForTimeout(300);
    console.log("EXP", await page.locator(".pa-item").evaluateAll((els) => els.map((e) => e.getAttribute("aria-expanded"))));
    console.log("ERRORS", JSON.stringify(errors));
  }, 120_000);
});
