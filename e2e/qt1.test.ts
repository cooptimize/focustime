// QT-1: a quieter board, on the demo at Wednesday Nov 4, 2:30 PM (Monday and Tuesday past, Wednesday's morning over).
// Week has no client chips and never says over; a block over-planned says only that it has no free time; At risk
// comes from the calendar only; a block that ended this morning takes work; past days fold to one line each and
// still open their panel.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 120_000;
const WED = "2026-11-04";
let h: Harness;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);
const block = (page: Page, date: string, half: string) => page.locator(`main.grid [data-drop="${date}:${half}"]`).first();
const panel = (page: Page) => page.locator("aside.block-panel");

describe.skipIf(!CHROMIUM)("QT-1: a quieter board (browser, demo)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-04T14:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("free time only, no chips; an ended block takes work; past days fold and still open", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // Wednesday afternoon planned well past its free time.
    for (const [title, size] of [["Draft the cutover checklist", "L"], ["Answer the pricing questions", "L"], ["Walk through the import errors", "L"]] as const) {
      const r = (await call(page, "pick.add", { date: WED, half: "PM", clientKey: "Northwind", intention: title, size })) as { ok: boolean };
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await page.waitForSelector(".topbar", { timeout: 60_000 });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".week-head").first().waitFor({ timeout: 30_000 });

    // No client chips; nothing on the grid says over, full or fits; no amber card for Watch.
    expect(await page.locator(".client-chips, .cc-chip").count()).toBe(0);
    const grid = page.locator("main.grid");
    await block(page, WED, "PM").waitFor();
    expect(await grid.innerText()).not.toMatch(/\b(over|Full|Fits|Too much planned|Room for)\b/);
    expect(await page.locator(".status-pill.too_much, .status-pill.tight, .status-pill.fits, .half.watch").count()).toBe(0);
    // Any chip left is At risk, from the calendar.
    for (const t of await grid.locator(".card-head .status-pill").allInnerTexts()) expect(t).toBe("At risk");

    // The over-planned block's panel: its hours and "No free time", never amber, never over.
    await block(page, WED, "PM").locator(".card-when").click();
    const when = panel(page).locator(".bp-when");
    await expect(when.textContent()).resolves.toMatch(/ · No free time$/);
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });

    // This morning has ended and still takes work: "+ Add", a new to-do, on its card.
    await block(page, WED, "AM").locator(".add-work.add-row").click();
    const box = panel(page).locator("input.bp-box");
    await box.waitFor();
    await box.fill("Wrote the cutover notes");
    await box.press("Enter");
    await block(page, WED, "AM").getByText("Wrote the cutover notes").waitFor({ timeout: 15_000 });
    await expect(page.locator(".undo-toast").first().textContent()).resolves.not.toMatch(/ended|Can't/);
    await page.keyboard.press("Escape");

    // Monday is past: its cards are one line each, with no status chip, and a click opens the panel to tick and move on.
    const mon = page.locator('main.grid [data-drop^="2026-11-02:"]');
    expect(await mon.count()).toBeGreaterThan(0);
    for (const c of await mon.all()) {
      expect(await c.evaluate((e) => e.classList.contains("folded"))).toBe(true);
      expect(await c.locator(".status-pill").count()).toBe(0);
      await expect(c.locator(".card-folded").textContent()).resolves.toMatch(/^(\d+ done|\d+ not done|\d+ moved on)( · .+)*$|^Nothing planned$/);
    }
    await mon.first().locator(".card-head").click();
    await panel(page).getByText(/A past day: tick what got done/).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
