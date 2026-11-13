// RS-2 part C in a real browser, on the demo (Tuesday Nov 3, 9:30 AM), with the week read (week.load) held by the
// test: the header names the week or day asked for within 150 ms of the press, the old blocks dim and the screen is
// marked busy with one "Loading…"; three presses in a row end three weeks on, and an answer for a week no longer wanted
// never paints; a failed read says "This week didn't load" (or "This day didn't load") with Retry, the address shows
// what was asked for, and Back works.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page, Route } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { PS_CLOCK } from "./ps1-states.ts";

const T = 240_000;

/** Holds every week.load the page sends until the test lets it go; `fail` answers it with a server error instead. */
async function holdReads(page: Page) {
  const held: { week: string | null; route: Route }[] = [];
  let fail = false;
  await page.route("**/api/action", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"week.load"')) return route.fallback();
    if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unavailable" }) });
    held.push({ week: /"weekStart":"([\d-]+)"/.exec(body)?.[1] ?? null, route });
  });
  return {
    held,
    failNext: () => void (fail = true),
    passAll: () => void (fail = false),
    release: async (week: string) => {
      for (const h of held.filter((x) => x.week === week)) await h.route.fallback();
      held.splice(0, held.length, ...held.filter((x) => x.week !== week));
    },
    releaseAll: async () => {
      for (const h of held.splice(0)) await h.route.fallback();
    },
  };
}

/** Milliseconds from the press of `button` to `text` showing in the header (`head`), measured in the page. */
async function pressToHeader(page: Page, button: string, head: string, text: string): Promise<number> {
  await page.evaluate(([button, head, text]) => {
    const w = window as unknown as { rs2: { pressed: number; shown: number } };
    w.rs2 = { pressed: 0, shown: 0 };
    document.querySelector<HTMLElement>(button)!.addEventListener("click", () => (w.rs2.pressed = performance.now()), { capture: true, once: true });
    const check = () => {
      if (!w.rs2.shown && w.rs2.pressed && (document.querySelector(head)?.textContent ?? "").includes(text)) w.rs2.shown = performance.now();
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, [button, head, text] as const);
  await page.locator(button).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { rs2: { shown: number } }).rs2.shown), { timeout: 5000 }).toBeGreaterThan(0);
  return page.evaluate(() => {
    const r = (window as unknown as { rs2: { pressed: number; shown: number } }).rs2;
    return r.shown - r.pressed;
  });
}
const busy = (page: Page, sel: string) => page.locator(sel).first().getAttribute("aria-busy");
const header = (page: Page) => page.locator(".week-head h2").innerText();
/** The dates Week's grid draws (its blocks' drop targets). */
const gridDates = (page: Page) => page.locator("main [data-drop]").evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute("data-drop") ?? "").split(":")[0]!))]);

