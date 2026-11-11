// TD-1 (browser, demo mode, Monday Nov 2, 9:30 AM): what people read says to-do, never pick in that sense. Today, the
// Board focused on the day (Plan today), Settings › Planning and the command menu are read as text and checked with
// the words guard's own rule; the command menu finds Next to-do by "next pick". Screenshots at 1920 and at Text size
// Larger when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { saysPick } from "../scripts/words-guard.ts";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

let h: Harness;
const T = 120_000;
const TODAY = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; error?: string }>;

/** The sentences on screen that still say pick in the to-do sense (none expected). */
const pickLines = async (page: Page) => (await page.locator("body").innerText()).split("\n").filter((l) => saysPick(l));

describe.skipIf(!CHROMIUM)("TD-1 to-do, not pick (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Day, Week with Add work, Settings › Planning and the command menu say to-do; the menu still finds by pick", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "planday.start", { date: TODAY })).ok).toBe(true);
    for (const itemId of [4411, 4412]) expect((await call(page, "pick.add", { date: TODAY, half: "AM", clientKey: "Cooptimize", itemId })).ok).toBe(true);
    // Not confirmed yet: Week with Add work's own words (WD-1); then confirmed for Day.
    await page.evaluate((d) => (location.hash = `#/week/day/${d}`), TODAY);
    await page.reload();
    await page.locator("aside.add-work-panel .aw-sec").first().waitFor();
    await page.locator(".half.card li.pick-row").first().waitFor();
    expect(await pickLines(page)).toEqual([]);
    await shotBoth(page, "td1-plan-today");
    await page.evaluate(() => (location.hash = "#/today"));
    await page.reload();
    await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).waitFor();
    expect(await pickLines(page)).toEqual([]);
    await shotBoth(page, "td1-today");

    await page.evaluate(() => (location.hash = "#/settings/planning"));
    await page.getByRole("heading", { name: "To-dos" }).waitFor();
    expect(await pickLines(page)).toEqual([]);

    await page.evaluate(() => (location.hash = "#/today"));
    await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).waitFor();
    await page.keyboard.press("Control+k");
    await page.keyboard.type("next pick");
    await page.getByRole("menuitem", { name: /^Next to-do/ }).waitFor();
    await shotBoth(page, "td1-command-menu");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  }, T);
});
