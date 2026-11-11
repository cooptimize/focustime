// MB-1b: phone polish, at 390 and 360 px with the iPhone's 17 px root font, in demo mode on Mon Nov 2 2026, 9:30 AM.
// The late chip (Q-MB1-7): with Monday's hours 1:00 to 5:00, the Cooptimize morning block has nothing planned and no
// risk (no status pill) and the Northwind afternoon is at risk; each has one late promise. With no pill the chip ends
// the title line and the card is exactly as tall as with no chip; beside a pill it stays on the chips line. The status
// sheet: every line fits the screen (the DevOps line wraps), with no sideways scroll in the sheet or the page.
// With FOCUSTIME_SHOTS set (and MB1B_TAG, after by default) it also takes the cards and the sheet.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, startDemo, type Harness } from "./harness.ts";
import { call, phonePage } from "./mb1-helpers.ts";
import { SHOTS } from "./shots.ts";

const T = 240_000;
const TAG = process.env.MB1B_TAG ?? "after";
const MON = "2026-11-02";
const card = (page: Page, half: "AM" | "PM") => page.locator(`main.grid .half[aria-label^="Mon Nov 2 ${half},"]`);

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
    it(`at ${w} px: the late chip ends the title line with no status, stays on the chips line beside one; the status sheet fits`, async () => {
      const page = await phonePage(h, w);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      expect((await call(page, "hours.set_day", { date: MON, segments: ["13:00-17:00"] })).ok).toBe(true);
      await at(page, "#/week");
      const am = card(page, "AM");
      const pm = card(page, "PM");
      await expect.poll(() => am.locator(".late-chip").count()).toBe(1);
      await expect.poll(() => pm.locator(".late-chip").count()).toBe(1);

      // No status: the chip is in the title line, there is no chips line, and the card is no taller for it.
      expect(await am.locator(".status-pill").count()).toBe(0);
      expect(await am.locator(".card-head > .late-chip").count()).toBe(1);
      expect(await am.locator(".card-status").count()).toBe(0);
      const heights = await am.evaluate((e) => {
        const head = e.querySelector<HTMLElement>(".card-head")!;
        const chip = head.querySelector<HTMLElement>(".late-chip")!;
        const r = chip.getBoundingClientRect();
        const name = head.querySelector<HTMLElement>(".card-client")!.getBoundingClientRect();
        const withChip = { card: e.getBoundingClientRect().height, head: head.getBoundingClientRect().height };
        chip.style.display = "none";
        const without = { card: e.getBoundingClientRect().height, head: head.getBoundingClientRect().height };
        chip.style.display = "";
        return { withChip, without, sameLine: Math.abs(r.top + r.height / 2 - (name.top + name.height / 2)) < 3, right: r.right, cardRight: e.getBoundingClientRect().right };
      });
      expect(heights.withChip).toEqual(heights.without);
      expect(heights.sameLine).toBe(true);
      expect(heights.right).toBeLessThanOrEqual(heights.cardRight);

      // With a status chip (WD-1: in the header, never wrapping): the late chip goes on the chips line under it.
      expect(await pm.locator(".card-head .status-pill").count()).toBe(1);
      expect(await pm.locator(".card-status > .late-chip").count()).toBe(1);
      expect(await pm.locator(".card-head .late-chip").count()).toBe(0);

      // The chip in the title line still takes a 44 px tap and opens its promise.
      const chip = am.locator(".late-chip");
      await chip.scrollIntoViewIfNeeded();
      const reach = await chip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const on = (x: number, y: number) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
        let up = 0, down = 0, left = 0, right = 0;
        while (on(cx, cy - up - 1) && up < 60) up++;
        while (on(cx, cy + down + 1) && down < 60) down++;
        while (on(cx - left - 1, cy) && left < 80) left++;
        while (on(cx + right + 1, cy) && right < 80) right++;
        return { h: up + down + 1, w: left + right + 1 };
      });
      expect(reach.h).toBeGreaterThanOrEqual(44);
      expect(reach.w).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (SHOTS) {
        await am.screenshot({ path: `${SHOTS}/${TAG}-phone${w}-late-chip-no-status.png` });
        await pm.screenshot({ path: `${SHOTS}/${TAG}-phone${w}-late-chip-with-status.png` });
      }
      await chip.tap();
      await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/inbox\/item\/f\d+$/);

      // The status sheet: nothing runs past the sheet's edge, the DevOps line included, and nothing scrolls sideways.
      await at(page, "#/today");
      await page.locator(".status-dot-btn").click();
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
