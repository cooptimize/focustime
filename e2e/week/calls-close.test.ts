// MC-4: Calls you can scan, hide and close, in demo mode (a fictional person, fictional calls). The marks from the
// check; Hide in one press with Undo, a repeat's menu, Hidden with Put back; Skip all and close with Undo, the closed
// page with See what was skipped, putting one back opens it; Close out's list; from Thursday, Week's line opens Calls on
// Open; Review from the row with no setup; on the phone (390 by 844) the row's controls are at least 44 px and nothing
// is cut. Clock: Thursday Nov 5, 2026 4:30 PM ET.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 240_000;
let h: Harness;
const hash = (page: Page) => page.evaluate(() => location.hash);
const go = (page: Page, x: string) => page.evaluate((v) => (location.hash = v), x);
const item = (page: Page, name: string | RegExp) => page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: name }) }).first();
const filter = (page: Page, f: string) => page.locator(`[data-calls-filter="${f}"]`);
// MC-5: a count of zero isn't shown.
const count = async (page: Page, f: string) => Number((await filter(page, f).locator(".seg-count").allTextContents())[0] ?? 0);
const undo = (page: Page) => page.getByRole("button", { name: "Undo" }).first();

async function openCalls(page: Page) {
  await go(page, "#/calls?show=open");
  await page.locator("[data-calls-list] [data-call-row]").first().waitFor({ timeout: 30_000 });
}

