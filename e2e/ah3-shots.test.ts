// AH-3: the screenshots for the report (demo data only), when FOCUSTIME_SHOTS names a folder: Ahead's Grid, Gantt and
// Fix next, and Admin › People's client DevOps identities, at 1920, 1600, 1366, 970 and the phone, plus Larger text at
// 1920. Nothing otherwise.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const SIZES = [[1920, 1080], [1600, 900], [1366, 768], [970, 800], [390, 844]] as const;

async function ahead(page: Page, hash: string) {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.locator(".ahead").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
}
async function shot(page: Page, name: string, w: number) {
  if (w === 1920) await shotBoth(page, `ah3-${name}-${w}`);
  else await page.screenshot({ path: `${SHOTS}/ah3-${name}-${w}.png` });
}

describe.skipIf(!CHROMIUM || !SHOTS)("AH-3 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  for (const [w, ht] of SIZES) {
    it(`Ahead and Admin › People at ${w}`, async () => {
      const { page } = await freshPage(h, { width: w, height: ht });
      await ahead(page, "#/ahead");
      await shot(page, "grid", w);
      await ahead(page, "#/ahead/gantt");
      await shot(page, "gantt", w);
      await ahead(page, "#/ahead/fix");
      await shot(page, "fix", w);
      await page.evaluate(() => (location.hash = "#/settings/admin-people"));
      const ids = page.getByRole("region", { name: "Client DevOps identities" });
      await ids.waitFor({ timeout: 30_000 });
      await ids.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      if (w === 1920) await shotBoth(page, `ah3-identities-${w}`, ids);
      else await page.screenshot({ path: `${SHOTS}/ah3-identities-${w}.png` });
      await page.close();
    }, T);
  }
});
