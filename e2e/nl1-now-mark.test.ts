// NL-1: the "now" mark only on a block that is under way. Demo mode, the clock pinned to Wednesday Nov 4 at 6:30 AM
// (before the day), 10:03 AM (the morning block), 12:30 PM exactly (the afternoon block starts) and 10:03 PM (after the
// day): Week and Day, Cards and Timeline, at 1920; then the phone's Day and Week. No mark, line, tick or row anywhere
// outside a block's hours; inside, only on that block. FOCUSTIME_SHOTS also writes docs/ux/nl1's screenshots.
import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, timelineOn, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { SHOTS } from "./shots.ts";

const T = 300_000;
const WED = "2026-11-04";
const MARK = ":is(.now-line, .now-mark, .now-tick)";

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".topbar");
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  await page.locator("[data-drop], .tt-block, .ph-now, .ph-block").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
}

/** Every block on screen that carries a now mark: Week's and Day's cards by their date and half, Day's timeline blocks by position. */
const marked = (page: Page) =>
  page.evaluate((sel) => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("[data-drop]").forEach((el) => el.querySelector(sel) && out.push(el.dataset.drop!));
    document.querySelectorAll<HTMLElement>(".tt-block").forEach((el, i) => el.querySelector(sel) && out.push(`tt:${["AM", "PM", "EVE"][i]}`));
    return [...new Set(out)];
  }, MARK);
const anywhere = (page: Page) => page.locator(`main ${MARK}, .grid ${MARK}, .today-tl ${MARK}, .now-row`).count();

const CASES = [
  { at: "06:30", label: "6:30 AM", expect: [] as string[], phone: "before" },
  { at: "10:03", label: "10:03 AM", expect: ["AM"], phone: "block" },
  { at: "12:30", label: "12:30 PM exactly", expect: ["PM"], phone: "block" },
  { at: "22:03", label: "10:03 PM", expect: [] as string[], phone: "after" },
] as const;

describe.skipIf(!CHROMIUM)("NL-1: the now mark only on a block under way", () => {
  const hs: Harness[] = [];
  afterAll(async () => {
    for (const h of hs) await h.stop();
  }, T);

  for (const c of CASES) {
    it(`at ${c.label}: Week and Day, Cards and Timeline, then the phone`, async () => {
      const h = await startDemo("chromium", {}, `${WED}T${c.at}:00-05:00`);
      hs.push(h);
      const { page, errors } = await freshPage(h);
      const cards = c.expect.map((x) => `${WED}:${x}`);
      for (const timeline of [false, true]) {
        if (timeline) await timelineOn(page);
        await go(page, "#/week");
        expect(await marked(page), `Week, ${timeline ? "Timeline" : "Cards"}`).toEqual(cards);
        if (!c.expect.length) expect(await anywhere(page)).toBe(0);
        await go(page, "#/today");
        if (timeline) {
          const sw = page.locator(".day-switch").getByRole("button", { name: "Timeline" });
          if ((await sw.getAttribute("aria-pressed")) !== "true") await sw.click();
          await page.locator(".tt-block").first().waitFor();
          await page.waitForTimeout(300);
        }
        const day = await marked(page);
        const tt = day.filter((k) => k.startsWith("tt:"));
        if (timeline) expect(tt, "Day, Timeline").toEqual(c.expect.map((x) => `tt:${x}`));
        expect(day.filter((k) => !k.startsWith("tt:")).every((k) => cards.includes(k)), `Day, ${timeline ? "Timeline" : "Cards"}: ${day.join(", ")}`).toBe(true);
        if (!timeline) expect(day, "Day, Cards").toEqual(cards);
        if (!c.expect.length) expect(await anywhere(page)).toBe(0);
      }
      expect(errors).toEqual([]);
      await page.close();

      const phone = await phonePage(h, 390);
      await go(phone, "#/today");
      // The Now card keeps its own words before and after the day; a block reads as under way only inside its hours.
      await expect(phone.locator(".ph-now").first().getAttribute("class")).resolves.toContain(`ph-now-${c.phone}`);
      expect(await phone.locator(MARK).count()).toBe(0);
      await go(phone, "#/week");
      const wk = await marked(phone);
      expect(wk.filter((k) => k.startsWith(WED))).toEqual(cards);
      await phone.close();
    }, T);
  }

  it.skipIf(!SHOTS)("screenshots for docs/ux/nl1 (dark, 1440×900)", async () => {
    for (const at of ["22:03", "10:03"]) {
      // NL1_WHEN=before takes the same pictures on main's code (the report's "before").
      const when = process.env.NL1_WHEN ?? "after";
      if (when === "before" && at === "10:03") continue;
      const h = await startDemo("chromium", {}, `${WED}T${at}:00-05:00`);
      hs.push(h);
      const { page } = await freshPage(h, { width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: "dark" });
      const tag = at === "22:03" ? "1003pm" : "1003am";
      await go(page, "#/week");
      await page.screenshot({ path: `${SHOTS}/nl1-week-${tag}-${when}-1440.png` });
      await go(page, "#/today");
      await page.screenshot({ path: `${SHOTS}/nl1-day-${tag}-${when}-1440.png` });
      await page.close();
      if (at === "22:03") {
        const phone = await phonePage(h, 390);
        await phone.emulateMedia({ colorScheme: "dark" });
        await go(phone, "#/today");
        await phone.screenshot({ path: `${SHOTS}/nl1-phone-day-1003pm-${when}-390.png`, fullPage: true });
        await phone.close();
      }
    }
  }, T);
});