describe.skipIf(!CHROMIUM)("MC-4: Calls you can scan, hide and close (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T16:30:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("the marks; Hide with Undo; a repeat hidden every one, then Put back", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page);
    // Teams said this one has a transcript; the client is FocusTime's suggestion.
    // MC-5: the mark is a word, its full words on its label and hover; the client is the picker's value.
    await expect.poll(() => item(page, "Northwind data model review").locator("[data-call-mark]").textContent(), { timeout: 30_000 }).toBe("Teams");
    await expect(item(page, "Northwind data model review").locator("[data-call-mark]").getAttribute("aria-label")).resolves.toBe("Transcript in Teams");
    await expect(item(page, "Northwind data model review").locator("[data-call-about] option:checked").textContent()).resolves.toBe("Northwind");
    // Hide: one press, out of Open and into Hidden; Undo puts it back.
    const open0 = await count(page, "open");
    // MC-5: Hide shows on hover.
    await item(page, "Northwind data model review").hover();
    await item(page, "Northwind data model review").locator("[data-call-act='hide']").click();
    await expect.poll(() => count(page, "hidden"), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => count(page, "open"), { timeout: 30_000 }).toBe(open0 - 1);
    await undo(page).click();
    await expect.poll(() => count(page, "hidden"), { timeout: 30_000 }).toBe(0);
    // A repeat is one row in the fold; its menu hides every one.
    await page.locator("[data-calls-fold='no-transcript'] > .link-btn").click();
    const standup = page.locator("[data-series-row]").filter({ hasText: "Team standup" });
    await expect(standup.locator(".calls-time").textContent()).resolves.toMatch(/· \d+ calls/);
    await standup.locator("[data-call-act='hide-menu']").click();
    await page.locator("[data-hide='every']").click();
    await expect.poll(() => page.locator("[data-series-row]").filter({ hasText: "Team standup" }).count(), { timeout: 30_000 }).toBe(0);
    // Hidden counts it once, as its list shows it.
    await expect.poll(() => count(page, "hidden"), { timeout: 30_000 }).toBe(1);
    await filter(page, "hidden").click();
    const hidden = page.locator("[data-section='hidden'] li");
    await expect(hidden.count()).resolves.toBe(1);
    await expect(hidden.textContent()).resolves.toMatch(/Team standup.*Every one, from now on/);
    await hidden.getByRole("button", { name: "Put back" }).click();
    await expect.poll(() => count(page, "hidden"), { timeout: 30_000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("from Thursday Week's line opens Calls on Open; Close out lists the day's open calls", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/calls?show=closed");
    await filter(page, "closed").waitFor({ timeout: 30_000 });
    await go(page, "#/week");
    const line = page.locator("[data-week-calls-line]");
    await expect.poll(() => line.textContent(), { timeout: 30_000 }).toBe("1 call to close this week");
    await line.click();
    await expect.poll(() => hash(page), { timeout: 30_000 }).toMatch(/^#\/calls/);
    await expect.poll(() => filter(page, "open").getAttribute("aria-pressed"), { timeout: 30_000 }).toBe("true");
    await go(page, "#/day/closeout/2026-11-02");
    const calls = page.locator("[data-closeout-calls]");
    await calls.waitFor({ timeout: 30_000 });
    await expect(calls.locator("h3").textContent()).resolves.toBe("Calls from Monday still open");
    await expect(calls.textContent()).resolves.toMatch(/Northwind weekly status call/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Skip all and close, Undo; the closed page with See what was skipped; putting one back opens the call", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page);
    const needs = page.locator("[data-section='needs'] li").first();
    await expect(needs.textContent()).resolves.toMatch(/\d+ left/);
    // MC-5: Skip all is a quiet button on the hovered row. No question first: Undo is the way back.
    await needs.hover();
    await expect(needs.locator("[data-call-act='skip-all']").textContent()).resolves.toBe("Skip all");
    await needs.locator("[data-call-act='skip-all']").click();
    await expect.poll(() => page.locator("[data-section='needs']").count(), { timeout: 30_000 }).toBe(0);
    await expect.poll(() => page.locator(".topbar .view-tab").filter({ hasText: /^Calls/ }).locator(".count").count(), { timeout: 30_000 }).toBe(0);
    // Its closed page is what shows beside the list, not the next call.
    await page.locator("[data-closed-page]").waitFor({ timeout: 30_000 });
    // Undo: each proposal back as it was, the call open again.
    await undo(page).click();
    await page.locator("[data-section='needs']").waitFor({ timeout: 30_000 });
    // Close it from its page this time.
    await page.locator("[data-section='needs'] [data-call-row]").first().click();
    await page.getByRole("heading", { level: 2, name: "Northwind weekly status call" }).waitFor({ timeout: 30_000 });
    await page.locator("[data-call-head] [data-call-act='skip-all']").click();
    const closed = page.locator("[data-closed-page]");
    await closed.waitFor({ timeout: 30_000 });
    await expect(closed.locator("h3").textContent()).resolves.toMatch(/^Closed Thu, Nov 5/);
    await expect(closed.textContent()).resolves.toMatch(/Nothing taken/);
    await closed.locator("[data-see-skipped]").click();
    await page.locator(".mtg-prop.skipped").first().getByRole("button", { name: "Bring back" }).click();
    await expect.poll(() => page.locator("[data-closed-page]").count(), { timeout: 30_000 }).toBe(0);
    await expect(page.locator("[data-call-head] [data-call-act='skip-all']").textContent()).resolves.toBe("Skip the last 1 and close");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a click on a row with a client and Teams' transcript reads it with no setup and opens the call", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openCalls(page);
    const model = item(page, "Northwind data model review");
    await expect.poll(() => model.locator("[data-call-mark]").textContent(), { timeout: 30_000 }).toBe("Teams");
    // MC-5: no Review button; the row itself.
    await expect(model.locator("[data-call-act='review']").count()).resolves.toBe(0);
    await model.locator("[data-call-row]").click();
    await expect.poll(() => hash(page), { timeout: 30_000 }).toMatch(/^#\/calls\/\d+/);
    await page.getByRole("heading", { level: 2, name: "Northwind data model review" }).waitFor({ timeout: 30_000 });
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on the phone (390 by 844): the row's controls are at least 44 px and nothing is cut; Week has its Thursday line", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, "#/week");
    await expect.poll(() => page.locator("[data-week-calls-line]").textContent(), { timeout: 30_000 }).toMatch(/calls? to close this week$/);
    expect((await page.locator("[data-week-calls-line]").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await openCalls(page);
    await page.locator("[data-call-mark]").first().waitFor({ timeout: 30_000 });
    for (const b of await page.locator("[data-calls-list] .calls-row-acts button, [data-calls-list] .calls-row-acts select, [data-calls-list] .calls-tick, [data-calls-list] li[data-row], [data-calls-list] .calls-head button").all()) {
      if (!(await b.isVisible())) continue;
      expect((await b.boundingBox())!.height, (await b.textContent()) ?? "").toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.close();
  }, T);
});
