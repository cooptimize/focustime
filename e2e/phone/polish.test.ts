// Was e2e/mb1b.test.ts (MB-1B) until BT-1.
// MB-1b: phone polish, at 390 and 360 px with the iPhone's 17 px root font, in demo mode on Mon Nov 2 2026, 9:30 AM.
// PH-2 took the phone's Week cards, so here the late chip part only checks the phone's Week has none. The late chip (Q-MB1-7): with Monday's hours 1:00 to 5:00, the Cooptimize morning block has nothing planned and no
// risk (no status pill) and the Northwind afternoon is at risk; each has one late promise. With no pill the chip ends
// the title line and the card is exactly as tall as with no chip; beside a pill it stays on the chips line. The status
// sheet: every line fits the screen (the DevOps line wraps), with no sideways scroll in the sheet or the page.
// With FOCUSTIME_SHOTS set (and MB1B_TAG, after by default) it also takes the cards and the sheet.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, startDemo, type Harness } from "../harness.ts";
import { call, phonePage } from "../mb1-helpers.ts";
import { SHOTS } from "../shots.ts";

const T = 240_000;
const TAG = process.env.MB1B_TAG ?? "after";
const MON = "2026-11-02";

async function at(page: Page, hash: string): Promise<void> {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".topbar");
}

describe.skipIf(!CHROMIUM)("MB-1b: phone polish", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium");
  }, T);
  afterAll(async () => h?.stop());

  for (const w of [390, 360] as const)
    it(`at ${w} px: the phone's Week has no late chip (PH-2: no cards); the status sheet fits`, async () => {
      const page = await phonePage(h, w);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      expect((await call(page, "hours.set_day", { date: MON, segments: ["13:00-17:00"] })).ok).toBe(true);
      // PH-2: the phone's Week has no cards (so no late chip); late promises are the Inbox's, and the week's rows
      // show only my promises due that day. The computer's cards keep the late chip.
      await at(page, "#/week");
      await page.locator(".pw-row").first().waitFor();
      expect(await page.locator(".pw .late-chip").count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      // The status sheet: nothing runs past the sheet's edge, the DevOps line included, and nothing scrolls sideways.
      await at(page, "#/today");
      // PH-1: the sources sheet is in More › Everything else › Sources.
      await page.locator(".bottom-bar").getByRole("button", { name: /^More/ }).click();
      await page.getByRole("button", { name: /Everything else/ }).click();
      await page.locator('.mr-row[data-row="sources"]').click();
      const sheet = page.locator(".ph-status");
      await sheet.waitFor();
      // HK-6: measured once the sheet has finished sliding in (its animations done), not after a set time.
      await sheet.evaluate((s) => Promise.all(s.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
      const fit = await sheet.evaluate((s) => {
        const box = s.getBoundingClientRect();
        const over = [...s.querySelectorAll<HTMLElement>(".ph-status-list li, .ph-status-list li > *")].filter((e) => e.getBoundingClientRect().right > box.right + 0.5 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
        const dv = s.querySelector<HTMLElement>(".devops .ph-src-detail")!;
        return { over, sheetScrolls: s.scrollWidth > s.clientWidth, pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth, devops: dv.textContent };
      });
      expect(fit.over).toEqual([]);
      expect(fit.sheetScrolls).toBe(false);
      expect(fit.pageScrolls).toBe(false);
      // The whole line is there (wrapped, not shortened): every client the demo has.
      expect(fit.devops).toContain("Harbor");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${TAG}-phone${w}-status-sheet.png` });
      expect(errors).toEqual([]);
      await page.close();
    }, T);
});
