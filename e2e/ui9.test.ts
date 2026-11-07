// UI-9: the "N late" chip on Week's cards when the timeline is hidden, in demo mode with the clock on Mon Nov 2 2026,
// 9:30 AM (the harness's). The demo has two late promises: one to Northwind from a chat (on Northwind's block today,
// Mon PM) and one I added for Cooptimize (on Mon AM, its due badge folded into the chip). Shown, the rail marks them
// and there is no chip. One opens that promise; several open Promises, late ones, for the card's client. Keeping or
// snoozing one updates the chip with no reload. On the phone (no rail) the chip sits in the card header: the card is
// no taller, the tap target is 44 px, and the page doesn't scroll sideways.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 240_000;
// By label: the phone's cards are no drop targets, so they have no data-drop.
const MON_AM = '.half[aria-label^="Mon Nov 2 AM,"]';
const MON_PM = '.half[aria-label^="Mon Nov 2 PM,"]';
const TUE_AM = '.half[aria-label^="Tue Nov 3 AM,"]';

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Week's Board, reloaded so what the test set through the API is what the page shows. */
async function board(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = "#/week"));
  await page.reload();
  await page.locator(`main.grid ${MON_AM}`).waitFor();
}
const chip = (page: Page, card: string): Locator => page.locator(`main.grid ${card} .late-chip`);
const chipText = (page: Page, card: string) => chip(page, card).count().then((n) => (n ? chip(page, card).textContent() : null));
const allChips = (page: Page) => page.locator("main.grid .late-chip").count();
/** A mark on window that a reload would wipe. */
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { ui9: number }).ui9 = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { ui9?: number }).ui9 === 1);
const lateFor = (page: Page, list: { clientKey: string; what: string; due: string }[]) =>
  Promise.all(list.map(async (f) => expect((await call(page, "followup.add", { ...f, channel: "teams" })).ok).toBe(true)));

