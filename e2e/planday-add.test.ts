// Step 15.2: every way to add work in Plan the day, clicked in a real browser on demo data. Each test asserts the pick
// lands in the chosen block, the left pane shows it at once, and the row then says "Already planned here".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { blockPicks, CHROMIUM, freshPage, openPlanDay, selectBlock, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 60_000;

describe.skipIf(!CHROMIUM)("Plan the day: adding work (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  // U4: "This week's musts" (or "This week" when nice to haves are listed too).
  const section = (page: Page, name: string) => page.locator(name === "This week's priorities" ? `.pd2-right section[aria-label^="This week"]` : `.pd2-right section[aria-label="${name}"]`);
  // fix/planday-pane: "More from <client>'s DevOps · N", open on its own when nothing is above it.
  const more = (page: Page) => page.locator('.pd2-right section[aria-label^="More from "]');
  const openMore = async (page: Page) => {
    const fold = more(page).locator(".pd2-fold");
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  };
  const expandAll = async (page: Page) => {
    // U4: a feature's stories always show; nothing to expand.
    const closed = page.locator(".pd2-right .pd2-feature > .pd2-toggle[aria-expanded=false]");
    while (await closed.count()) await closed.first().click();
  };
  // U4: a ✓ says it (labelled "Already planned here"), no text.
  const plannedHere = (page: Page, title: string) => {
    const mark = page.locator(".pd2-right li.pd2-add.planned", { hasText: title }).locator(".pd2-plus.done");
    return { count: () => mark.count(), textContent: () => mark.first().getAttribute("aria-label") };
  };

  it("+ in This week's priorities", async () => {
    const { page, errors } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    await expandAll(page);
    const row = section(page, "This week's priorities").locator("li.pd2-add:not(.planned)").first();
    const title = (await row.locator(".pr-title").textContent())!;
    await row.locator("button.pd2-plus").click();
    await expect.poll(() => blockPicks(page, "Northwind")).toContain(title);
    await expect(plannedHere(page, title).textContent()).resolves.toBe("Already planned here");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("+ in Promises", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    const row = section(page, "Promises").locator("li.pd2-add").first();
    const what = (await row.locator(".pr-title").textContent())!.replace(/^[^:]+: /, "");
    await row.locator("button.pd2-plus").click();
    await expect.poll(async () => (await blockPicks(page, "Northwind")).some((t) => t.includes(what))).toBe(true);
    await expect(plannedHere(page, what).count()).resolves.toBe(1);
    await page.close();
  }, T);

  it("+ in More from <client>'s DevOps", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Cooptimize");
    await openMore(page);
    const row = more(page).locator("li.pd2-add:not(.planned)").first();
    const title = (await row.locator(".pr-title").textContent())!;
    await row.locator("button.pd2-plus").click();
    await expect.poll(() => blockPicks(page, "Cooptimize")).toContain(title);
    await expect(plannedHere(page, title).count()).resolves.toBe(1);
    await page.close();
  }, T);

  it("⋯ → Add to the plan → the selected block (the Week view's selection is elsewhere)", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    // The afternoon block, while the Week view still has the morning selected: the bug was adding to the morning.
    await selectBlock(page, "Northwind");
    await openMore(page);
    const row = more(page).locator("li.pd2-add:not(.planned)").first();
    const title = (await row.locator(".pr-title").textContent())!;
    await row.locator("button.more-btn").click();
    await page.getByRole("menuitem", { name: /^Add to the plan/ }).click();
    const first = page.getByRole("menuitem").first();
    await expect(first.textContent()).resolves.toMatch(/^Mon, Nov 2 PM/);
    await first.click();
    await expect.poll(() => blockPicks(page, "Northwind")).toContain(title);
    expect(await blockPicks(page, "Cooptimize")).not.toContain(title);
    await expect(plannedHere(page, title).count()).resolves.toBe(1);
    await page.close();
  }, T);

  it("⋯ → Add to the plan: another client's block says Different client and asks first", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    await openMore(page);
    const row = more(page).locator("li.pd2-add:not(.planned)").first();
    const title = (await row.locator(".pr-title").textContent())!;
    await row.locator("button.more-btn").click();
    await page.getByRole("menuitem", { name: /^Add to the plan/ }).click();
    await expect(page.locator(".menu-group", { hasText: "Different client" }).count()).resolves.toBe(1);
    const other = page.getByRole("menuitem", { name: /Mon, Nov 2 AM · Cooptimize/ });
    await other.click();
    await page.getByRole("menuitem", { name: /anyway/ }).click();
    await expect.poll(() => blockPicks(page, "Cooptimize")).toContain(title);
    await page.close();
  }, T);

  it("drag a row onto a block", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    await expandAll(page);
    const row = section(page, "This week's priorities").locator("li.pd2-add[draggable=true]").first();
    const title = (await row.locator(".pr-title").textContent())!;
    // Onto the Northwind block (the same client: no question).
    await row.dragTo(page.locator(".pd2-block", { has: page.locator(".pd2-client", { hasText: "Northwind" }) }));
    await expect.poll(() => blockPicks(page, "Northwind")).toContain(title);
    await page.close();
  }, T);

  it("+ Add work on a Week card opens Plan the day on that block, and + adds there", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const card = page.locator(".half", { hasText: "Northwind" }).first();
    await card.click({ position: { x: 12, y: 12 } });
    await card.getByRole("button", { name: "+ Add work" }).click();
    await page.locator(".pd2-right .pd2-pane-title", { hasText: "Northwind" }).waitFor();
    await expandAll(page);
    const row = section(page, "This week's priorities").locator("li.pd2-add:not(.planned)").first();
    const title = (await row.locator(".pr-title").textContent())!;
    await row.locator("button.pd2-plus").click();
    await expect.poll(() => blockPicks(page, "Northwind")).toContain(title);
    await page.close();
  }, T);

  it("A on a selected Week card does the same", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("2");
    const card = page.locator(".half", { hasText: "Atlas" }).first();
    await card.click({ position: { x: 12, y: 12 } });
    await page.keyboard.press("a");
    await page.locator(".pd2-right .pd2-pane-title", { hasText: "Atlas" }).waitFor();
    await expandAll(page);
    const row = page.locator(".pd2-right li.pd2-add:not(.planned)").first();
    const title = (await row.locator(".pr-title").textContent())!;
    await row.locator("button.pd2-plus").click();
    await expect.poll(() => blockPicks(page, "Atlas")).toContain(title);
    await page.close();
  }, T);

  it("keys still work after a click on +", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    await expandAll(page);
    await page.locator(".pd2-right li.pd2-add:not(.planned) button.pd2-plus").first().click();
    await page.locator(".pd2-right li.pd2-add.planned").first().waitFor();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.locator(".pd2-title h2").textContent()).toMatch(/Tuesday/);
    await page.close();
  }, T);

  it("keys still work after Timebox my day closes", async () => {
    const { page } = await freshPage(h);
    await openPlanDay(page);
    await selectBlock(page, "Northwind");
    await expandAll(page);
    await page.locator(".pd2-right li.pd2-add:not(.planned) button.pd2-plus").first().click();
    await page.locator(".pd2-right li.pd2-add.planned").first().waitFor();
    await page.locator(".pd2-head .done-btn").click();
    await page.locator(".pd-committed button.primary").click();
    await page.locator("[role=dialog]").last().getByRole("button", { name: /^Timebox/ }).click();
    await expect.poll(() => page.locator("[role=dialog]").count()).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.locator(".pd2-title h2").textContent()).toMatch(/Tuesday/);
    await page.close();
  }, T);
});

