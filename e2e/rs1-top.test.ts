// RS-1 (a working tool): the top bar at narrower widths, to RS1_TOP.
import { afterAll, beforeAll, describe, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
const DIR = process.env.RS1_TOP ?? null;
describe.skipIf(!CHROMIUM || !DIR)("RS-1 top bar", () => {
  let h: Harness;
  beforeAll(async () => { h = await startDemo(); }, 300_000);
  afterAll(async () => h?.stop());
  it("widths", async () => {
    for (const w of [1024, 1100, 1280, 1366, 1920]) {
      const { page } = await freshPage(h, { width: w, height: 800 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${DIR}/top-${w}.png`, clip: { x: 0, y: 0, width: w, height: 150 } });
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, top: [...document.querySelectorAll(".topbar > *")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.height)]; }) }));
      console.log(w, JSON.stringify(over));
      await page.close();
    }
  }, 300_000);
});
