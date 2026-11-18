// EV-1: the top bar's pictures for the report (demo data only), when EV1_SHOTS names a folder: the top bar at 1440 by
// 900 and at 390 by 844, once per environment in EV1_ENVS (dev, local, prod by default; FOCUSTIME_ENV on the demo
// server), each file named with EV1_TAG (before or after). Nothing otherwise.
import { afterAll, beforeAll, describe, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
const DIR = process.env.EV1_SHOTS;
const TAG = process.env.EV1_TAG ?? "after";
const ENVS = (process.env.EV1_ENVS ?? "dev,local,prod").split(",").filter(Boolean);
const SIZES = [[1440, 900], [390, 844]] as const;

describe.skipIf(!CHROMIUM || !DIR)("EV-1 screenshots", () => {
  for (const env of ENVS) {
    describe(env, () => {
      let h: Harness;
      beforeAll(async () => {
        h = await startDemo("chromium", { FOCUSTIME_ENV: env });
      }, T);
      afterAll(async () => {
        await h?.stop();
      }, T);
      for (const [w, ht] of SIZES) {
        it(`the top bar at ${w}`, async () => {
          const { page } = await freshPage(h, { width: w, height: ht });
          await page.locator(".topbar").waitFor({ timeout: 30_000 });
          await page.waitForTimeout(800);
          await page.screenshot({ path: `${DIR}/ev1-${TAG}-${env}-${w}.png`, clip: { x: 0, y: 0, width: w, height: w < 600 ? 120 : 80 } });
          await page.screenshot({ path: `${DIR}/ev1-${TAG}-${env}-${w}-page.png` });
          await page.close();
        }, T);
      }
    });
  }
});
