// MC-1d: a registered client call opens from its meeting. The demo's Northwind weekly status call is the calendar's
// Monday 13:00 meeting: on Day's Timeline and Cards, in the block panel's agenda and on the phone it carries one short
// mark with its state; the mark and the title open the call; its menu leads with the call (Review proposals, Read the
// transcript, Propose again, Upload a transcript) and Open in Outlook comes after. A meeting that isn't a registered
// call is unchanged: no mark, no call items. More has Calls with its count (MC-2: called Client calls before). Clock: Mon Nov 2, 2026 3:00 PM ET,
// after the call (the demo seeds the latest call that has ended).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 120_000;
const MON = "#/today";

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>;
const open = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
};
const menuLabels = (page: Page) => page.locator(".popup-menu [role=menuitem]").allTextContents();

describe.skipIf(!CHROMIUM)("a client call opens from its meeting (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-02T15:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Day's Timeline: the mark and the title open the call; the menu leads with the call; other meetings are unchanged", async () => {
    const { page, errors } = await freshPage(h);
    await call(page, "ui.set_today_timeline", { show: true });
    await open(page, MON);
    const ev = page.locator(".today-tl .event.is-call");
    await ev.waitFor({ timeout: 30_000 });
    if (process.env.FOCUSTIME_SHOTS) await ev.screenshot({ path: `${process.env.FOCUSTIME_SHOTS}/door-event.png` });
    await expect(page.locator(".today-tl .event.is-call").count()).resolves.toBe(1);
    const mark = ev.locator(".ev-call");
    // DY-1: the mark names the call's type, then its state.
    await expect(mark.textContent()).resolves.toBe("Weekly status callReview 11 proposals");
    await expect(mark.locator(".call-what").textContent()).resolves.toBe("Review 11 proposals");
    await expect(mark.getAttribute("aria-label")).resolves.toBe("Weekly status call, Northwind weekly status call: Review 11 proposals. Review proposals");
    await mark.click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor();
    // MC-1e: Back returns to Day, where the call was opened from.
    await page.locator(".mtg-view").getByRole("button", { name: "Back to Day" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/day/);
    await ev.waitFor({ timeout: 30_000 });
    await ev.locator(".ev-title").click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor();
    await open(page, MON);
    // The rest of the meeting opens its menu: the call first, Open in Outlook after.
    await ev.locator(".ev-time").click();
    await page.locator(".popup-menu").waitFor();
    const labels = await menuLabels(page);
    expect(labels.slice(0, 4)).toEqual(["Review proposals", "Read the transcript", "Propose again", "Upload a transcriptin place of this one"]);
    expect(labels.findIndex((l) => l.startsWith("Open in Outlook"))).toBeGreaterThan(3);
    await page.keyboard.press("Escape");
    // A meeting that isn't a registered call: no mark, no call items.
    const other = page.locator(".today-tl .event", { hasText: "Northwind data model review" });
    await expect(other.locator(".ev-call").count()).resolves.toBe(0);
    await other.locator(".ev-time").click();
    await page.locator(".popup-menu").waitFor();
    expect((await menuLabels(page)).some((l) => /Review proposals|Read the transcript|Propose again/.test(l))).toBe(false);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day's Cards and the block panel: one mark for the call, opening it", async () => {
    const { page, errors } = await freshPage(h);
    await call(page, "ui.set_today_timeline", { show: false });
    await open(page, MON);
    const card = page.locator('.day-view [data-drop="2026-11-02:PM"]');
    await card.waitFor({ timeout: 30_000 });
    // Folded list: the card's line carries the call.
    await expect(card.locator(".call-mark").count()).resolves.toBe(1);
    await card.locator(".card-agenda-fold").click();
    const row = card.locator(".card-events li", { hasText: "Northwind weekly status" });
    await row.waitFor();
    // Open list: the meeting itself carries the mark, once.
    await expect(card.locator(".call-mark").count()).resolves.toBe(1);
    await expect(row.locator(".ev-call .call-what").textContent()).resolves.toBe("Review 11 proposals");
    await expect(card.locator(".card-events li", { hasText: "Northwind data model review" }).locator(".ev-call").count()).resolves.toBe(0);
    // The block panel's agenda.
    await card.locator(".card-when").click();
    const panel = page.locator("aside.block-panel");
    await panel.locator(".bp-meet-line").click();
    const agRow = panel.locator(".bp-meetings li", { hasText: "Northwind weekly status" });
    await agRow.locator(".ev-call").click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the phone (Week): the mark on the card's list opens the call; More has Calls with its count", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await open(page, "#/week");
    // The phone's Week: the call's card carries its line until the meetings list opens, then the meeting carries it.
    const marked = page.locator(".half", { has: page.locator(".card-calls .call-mark") }).first();
    await marked.waitFor({ timeout: 30_000 });
    const card = page.locator(`[data-drop="${await marked.getAttribute("data-drop")}"]`);
    await card.locator(".card-agenda-fold").click();
    const mark = card.locator(".card-events li", { hasText: "Northwind weekly status" }).locator(".ev-call");
    await expect(mark.locator(".call-what").textContent()).resolves.toBe("Review 11 proposals");
    await mark.click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor();
    await open(page, "#/today");
    // PH-1: More is a screen; Calls (MC-2: was Client calls) is a row with how many calls are there to review.
    await page.locator(".bottom-bar").getByRole("button", { name: /^More/ }).click();
    const item = page.locator('.mr-row[data-row="calls"]');
    await expect(item.textContent()).resolves.toContain("1 call to review");
    await item.click();
    await page.getByRole("heading", { name: "Calls", exact: true }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
