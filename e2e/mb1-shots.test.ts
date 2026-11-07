// MB-1: screenshots of the phone (390 and 360 px, 17 px root font as on an iPhone) and the desktop (1920), in demo
// mode, only when FOCUSTIME_SHOTS names a folder. MB1_TAG (before or after) prefixes each file, so the same run on
// main and on the branch gives the before and after sets in docs/ux/mb1/. Today's Now card in each state needs its own
// clock: before the day (8:00), in a block (9:30), in a meeting (11:15), between blocks (12:15, with Monday's hours
// split 9:00 to 12:00 and 1:00 to 5:00) and after the day (5:30 PM).
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { call, phonePage, planMonday } from "./mb1-helpers.ts";
import { SHOTS } from "./shots.ts";

const T = 600_000;
const TAG = process.env.MB1_TAG ?? "after";
const MON = "2026-11-02";
const PHONES = [390, 360] as const;

async function at(page: Page, hash: string): Promise<void> {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".topbar");
  await page.waitForTimeout(900);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${TAG}-${name}.png`, fullPage: true });

const STATES = [
  ["before-day", "08:00"],
  ["block", "09:30"],
  ["meeting", "11:15"],
  ["between", "12:15"],
  ["after-day", "17:30"],
] as const;

describe.skipIf(!CHROMIUM || !SHOTS)("MB-1 screenshots", () => {
  const hs: Harness[] = [];
  afterAll(async () => Promise.all(hs.map((h) => h.stop())));

  for (const [state, clock] of STATES)
    it(`Today on the phone: ${state}`, async () => {
      const h = await startDemo("chromium", {}, `${MON}T${clock}:00-05:00`);
      hs.push(h);
      for (const w of PHONES) {
        const page = await phonePage(h, w);
        if (state === "between") await call(page, "hours.set_day", { date: MON, segments: ["09:00-12:00", "13:00-17:00"] });
        await planMonday(page);
        await at(page, "#/today");
        await shot(page, `phone${w}-today-${state}`);
        await page.close();
      }
    }, T);

  it("the other phone screens and the desktop", async () => {
    const h = await startDemo("chromium");
    hs.push(h);
    for (const w of PHONES) {
      const page = await phonePage(h, w);
      await planMonday(page);
      await at(page, "#/week");
      await shot(page, `phone${w}-week-board`);
      // UI-9's late chip on the chips line of the phone card (Mon AM has the Cooptimize promise I added, late).
      const late = page.locator('main.grid .half[aria-label^="Mon Nov 2 AM,"]');
      if (await late.locator(".late-chip").count()) await late.screenshot({ path: `${SHOTS}/${TAG}-phone${w}-week-late-chip.png` });
      const cardFold = page.locator(".card-agenda-fold").first();
      if (await cardFold.count()) {
        await cardFold.click();
        await page.waitForTimeout(300);
        await shot(page, `phone${w}-week-board-agenda-open`);
      }
      await at(page, `#/week/day/${MON}`);
      await shot(page, `phone${w}-week-day`);
      const fold = page.locator(".pd2-fold").first();
      if (await fold.count()) {
        await fold.click().catch(() => undefined);
        await page.waitForTimeout(300);
        await shot(page, `phone${w}-week-day-agenda-toggled`);
      }
      await at(page, "#/week/commit");
      await shot(page, `phone${w}-week-plan`);
      await at(page, "#/inbox/needs-you");
      await shot(page, `phone${w}-inbox`);
      await at(page, "#/ahead");
      await shot(page, `phone${w}-ahead`);
      await at(page, "#/today");
      const row = page.locator(".ph-todo-main").first();
      if (await row.count()) {
        await row.click({ position: { x: 60, y: 10 } }).catch(() => undefined);
        await page.waitForTimeout(400);
        await shot(page, `phone${w}-today-row-tapped`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }
      // The largest Text size (and a 21 px root font), Today and the Week.
      for (const [name, hash] of [["today", "#/today"], ["week-board", "#/week"]] as const) {
        await at(page, hash);
        await page.evaluate(() => {
          document.documentElement.setAttribute("data-text-size", "larger");
          const st = document.createElement("style");
          st.textContent = "html{font-size:21px}";
          document.head.append(st);
        });
        await page.waitForTimeout(300);
        await shot(page, `phone${w}-${name}-larger`);
      }
      await at(page, "#/today");
      const dot = page.locator(".status-dot-btn");
      if (await dot.count()) {
        await dot.click();
        await page.waitForTimeout(300);
        await shot(page, `phone${w}-status-sheet`);
        await page.keyboard.press("Escape");
      }
      // The Guide's new phone text: Settings, phone and keys, at "On your phone".
      await at(page, "#/guide/settings");
      const ph = page.getByText("On your phone", { exact: true }).first();
      if (await ph.count()) await ph.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${TAG}-phone${w}-guide-phone.png` });
      await page.close();
    }
    const { page } = await freshPage(h);
    await planMonday(page);
    for (const [name, hash] of [["today", "#/today"], ["week", "#/week"], ["inbox", "#/inbox/needs-you"], ["ahead", "#/ahead"]] as const) {
      await at(page, hash);
      await page.screenshot({ path: `${SHOTS}/${TAG}-desktop-${name}.png` });
    }
    await page.close();
  }, T);
});
