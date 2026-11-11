// U5.1: Week's all-day chips, the Timelines switch and the Personal events switch (browser, demo mode, clock pinned to
// Mon Nov 2, 9:30 AM). Behavior only: a three-day all-day event is a chip on each weekday it covers and never a line
// in the PTO or Catch-up cell; V cycles the hours the rails show and Week's ⋯ says which; G hides personal events on
// Week and Today, the status bar counts them, risk reasons still name them, and the choice survives a restart.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, timelineOn, sameSession, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const MON = "2026-11-02";
const SUMMIT = "Fabrikam partner summit 2026"; // demo: all day, Wed Nov 4 to Fri Nov 6
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(1000);
};
const day = (page: Page, i: number) => page.locator("section.day").nth(i);
const press = async (page: Page, key: string) => {
  await page.locator("body").click({ position: { x: 5, y: 600 } });
  await page.keyboard.press(key);
};

describe.skipIf(!CHROMIUM)("Week's all-day chips and view switches (U5.1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a three-day all-day event is one chip on each weekday it covers, PTO and Catch-up days too, and no text line in those cells", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, `#/week/${MON}`);
    await page.locator(".half.card").first().waitFor();
    for (const [i, n] of [[0, 0], [1, 0], [2, 1], [3, 1], [4, 1]] as const) await expect(day(page, i).locator(".day-allday .chip", { hasText: SUMMIT }).count(), `day ${i}`).resolves.toBe(n);
    // Same style on every day it covers.
    const styles = await page.locator(".day-allday .chip", { hasText: SUMMIT }).evaluateAll((els) => els.map((e) => `${e.className} ${getComputedStyle(e).fontSize} ${getComputedStyle(e).backgroundColor}`));
    expect(new Set(styles).size).toBe(1);
    await expect(page.locator(".day-allday .chip", { hasText: SUMMIT }).first().getAttribute("title")).resolves.toContain(SUMMIT);
    // Thursday (PTO) and Friday (Catch-up): no all-day line in the cell; Friday's timed meeting stays a line.
    await expect(page.locator(".half.whole .whole-lines", { hasText: SUMMIT }).count()).resolves.toBe(0);
    await expect(page.locator(".half.whole.catchup .whole-lines li", { hasText: "Cooptimize all hands" }).count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("V cycles the Timelines range, the rail follows it, and Week's ⋯ shows which; Settings › Display holds the default", async () => {
    const { page, errors } = await freshPage(h);
    await timelineOn(page);
    await go(page, `#/week/${MON}`);
    await page.locator(".half.card .ruler").first().waitFor();
    const marks = () => page.locator(".half.card .ruler").first().locator(".r-hour").count();
    const checked = async () => {
      await page.getByRole("button", { name: "View options for Week" }).click();
      const t = (await page.locator(".popup-menu .menu-item.checked").allTextContents()).join("|");
      await page.keyboard.press("Escape");
      return t;
    };
    expect(await checked()).toContain("Business hours");
    const before = await marks();
    await press(page, "v");
    await expect.poll(checked).toContain("12 hours");
    await expect.poll(marks).toBeGreaterThan(before);
    await press(page, "v");
    await expect.poll(checked).toContain("24 hours");
    await press(page, "v");
    await expect.poll(checked).toContain("Business hours");
    await go(page, "#/settings/display");
    await expect(page.locator("fieldset", { hasText: "Timelines" }).getByRole("radio", { name: "Business hours" }).isChecked()).resolves.toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("G hides personal events on Week and Today; the status bar counts them; risk reasons still name them; it survives a restart", async () => {
    const { page, errors } = await freshPage(h);
    await timelineOn(page);
    await go(page, `#/week/${MON}`);
    await page.locator(".half.card .ruler").first().waitFor();
    expect(await page.locator(".ruler .r-ev.personal").count()).toBeGreaterThan(0);
    await press(page, "g");
    await expect.poll(() => page.locator(".ruler .r-ev.personal").count()).toBe(0);
    await expect(page.locator("footer.statusbar .status-chip.personal-hidden").textContent()).resolves.toMatch(/^\d+ personal hidden$/);
    // Hidden, still counted: Monday's risk still names the Dentist.
    await expect(page.locator('.half.card .status-pill[title*="Dentist"]').count()).resolves.toBeGreaterThan(0);
    // Today: no Dentist row, the risk still says so.
    await go(page, "#/today");
    await page.locator(".day-view .half.card").first().waitFor();
    await expect(page.locator(".today-rows li", { hasText: "Dentist" }).count()).resolves.toBe(0);
    await expect(page.locator(".day-view .half.card .status-pill", { hasText: "Dentist" }).count()).resolves.toBeGreaterThan(0);
    await expect(page.locator("footer.statusbar .status-chip.personal-hidden").textContent()).resolves.toBe("1 personal hidden");
    // Today's ⋯ has the switch, checked off.
    await page.getByRole("button", { name: "View options for Today" }).click();
    await expect(page.locator(".popup-menu .menu-item", { hasText: "Personal events" }).getAttribute("class")).resolves.not.toContain("checked");
    await page.keyboard.press("Escape");
    // A restart: a new window reads it from config.
    const ctx = await sameSession(h, page);
    const fresh = await ctx.newPage();
    await fresh.goto(h.url);
    await fresh.waitForSelector(".topbar", { timeout: 60_000 });
    await fresh.evaluate((x) => (location.hash = x), `#/week/${MON}`);
    await fresh.locator(".half.card .ruler").first().waitFor();
    await expect.poll(() => fresh.locator("footer.statusbar .status-chip.personal-hidden").count()).toBe(1);
    expect(await fresh.locator(".ruler .r-ev.personal").count()).toBe(0);
    await ctx.close();
    // G again shows them; the config says so too.
    await go(page, `#/week/${MON}`);
    await press(page, "g");
    await expect.poll(() => page.locator(".ruler .r-ev.personal").count()).toBeGreaterThan(0);
    await expect(page.locator(".status-chip.personal-hidden").count()).resolves.toBe(0);
    expect((await call(page, "week.load", { weekStart: MON })).data.ui.showPersonal).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