describe.skipIf(!CHROMIUM)("RS-2: changing week or day answers at once (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  it("Week: the header within 150 ms, busy and dimmed with one Loading…; three presses end three weeks on; an old answer never paints", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator("main .half.card").first().waitFor({ timeout: 30_000 });
    expect(await header(page)).toContain("Nov 2");
    const reads = await holdReads(page);
    const ms = await pressToHeader(page, '.week-head button[aria-label="Next week"]', ".week-head h2", "Nov 9");
    expect(ms).toBeLessThan(150);
    await expect.poll(() => busy(page, ".wd1-body")).toBe("true");
    await expect(page.locator(".wd1-body").evaluate((e) => getComputedStyle(e).opacity)).resolves.toBe("0.45");
    expect(await page.locator(".week-head .read-line").allInnerTexts()).toEqual(["Loading…"]);
    expect(await page.getByText("Loading…", { exact: true }).count()).toBe(1);
    // Two more presses while the first read is held: the header follows each, and ends three weeks on.
    await page.locator('.week-head button[aria-label="Next week"]').click();
    await page.locator('.week-head button[aria-label="Next week"]').click();
    await expect.poll(() => header(page)).toContain("Nov 23");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/week/2026-11-23");
    await expect.poll(() => reads.held.map((x) => x.week)).toContain("2026-11-23");
    // The last answer first, then the older ones: they never paint over it.
    await reads.release("2026-11-23");
    await expect.poll(() => gridDates(page)).toContain("2026-11-23");
    await expect.poll(() => busy(page, ".wd1-body")).toBe("false");
    await reads.releaseAll();
    await page.waitForTimeout(1500);
    expect(await gridDates(page)).toContain("2026-11-23");
    expect(await gridDates(page)).not.toContain("2026-11-09");
    expect(await header(page)).toContain("Nov 23");
    expect(await page.locator(".week-head .read-line").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Week: a failed read says so with Retry; the address is the week asked for; Back works; Retry loads it", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator("main .half.card").first().waitFor({ timeout: 30_000 });
    const reads = await holdReads(page);
    reads.failNext();
    await page.locator('.week-head button[aria-label="Next week"]').click();
    const line = page.locator(".week-head .read-line.failed");
    await line.waitFor({ timeout: 10_000 });
    expect(await line.innerText()).toContain("This week didn't load");
    expect(await header(page)).toContain("Nov 9");
    expect(await page.evaluate(() => location.hash)).toBe("#/week/2026-11-09");
    // Back: the week on screen again, nothing dimmed.
    await page.goBack();
    await expect.poll(() => header(page)).toContain("Nov 2");
    await expect.poll(() => page.locator(".week-head .read-line").count()).toBe(0);
    // Forward, then Retry once the server answers.
    await page.goForward();
    await line.waitFor({ timeout: 10_000 });
    reads.passAll();
    await line.getByRole("button", { name: "Retry" }).click();
    await reads.releaseAll();
    await expect.poll(() => gridDates(page), { timeout: 15_000 }).toContain("2026-11-09");
    await expect.poll(() => page.locator(".week-head .read-line").count()).toBe(0);
    // Pressed again later the read is held by the test, so let anything left go.
    await reads.releaseAll();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Day: the next week's Monday shows in the header within 150 ms, busy; a failed read says so with Retry", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/day/2026-11-06"));
    await page.locator(".day-view .day-bar h1").filter({ hasText: "Fri, Nov 6" }).waitFor({ timeout: 30_000 });
    const cardsButton = page.locator(".day-switch button", { hasText: "Cards" }).first();
    if ((await cardsButton.getAttribute("aria-pressed")) !== "true") await cardsButton.click();
    const reads = await holdReads(page);
    const ms = await pressToHeader(page, '.day-bar button[aria-label="Next day"]', ".day-bar h1", "Nov 9");
    expect(ms).toBeLessThan(150);
    await expect.poll(() => busy(page, "main.day-view")).toBe("true");
    expect(await page.locator(".day-bar .read-line").allInnerTexts()).toEqual(["Loading…"]);
    await reads.releaseAll();
    await expect.poll(() => busy(page, "main.day-view")).toBe("false");
    // The demo's Nov 9 is a holiday: Day draws the asked day, not the Friday it came from.
    await expect.poll(() => page.locator("main.day-view").innerText()).toContain("You're off Monday");
    expect(await page.locator(".day-view [data-drop^='2026-11-06:']").count()).toBe(0);
    // A failed read on the next press.
    reads.failNext();
    await page.locator('.day-bar button[aria-label="Previous day"]').click();
    await page.locator('.day-bar button[aria-label="Previous day"]').click();
    const line = page.locator(".day-bar .read-line.failed");
    await line.waitFor({ timeout: 10_000 });
    expect(await line.innerText()).toContain("This day didn't load");
    reads.passAll();
    await line.getByRole("button", { name: "Retry" }).click();
    await reads.releaseAll();
    await expect.poll(() => page.locator(".day-bar .read-line").count(), { timeout: 15_000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
