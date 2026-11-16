// Was e2e/nm1-now-mark.test.ts (NM-1) until BT-1.
// NM-1 D: a cell that isn't a block gets no now mark. Demo mode. On Friday Nov 6 at 10:30 AM the demo person's catch-up
// day has no working hours, so Week, Day and the phone draw it as one "Catch-up" cell: before, the now line ran across
// its title. And on Wednesday at 10:03 AM the block under way still carries its mark (NL-1's rule stands).
import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 300_000;
const MARK = ":is(.now-line, .now-mark, .now-tick, .now-row)";

async function go(page: Page, hash: string, wait: string): Promise<void> {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  await page.locator(wait).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
}

describe.skipIf(!CHROMIUM)("NM-1: no now mark on a cell that isn't a block", () => {
  const hs: Harness[] = [];
  afterAll(async () => {
    for (const h of hs) await h.stop();
  }, T);

  // The demo never puts a day off on today, so the other cell that isn't a block (a PTO day or a holiday) is covered by
  // plan/nowline.test.ts: both come from the same answer, nowSpot's "none" for a day drawn as one cell.
  for (const [name, date, cell] of [["a catch-up day with no working hours", "2026-11-06", ".half.whole.catchup"]] as const) {
    it(`${name}, at 10:30 AM: Week, Day and the phone draw the cell and no now mark`, async () => {
      const h = await startDemo("chromium", {}, `${date}T10:30:00-05:00`);
      hs.push(h);
      const { page, errors } = await freshPage(h);
      for (const hash of ["#/week", "#/day"]) {
        await go(page, hash, cell);
        // The cell is there, it is today's, and nothing on the screen marks now.
        expect(await page.locator(cell).count(), hash).toBeGreaterThan(0);
        expect(await page.locator(`${cell} ${MARK}`).count(), `${hash}: on the cell`).toBe(0);
        expect(await page.locator(`main ${MARK}, .grid ${MARK}`).count(), `${hash}: anywhere`).toBe(0);
      }
      expect(errors).toEqual([]);
      await page.close();
      const phone = await phonePage(h, 390);
      for (const hash of ["#/week", "#/day"]) {
        await go(phone, hash, hash === "#/week" ? cell : ".topbar, .phone-tabs, main");
        expect(await phone.locator(MARK).count(), `phone ${hash}`).toBe(0);
      }
      await phone.close();
    }, T);
  }

  // BT-1: "a block under way still has its mark, and only that block" (Wednesday 10:03, Week's cards) was removed:
  // e2e/day/now-mark.test.ts "at 10:03 AM" makes the same check on the same screen and clock (docs/ux/bt1/removed.md).
});
