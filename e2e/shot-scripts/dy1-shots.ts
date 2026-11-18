// DY-1: the before and after screenshots, one script for both (before: FOCUSTIME_E2E_DIST names the base commit's build).
// Only when DY1_SHOTS names a folder; nothing runs otherwise. Demo data only, at 1440x900 and 1280x720, dark, and the
// Timeline in light. Clock: Mon Nov 2, 2026 3:55 PM ET, the afternoon block under way and the morning ended.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.DY1_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}
async function day(page: Page, hash = "#/day") {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.locator(".day-view .card-client").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
}

describe.skipIf(!CHROMIUM || !DIR)("DY-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-02T15:55:00-05:00");
  }, 120_000);
  afterAll(async () => {
    await h?.stop();
    if (missed.length) console.log(`DY-1 shots missed:\n${missed.join("\n")}`);
  });

  it("takes them", async () => {
    for (const [w, ht] of [[1440, 900], [1280, 720]] as const) {
      const { page } = await freshPage(h, { width: w, height: ht });
      await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Tidy the release notes", size: "S" }).then((a) => call(page, "pick.mark_done", { id: a.data.pick.id, done: true }));
      await call(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Answer the sizing question", size: "S" });
      const s = `${w}x${ht}`;
      // Arrival in the afternoon, Timeline and Cards.
      await call(page, "ui.set_today_timeline", { show: true });
      await shot(page, `${s}/1-timeline-arrival`, () => day(page));
      await call(page, "ui.set_today_timeline", { show: false });
      await shot(page, `${s}/2-cards-arrival`, () => day(page));
      // A folded and an unfolded block (Timeline): the morning opened by hand.
      await call(page, "ui.set_today_timeline", { show: true });
      await shot(page, `${s}/3-timeline-unfolded`, async () => {
        await day(page);
        const arrow = page.locator('.day-view [data-half="AM"] .day-fold-arrow');
        if (await arrow.count()) await arrow.click();
        await page.locator("main.day-view").evaluate((m) => (m.scrollTop = 0));
      });
      // The page scrolled with both headers: halfway through the morning's hours.
      await shot(page, `${s}/4-timeline-scrolled`, async () => {
        await page.locator('.day-view [data-half="AM"], .day-view article.tt-block').first().evaluate((el) => {
          const m = el.closest("main")!;
          m.scrollTop += el.getBoundingClientRect().top - m.getBoundingClientRect().top + 160;
        });
      });
      await page.evaluate(() => localStorage.removeItem("focustime.dayFolds"));
      // The menu with the option.
      await shot(page, `${s}/5-menu`, async () => {
        await day(page);
        await page.getByRole("button", { name: "View options for Day" }).click();
      });
      await page.keyboard.press("Escape");
      // A repeating meeting and a registered call on the Timeline (the afternoon's hours) and on Week.
      await shot(page, `${s}/6-timeline-marks`, async () => {
        await call(page, "ui.set_day_fold", { on: false });
        await day(page);
        await page.locator(".day-view .event", { hasText: "Team standup" }).first().evaluate((el) => {
          const m = el.closest("main")!;
          m.scrollTop += el.getBoundingClientRect().top - m.getBoundingClientRect().top - 140;
        });
      });
      await shot(page, `${s}/7-timeline-call`, async () => {
        await page.locator(".day-view .event", { hasText: "Northwind weekly status" }).first().evaluate((el) => {
          const m = el.closest("main")!;
          m.scrollTop += el.getBoundingClientRect().top - m.getBoundingClientRect().top - 160;
        });
      });
      await call(page, "ui.set_day_fold", { on: true });
      await call(page, "ui.set_show_timelines", { show: true });
      await shot(page, `${s}/8-week`, async () => {
        await page.evaluate(() => (location.hash = "#/week"));
        await page.reload();
        await page.locator("main.grid .card-client").first().waitFor({ timeout: 30_000 });
      });
      // The block panel's agenda on Week: the call with its type, the repeating meetings with the mark.
      await shot(page, `${s}/9-week-panel-agenda`, async () => {
        await page.evaluate(() => (location.hash = "#/week/day/2026-11-02/PM"));
        await page.locator("aside.block-panel .bp-meet-line").click({ timeout: 30_000 });
      });
      await call(page, "ui.set_show_timelines", { show: false });
      // The Timeline in light.
      await call(page, "ui.set_theme", { theme: "cooptimize-light" });
      await shot(page, `${s}/10-timeline-light`, () => day(page));
      await call(page, "ui.set_theme", { theme: "cooptimize-dark" });
      await page.close();
    }
  }, T);
});
