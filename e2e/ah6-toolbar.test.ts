// AH-6, BL-1: Backlog's one row of filters in demo mode: the same row in Grid and Gantt (Clients, People, Needs
// attention, Search, Filter, ⋯), what can't apply in a view disabled in ⋯ with its reason; filters, the level and
// Callouts carry across views; the address round-trips them (a link opens the same view); the Showing line only off
// the defaults, one chip per filter, Clear filters; the search narrows Needs attention and the one-level list; the level
// folds both views; no native select or date input; Readiness's and Gaps's old addresses land on Needs attention.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { calloutsOn, levelPressed, moreItem, openFilter, pickLevel } from "./backlog-helpers.ts";
import { shotBoth, SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;
const VIEWS = [
  { hash: "#/backlog", name: "Grid", rows: ".ah-row" },
  { hash: "#/backlog/gantt", name: "Gantt", rows: ".pa-item" },
] as const;

describe.skipIf(!CHROMIUM)("AH-6, BL-1: Backlog's one row of filters (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async (hash: string, viewport = { width: 1440, height: 900 }) => {
    const { page, errors } = await freshPage(h, viewport);
    await page.evaluate((x) => (location.hash = x), hash);
    await page.locator(".ah-toolbar").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(300);
    return { page, errors };
  };
  const view = async (page: Page, name: string) => {
    await page.getByRole("navigation", { name: "Backlog views" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await page.locator(`main.ahead-${name === "Grid" ? "grid" : "gantt"}`).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
  };
  /** The row's controls, left to right, by their names. */
  const structure = (page: Page) =>
    page.locator(".ah-toolbar .ah-tb-row").first().evaluate((row) =>
      [...row.querySelectorAll("button, input, [role=group]")]
        .filter((e) => !e.closest("[role=group]") || e.getAttribute("role") === "group")
        .map((e) => (e.getAttribute("aria-label") ?? e.getAttribute("data-tour") ?? (e.textContent ?? "").trim().replace(/\s*\d+$/, "")).split(":")[0]!)
        .filter(Boolean),
    );
  const summary = (page: Page) => page.locator(".ah-tb-sumtext").textContent();
  const chips = (page: Page) => page.locator(".ah-tb-summary .ah-tb-chip").allTextContents();

  it("the same row in both views; what can't apply is disabled in ⋯ with its reason, never removed", async () => {
    const { page, errors } = await open("#/backlog");
    const grid = await structure(page);
    expect(grid).toEqual(["Clients", "People", "ah-attention", "Search titles or #id", "Filter", "More"]);
    await view(page, "Gantt");
    // The Gantt adds its quiet Legend before Filter; everything else in the same order.
    expect((await structure(page)).filter((x) => x !== "Legend")).toEqual(grid);
    await view(page, "Grid");
    // Callouts are the Gantt's: in the Grid, ⋯ shows the item disabled with why, and a click changes nothing.
    await page.getByRole("button", { name: "More: rows and view" }).click();
    const callouts = page.getByRole("menuitemcheckbox", { name: /Callouts/ });
    await expect(callouts.getAttribute("aria-disabled")).resolves.toBe("true");
    await expect(callouts.getAttribute("title")).resolves.toMatch(/Gantt's bars/);
    const was = await callouts.getAttribute("aria-checked");
    await callouts.click({ force: true });
    await page.keyboard.press("Escape");
    await expect(calloutsOn(page)).resolves.toBe(was);
    // No native select or date input anywhere in Backlog, in either view (the one-level checkbox is a real checkbox).
    for (const v of VIEWS) {
      await view(page, v.name);
      await expect(page.locator("main.ahead select, main.ahead input[type=date], main.ahead input[type=search]").count(), v.name).resolves.toBe(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("filters, the level and Callouts carry across views; the header and the Showing line agree; one chip per filter; Clear filters", async () => {
    const { page, errors } = await open("#/backlog/gantt");
    // At the defaults there is no Showing line at all.
    await expect(page.locator(".ah-tb-summary").count()).resolves.toBe(0);
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    await page.locator(".ah-toolbar").getByRole("group", { name: "Clients" }).getByRole("button", { name: "Northwind Foods" }).click();
    const pop = await openFilter(page);
    await pop.getByRole("button", { name: /^Dates/ }).click();
    await page.locator(".cell-pop").getByRole("button", { name: "Next 4 weeks" }).last().click();
    await page.keyboard.press("Escape");
    await pickLevel(page, "Features");
    await moreItem(page, /Callouts/);
    await expect(summary(page)).resolves.toMatch(/^Showing \d+ of \d+$/);
    // Northwind is a client I lead, so Everyone is its default: no People chip.
    await expect(chips(page)).resolves.toEqual([expect.stringContaining("Northwind Foods"), expect.stringContaining("Next 4 weeks")]);
    // Filter counts what's off its default inside it: Dates and the level.
    await expect(page.locator(".ah-toolbar .ah-filter-n").textContent()).resolves.toBe("2");
    await expect(page.locator(".pa-marker").count()).resolves.toBe(0);
    await shotBoth(page, "toolbar-gantt");
    await view(page, "Grid");
    await expect(chips(page)).resolves.toEqual([expect.stringContaining("Northwind Foods"), expect.stringContaining("Next 4 weeks")]);
    await expect(levelPressed(page, "Features")).resolves.toBe("true");
    // The header's number is the Showing line's.
    const shown = Number(/^Showing (?:all )?(\d+)/.exec((await summary(page)) ?? "")?.[1]);
    await expect(page.locator(".follow-ups-head h2").textContent()).resolves.toContain(`${shown} item`);
    await shotBoth(page, "toolbar-grid");
    await view(page, "Gantt");
    await expect(calloutsOn(page)).resolves.toBe("false");
    // A chip removes only its own filter; Clear filters puts back every default and the line goes.
    await page.locator(".ah-tb-chip", { hasText: "Next 4 weeks" }).click();
    await expect(chips(page)).resolves.toEqual([expect.stringContaining("Northwind Foods")]);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect.poll(() => page.locator(".ah-tb-summary").count()).toBe(0);
    await moreItem(page, /Callouts/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the address round-trips the view: a copied link opens the same filters and level in a new browser", async () => {
    const { page, errors } = await open("#/backlog/stories");
    await page.locator(".ah-toolbar").getByRole("group", { name: "Clients" }).getByRole("button", { name: "Northwind Foods" }).click();
    await page.getByRole("button", { name: /^Needs attention/ }).click();
    await page.getByRole("group", { name: "Needs attention, by kind" }).getByRole("button", { name: /^Needs stories/ }).click();
    await page.getByRole("textbox", { name: "Search titles or #id" }).fill("supplier");
    const pop = await openFilter(page);
    await pop.getByRole("group", { name: "Levels" }).getByRole("button", { name: "Features", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/backlog\?/);
    const link = await page.evaluate(() => location.hash);
    for (const part of ["nr=1", "k=needs_stories", "q=supplier", "fl=feature"]) expect(link).toContain(part);
    const want = await chips(page);
    await page.close();
    // Someone else's browser: no stored filters, the link alone.
    const other = await open(link);
    await expect.poll(() => chips(other.page)).toEqual(want);
    await expect(other.page.locator(".ah-client .ah-row").count()).resolves.toBeGreaterThan(0);
    for (const t of await other.page.locator(".ah-client .ah-row:not(.context) .ah-title a").allTextContents()) expect(t.toLowerCase()).toContain("supplier");
    // Switching views keeps the query on the address.
    await view(other.page, "Gantt");
    await expect.poll(() => other.page.evaluate(() => location.hash)).toMatch(/^#\/backlog\/gantt\?.*q=supplier/);
    expect([...errors, ...other.errors]).toEqual([]);
    await other.page.close();
  }, T);

  it("the search narrows Needs attention and the one-level list", async () => {
    const { page, errors } = await open("#/backlog/attention");
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    const entries = page.locator(".ah-client .ah-row:not(.context)");
    await expect.poll(() => entries.count()).toBeGreaterThan(1);
    await page.getByRole("textbox", { name: "Search titles or #id" }).fill("supplier onboarding");
    await expect.poll(() => entries.count()).toBe(1);
    await expect(entries.locator(".ah-title a").textContent()).resolves.toBe("Supplier onboarding");
    await page.getByRole("button", { name: "Clear the search" }).click();
    await page.getByRole("group", { name: "Needs attention, by kind" }).getByRole("button", { name: /^Unsized/ }).click();
    const labels = await entries.locator(".ah-col-status").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toContain("Unsized");
    // The one-level list: the same search narrows it.
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.evaluate(() => (location.hash = "#/backlog/stories"));
    await page.locator(".shape-flat").waitFor({ timeout: 30_000 });
    const all = await page.locator(".ah-row").count();
    await page.getByRole("textbox", { name: "Search titles or #id" }).fill("#1120");
    await expect.poll(() => page.locator(".ah-row").count()).toBeLessThan(all);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the level folds both views; Needs attention's rows fold under their parents with the chevron and Left, Right, Up and Down", async () => {
    const { page, errors } = await open("#/backlog");
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    const counts: Record<string, number[]> = {};
    for (const v of VIEWS) {
      await view(page, v.name);
      counts[v.name] = [];
      for (const l of ["Stories", "Features", "Epics"]) {
        await pickLevel(page, l);
        await page.waitForTimeout(200);
        counts[v.name]!.push(await page.locator(v.rows).count());
        if (l === "Epics") await shotBoth(page, `level-epics-${v.name.toLowerCase()}`);
      }
    }
    for (const v of ["Grid", "Gantt"]) {
      const [s, f, e] = counts[v]!;
      expect(s!, v).toBeGreaterThanOrEqual(f!);
      expect(f!, v).toBeGreaterThanOrEqual(e!);
      expect(s!, v).toBeGreaterThan(e!);
    }
    // Needs attention at Epics: a closed row; its chevron and the keys open and close it.
    await view(page, "Grid");
    await page.getByRole("button", { name: /^Needs attention/ }).click();
    const closed = page.locator(".ah-client .ah-row", { has: page.locator(".ah-chev[aria-expanded=false]") }).first();
    await closed.waitFor({ timeout: 30_000 });
    const key = await closed.getAttribute("data-key");
    const row = page.locator(`.ah-row[data-key="${key}"]`);
    const item = row.locator(".ah-col-item");
    await item.focus();
    await page.keyboard.press("ArrowRight");
    await expect(row.locator(".ah-chev").getAttribute("aria-expanded")).resolves.toBe("true");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("tr")?.getAttribute("data-key"))).not.toBe(key);
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("tr")?.getAttribute("data-key"))).toBe(key);
    await page.keyboard.press("ArrowLeft");
    await expect(row.locator(".ah-chev").getAttribute("aria-expanded")).resolves.toBe("false");
    await row.locator(".ah-chev").click();
    await expect(row.locator(".ah-chev").getAttribute("aria-expanded")).resolves.toBe("true");
    // Expand all in ⋯.
    await moreItem(page, "Expand all");
    await expect(levelPressed(page, "Stories")).resolves.toBe("true");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Readiness, Gaps and Fix next's old addresses land on the Grid with Needs attention on", async () => {
    for (const hash of ["#/ahead/fix", "#/ahead/gaps", "#/ahead/readiness"]) {
      const { page, errors } = await open(hash);
      await expect.poll(() => page.getByRole("button", { name: /^Needs attention/ }).getAttribute("aria-pressed"), { message: hash }).toBe("true");
      await expect(page.locator("main.ahead-grid").getAttribute("aria-label")).resolves.toMatch(/^Backlog: /);
      await expect(page.locator(".follow-ups-head h2").textContent()).resolves.toMatch(/^Backlog · \d+ need attention/);
      await expect(page.locator(".mode-switch .ms-btn").allTextContents()).resolves.toEqual(["Grid", "Gantt"]);
      await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/backlog(\?|$)/);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, T);

  it.skipIf(!SHOTS)("screenshots at 1920: the same filters in both views", async () => {
    const q = "c=Northwind,Harbor&o=Northwind~all,Harbor~all&nr=1&l=feature";
    for (const v of VIEWS) {
      const { page } = await open(`${v.hash}?${q}`, { width: 1920, height: 1080 });
      await page.waitForTimeout(600);
      await shotBoth(page, `toolbar-1920-${v.name.toLowerCase()}`);
      await page.close();
    }
  }, T);
});