describe.skipIf(!CHROMIUM)("UI-9: the late chip on Week's cards", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium");
  }, T);
  afterAll(async () => h?.stop());

  it("hidden: no chip, 1 late and 3 late by the rail's placement and the card's client; shown: none", async () => {
    const { page, errors } = await freshPage(h);
    await board(page);
    // Shown: the rail marks them (both carried to the block under way, Mon AM); no chip anywhere.
    await expect.poll(() => page.locator(`main.grid ${MON_AM} .r-promise.overdue`).count()).toBe(2);
    expect(await allChips(page)).toBe(0);
    await shotBoth(page, "week-timeline-shown");

    await page.locator(".week-head .tl-toggle").click();
    await expect.poll(() => allChips(page)).toBe(2);
    expect(await chipText(page, MON_AM)).toBe("1 late");
    expect(await chipText(page, MON_PM)).toBe("1 late");
    expect(await chip(page, MON_PM).getAttribute("aria-label")).toBe("1 late promise");
    // Cooptimize's overdue due badge is the chip now (shown once).
    expect(await page.locator(`main.grid ${MON_AM} .due-badge`).count()).toBe(0);
    // A card with no late promises has no chip.
    expect(await chipText(page, TUE_AM)).toBeNull();

    // Two more late ones for Northwind and one for Atlas (no block today: counted on no card, never on Northwind's).
    await lateFor(page, [{ clientKey: "Northwind", what: "Send the cutover notes", due: "2026-10-30" }, { clientKey: "Northwind", what: "Answer the pump question", due: "2026-10-29" }, { clientKey: "Atlas", what: "Share the test plan", due: "2026-10-30" }]);
    await board(page);
    await expect.poll(() => chipText(page, MON_PM)).toBe("3 late");
    expect(await chip(page, MON_PM).getAttribute("aria-label")).toBe("3 late promises");
    expect(await chipText(page, MON_AM)).toBe("1 late");
    expect(await allChips(page)).toBe(2);
    await shotBoth(page, "week-timeline-hidden");

    // Shown again: no chip.
    await page.locator(".week-head .tl-toggle").click();
    await expect.poll(() => allChips(page)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("one opens that promise, from a tap or the keyboard; several open Promises, late ones, for the card's client", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "ui.set_show_timelines", { show: false })).ok).toBe(true);
    await lateFor(page, [{ clientKey: "Northwind", what: "Send the cutover notes", due: "2026-10-30" }, { clientKey: "Northwind", what: "Answer the pump question", due: "2026-10-29" }, { clientKey: "Harbor", what: "Share the test plan", due: "2026-10-30" }]);
    await board(page);
    await expect.poll(() => chipText(page, MON_PM)).toBe("3 late");

    // Keyboard: the selected card's chip is in the Tab order; Enter opens the one promise (and not the detail panel).
    await page.locator(`main.grid ${MON_AM}`).click({ position: { x: 14, y: 12 } });
    await page.keyboard.press("Escape");
    expect(await chip(page, MON_AM).getAttribute("tabindex")).toBe("0");
    expect(await chip(page, MON_PM).getAttribute("tabindex")).toBe("-1");
    await chip(page, MON_AM).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/inbox\/item\/f\d+$/);
    await expect.poll(() => page.locator(".ib-pane").textContent()).toContain("Cooptimize");

    // A tap with several: Promises, late ones, Northwind's only.
    await page.keyboard.press("2");
    await chip(page, MON_PM).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/inbox/promises/late/Northwind");
    const rows = page.locator(".ib-row");
    await expect.poll(() => rows.count()).toBe(3);
    const list = (await call(page, "inbox.list", {})).data.items as { key: string; clientKey: string | null; late: boolean }[];
    for (const k of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-key")))) {
      const r = list.find((x) => x.key === k)!;
      expect([r.clientKey, r.late], k!).toEqual(["Northwind", true]);
    }
    expect(await page.locator(".ib-late-line").textContent()).toContain("Late for Northwind");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox-late-northwind.png` });
    // Show all leaves the late filter (and saves nothing).
    await page.locator(".ib-late-line").getByRole("button", { name: "Show all" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/inbox/promises");
    await expect.poll(() => page.locator(".ib-late-line").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("keeping or snoozing a promise updates the chip, with no reload", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "ui.set_show_timelines", { show: false })).ok).toBe(true);
    await lateFor(page, [{ clientKey: "Northwind", what: "Send the cutover notes", due: "2026-10-30" }, { clientKey: "Northwind", what: "Answer the pump question", due: "2026-10-29" }]);
    await board(page);
    await expect.poll(() => chipText(page, MON_PM)).toBe("3 late");
    await mark(page);

    // Keep one: Done in the Inbox, then back to Week.
    await chip(page, MON_AM).click();
    const pane = page.locator(".ib-pane");
    await expect.poll(() => pane.textContent()).toContain("Cooptimize");
    // E is Done (a late promise's main action is Close the loop; Done is its key and under More).
    const key = (await page.evaluate(() => location.hash)).split("/").pop()!;
    await expect.poll(async () => {
      await page.locator("body").press("e");
      const items = (await call(page, "inbox.list", {})).data.items as { key: string; done: boolean }[];
      return !items.some((i) => i.key === key && !i.done);
    }).toBe(true);
    await page.keyboard.press("2");
    await expect.poll(() => chipText(page, MON_AM), { timeout: 20_000 }).toBeNull();
    expect(await chipText(page, MON_PM)).toBe("3 late");

    // Snooze one of Northwind's: two left.
    await chip(page, MON_PM).click();
    await expect.poll(() => page.locator(".ib-row").count()).toBe(3);
    await page.locator(".ib-row").first().click();
    await pane.getByRole("button", { name: /^More for / }).click();
    await pane.getByRole("menuitem", { name: "Snooze…" }).click();
    await pane.getByRole("form", { name: "Snooze" }).getByRole("button", { name: "Tomorrow" }).click();
    await expect.poll(() => page.locator(".ib-row:not(.ib-snoozed-group .ib-row)").count()).toBeLessThanOrEqual(3);
    await page.keyboard.press("2");
    await expect.poll(() => chipText(page, MON_PM), { timeout: 10_000 }).toBe("2 late");
    expect(await marked(page)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on the phone (390 px, 17 px root font): in the header, the card no taller, a 44 px target, no sideways scroll", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = "html{font-size:17px}";
        document.head.append(st);
      });
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    // The app is up (the opening may not have started when the sign-in page went away).
    await page.waitForSelector(".bottom-bar", { timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await board(page);
    const c = chip(page, MON_AM);
    await expect.poll(() => c.count()).toBe(1);
    expect(await c.textContent()).toBe("1 late");
    expect(await c.evaluate((e) => !!e.closest(".card-head"))).toBe(true);
    // The card with and without the chip: the same height.
    const card = page.locator(`main.grid ${MON_AM}`);
    const withChip = await card.evaluate((e) => e.getBoundingClientRect().height);
    const without = await card.evaluate((e) => {
      const b = e.querySelector<HTMLElement>(".late-chip")!;
      b.style.display = "none";
      const hgt = e.getBoundingClientRect().height;
      b.style.display = "";
      return hgt;
    });
    expect(withChip).toBe(without);
    // The tap target: how far a tap still lands on the chip, up and down and across.
    await c.scrollIntoViewIfNeeded();
    const reach = await c.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const on = (x: number, y: number) => {
        const t = document.elementFromPoint(x, y);
        return !!t && (t === el || el.contains(t));
      };
      let up = 0, down = 0, left = 0, right = 0;
      while (on(cx, cy - up - 1) && up < 60) up++;
      while (on(cx, cy + down + 1) && down < 60) down++;
      while (on(cx - left - 1, cy) && left < 80) left++;
      while (on(cx + right + 1, cy) && right < 80) right++;
      return { h: up + down + 1, w: left + right + 1 };
    });
    expect(reach.h).toBeGreaterThanOrEqual(44);
    expect(reach.w).toBeGreaterThanOrEqual(44);
    // No sideways scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/week-phone.png`, fullPage: true });
    await c.tap();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/inbox\/item\/f\d+$/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
