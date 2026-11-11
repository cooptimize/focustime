// SG-1: the board suggests, in a real browser on the demo. Tuesday Nov 3, 9:30 AM: Tuesday's Harbor morning and Atlas
// afternoon and Wednesday's Northwind blocks start empty (the demo's own to-dos on them come off); Monday keeps its
// unfinished ones; Thursday is the demo's PTO day. Each test signs in to its own demo. The rule's edge cases are unit
// tests (plan/boardsuggest.test.ts); the store's in actions/plan-actions.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { call, emptyFrom } from "./sg1-helpers.ts";

const T = 180_000;
const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";
const block = (page: Page, date: string, half: string) => page.locator(`[data-drop="${date}:${half}"]`).first();
const sugIn = (b: Locator) => b.locator(".sug-block");
const sugTitles = (b: Locator) => b.locator(".sug-row .sug-title").allInnerTexts();
const todoTitles = (b: Locator) => b.locator(".checklist .pr-title").allInnerTexts();
const toast = (page: Page) => page.locator(".undo-toast");

async function goTo(page: Page, address: string, ready: Locator) {
  const set = () => page.evaluate((a) => void (location.hash !== a && (location.hash = a)), address);
  await set();
  await expect.poll(async () => (await ready.isVisible()) || (await set(), false), { timeout: 30_000, interval: 250 }).toBe(true);
}
const week = (page: Page) => goTo(page, "#/week", page.locator("main.grid .half.card").first());
const day = (page: Page, date?: string) => goTo(page, date ? `#/day/${date}` : "#/day", page.locator(".day-view .day-bar").first());

async function start(h: Harness, viewport = { width: 1440, height: 900 }) {
  const { page, errors } = await freshPage(h, viewport);
  await emptyFrom(page, TUE);
  return { page, errors };
}

