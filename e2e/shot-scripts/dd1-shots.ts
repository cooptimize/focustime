// DD-1: the Dev mark's pictures for the pull request (demo data only), when DD1_SHOTS names a folder: the top bar on
// dev at 1440 and 1366 by 900 and the phone's at 390 by 844, in dark, plus 1440 in light; each file named with DD1_TAG
// (before or after). Nothing otherwise.
import { afterAll, beforeAll, describe, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
const DIR = process.env.DD1_SHOTS;
const TAG = process.env.DD1_TAG ?? "after";
const SHOTS = [[1440, 900, "dark"], [1366, 900, "dark"], [390, 844, "dark"], [1440, 900, "light"]] as const;

describe.skipIf(!CHROMIUM || !DIR)("DD-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_ENV: "dev" });
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);
  for (const [w, ht, theme] of SHOTS) {
    it(`the top bar at ${w}, ${theme}`, async () => {
      const { page } = await freshPage(h, { width: w, height: ht });
      await page.locator(".topbar .site-tag").waitFor({ timeout: 30_000 });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-light"));
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${DIR}/dd1-${TAG}-${w}-${theme}.png`, clip: { x: 0, y: 0, width: w, height: w < 600 ? 120 : 64 } });
      await page.close();
    }, T);
  }
});