describe.skipIf(!CHROMIUM)("SG-1: the board suggests (browser, demo)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-03T09:30:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("Day: both empty blocks suggest; Keep all on one makes to-dos there and leaves the other's; Undo takes them back", async () => {
    const { page, errors } = await start(h);
    await day(page);
    const am = block(page, TUE, "AM");
    const pm = block(page, TUE, "PM");
    await expect.poll(() => sugIn(am).count()).toBe(1);
    await expect.poll(() => sugIn(pm).count()).toBe(1);
    const offered = await sugTitles(am);
    expect(offered.length).toBeGreaterThan(0);
    expect(await todoTitles(am)).toEqual([]);
    await sugIn(am).locator(".sug-keep-all").click();
    await expect.poll(() => todoTitles(am)).toEqual(expect.arrayContaining(offered.filter((t) => t !== "Patient portal login")));
    await expect.poll(() => sugIn(pm).count()).toBe(1);
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => todoTitles(am)).toEqual([]);
    await expect.poll(() => sugTitles(am)).toEqual(offered);
    expect(errors).toEqual([]);
  }, T);

  it("Keep all for the day from Day's header: every block's become to-dos, one Undo takes them all back", async () => {
    const { page } = await start(h);
    await day(page);
    const line = page.locator(".day-bar .sug-day");
    await expect.poll(() => line.locator(".sug-count").innerText().catch(() => "")).toMatch(/^\d+ suggested$/);
    const n = Number((await line.locator(".sug-count").innerText()).split(" ")[0]);
    await line.locator(".sug-keep-all").click();
    await expect.poll(() => toast(page).innerText()).toMatch(new RegExp(`Kept ${n} to-dos for Tuesday`));
    await expect.poll(() => page.locator(".day-bar .sug-day").count()).toBe(0);
    await expect.poll(async () => (await todoTitles(block(page, TUE, "PM"))).length).toBeGreaterThan(0);
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await todoTitles(block(page, TUE, "AM"))).length + (await todoTitles(block(page, TUE, "PM"))).length).toBe(0);
    await expect.poll(() => page.locator(".day-bar .sug-count").innerText().catch(() => "")).toBe(`${n} suggested`);
  }, T);

  it("Clear on a block: gone, still gone after a reload, the other block unaffected; Clear on a row: it doesn't come back in another block", async () => {
    const { page } = await start(h);
    await day(page);
    const am = block(page, TUE, "AM");
    const pm = block(page, TUE, "PM");
    await expect.poll(() => sugIn(pm).count()).toBe(1);
    const amBefore = await sugTitles(am);
    await sugIn(pm).locator(".sug-clear").click();
    await expect.poll(() => sugIn(pm).count()).toBe(0);
    await expect.poll(() => toast(page).innerText().catch(() => "")).toContain("Cleared");
    await page.reload();
    await day(page);
    await expect.poll(() => sugTitles(am)).toEqual(amBefore);
    expect(await sugIn(block(page, TUE, "PM")).count()).toBe(0);

    // A row on Week: Wednesday morning's first, gone from every block.
    await week(page);
    const wedAm = block(page, WED, "AM");
    await expect.poll(async () => (await sugTitles(wedAm)).length).toBeGreaterThan(0);
    const first = (await sugTitles(wedAm))[0]!;
    await wedAm.locator(".sug-row").first().locator(".sug-x").click();
    await expect.poll(() => page.locator("main.grid .sug-row .sug-title", { hasText: first }).count()).toBe(0);
    await page.reload();
    await week(page);
    await expect.poll(async () => (await page.locator("main.grid .sug-row").count()) > 0).toBe(true);
    expect(await page.locator("main.grid .sug-row .sug-title", { hasText: first }).count()).toBe(0);
  }, T);

  it("adding my own to-do to a block with suggestions: they go", async () => {
    const { page } = await start(h);
    await day(page);
    const pm = block(page, TUE, "PM");
    await expect.poll(() => sugIn(pm).count()).toBe(1);
    await pm.locator(".add-work.add-row").click();
    const box = page.locator("aside.block-panel input.bp-box");
    await box.waitFor();
    await box.fill("Call the rate desk back");
    await page.keyboard.press("Enter");
    await expect.poll(() => todoTitles(pm)).toContain("Call the rate desk back");
    await expect.poll(() => sugIn(pm).count()).toBe(0);
  }, T);

  it("suggestions don't change free time, and today stays empty for the start-of-day reminder until one is kept", async () => {
    const { page } = await start(h);
    await day(page);
    const am = block(page, TUE, "AM");
    await expect.poll(() => sugIn(am).count()).toBe(1);
    const freeOn = await am.locator(".card-agenda-fold").innerText();
    await expect.poll(() => page.locator(".moment-card.moment-plan h2").innerText().catch(() => "")).toBe("Nothing on today yet");
    await expect.poll(() => page.locator(".moment-card.moment-plan p").innerText().catch(() => "")).toMatch(/^\d+ suggestions? (is|are) in your blocks\.$/);
    // What the reminder reads: today's to-dos in the store. None while suggestions only show.
    const w = (await call(page, "week.load", {})).data as { plan: Record<string, { picks: { status: string }[] }> };
    expect((w.plan[TUE]?.picks ?? []).filter((p) => p.status === "planned" || p.status === "done")).toEqual([]);
    // The same free time with suggestions off.
    await page.locator(".day-bar .more-btn, .day-bar [aria-label='View options for Day']").first().click();
    await page.getByRole("menuitemcheckbox", { name: /Suggestions/ }).or(page.getByRole("menuitem", { name: /Suggestions/ })).first().click();
    await expect.poll(() => sugIn(am).count()).toBe(0);
    expect(await am.locator(".card-agenda-fold").innerText()).toBe(freeOn);
  }, T);

  it("an unfinished to-do from yesterday is the first suggestion in its client's next block, saying so on hover", async () => {
    const { page } = await start(h);
    await week(page);
    const w = (await call(page, "suggest.load", {})).data as { picks: { title: string; date: string; clientKey: string }[] };
    const left = w.picks.find((p) => p.date === MON && p.clientKey === "Northwind");
    expect(left).toBeTruthy();
    const wedAm = block(page, WED, "AM");
    const first = wedAm.locator(".sug-row").first();
    await expect.poll(() => first.locator(".sug-title").innerText().catch(() => "")).toBe(left!.title);
    expect(await first.locator(".sug-take").getAttribute("title")).toMatch(/^Unfinished from Mon/);
  }, T);

  it("Settings › Planning off: none anywhere; on again: they return", async () => {
    const { page } = await start(h);
    await week(page);
    await expect.poll(() => page.locator("main.grid .sug-block").count()).toBeGreaterThan(0);
    await goTo(page, "#/settings/planning", page.getByRole("checkbox", { name: /Suggest/ }));
    await page.getByRole("checkbox", { name: /Suggest/ }).uncheck();
    await expect.poll(async () => ((await call(page, "week.load", {})).data as { planning: { suggest: boolean } }).planning.suggest).toBe(false);
    await page.reload();
    await week(page);
    await day(page);
    expect(await page.locator(".sug-block, .sug-day").count()).toBe(0);
    await week(page);
    expect(await page.locator(".sug-block, .sug-day").count()).toBe(0);
    await goTo(page, "#/settings/planning", page.getByRole("checkbox", { name: /Suggest/ }));
    await page.getByRole("checkbox", { name: /Suggest/ }).check();
    await expect.poll(async () => ((await call(page, "week.load", {})).data as { planning: { suggest: boolean } }).planning.suggest).toBe(true);
    await page.reload();
    await week(page);
    await expect.poll(() => page.locator("main.grid .sug-block").count()).toBeGreaterThan(0);
  }, T);

  it("the phone: Keep all on a block", async () => {
    const page = await phonePage(h, 390);
    await emptyFrom(page, TUE);
    await day(page);
    const sug = page.locator(".ph-todos .sug-block").first();
    await sug.waitFor({ timeout: 30_000 });
    const offered = await sug.locator(".sug-title").allInnerTexts();
    await sug.locator(".sug-keep-all").click();
    await expect.poll(() => page.locator(".ph-todos .ph-todo-title").allInnerTexts()).toEqual(expect.arrayContaining(offered.filter((t) => t !== "Patient portal login")));
  }, T);
});

describe.skipIf(!CHROMIUM)("SG-1: today and the next working day only (browser, demo, Monday)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("Week: today and the next working day show suggestions; the day after doesn't", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await emptyFrom(page, MON);
    await week(page);
    const head = (d: string) => page.locator(`main.grid section.day:has([data-drop^="${d}:"]) .day-head .sug-day`);
    await expect.poll(() => head(MON).count()).toBe(1);
    await expect.poll(() => head(TUE).count()).toBe(1);
    expect(await head(WED).count()).toBe(0);
    expect(await block(page, WED, "AM").locator(".sug-block").count()).toBe(0);
  }, T);
});
