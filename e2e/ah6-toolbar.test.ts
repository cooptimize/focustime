// AH-6: Ahead's one toolbar in demo mode: the same groups in the same order in Grid, Gantt, Readiness and Backlog;
// filters, the level and Show callouts carry across modes; the address round-trips them (a link opens the same view);
// a control that can't apply is shown disabled with its reason; the summary line, its chips and Clear filters; the
// search narrows Readiness and Backlog; the level folds all four modes, with Readiness's carets and keys; no native
// select or date input; Gaps reads Readiness and its old addresses still land. Screenshots go to FOCUSTIME_SHOTS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;
const MODES = [
  { hash: "#/ahead", name: "Grid", rows: ".ah-row" },
  { hash: "#/ahead/gantt", name: "Gantt", rows: ".pa-item" },
  { hash: "#/ahead/fix", name: "Readiness", rows: ".ah-fx-row" },
  { hash: "#/ahead/backlog", name: "Backlog", rows: ".bl-row" },
] as const;

describe.skipIf(!CHROMIUM)("AH-6: Ahead's one toolbar (browser, demo mode)", () => {
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
  const mode = async (page: Page, name: string) => {
    await page.getByRole("navigation", { name: "Ahead modes" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await page.locator(`main.ahead-${MODES.find((m) => m.name === name)!.hash.split("/")[2] ?? "grid"}`).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
  };
  const structure = (page: Page) =>
    page.locator(".ah-toolbar .ah-tb-group").evaluateAll((gs) => gs.map((g) => `${g.getAttribute("data-control")}${g.classList.contains("off") ? ":off" : ""}`));
  const summary = (page: Page) => page.locator(".ah-tb-sumtext").textContent();
  const shot = async (page: Page, name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  it("the same groups in the same order in every mode; what can't apply is disabled with its reason, never removed", async () => {
    const { page, errors } = await open("#/ahead");
    const seen: Record<string, string[]> = {};
    for (const m of MODES) {
      await mode(page, m.name);
      seen[m.name] = await structure(page);
    }
    const bare = (xs: string[]) => xs.map((x) => x.replace(/:off$/, ""));
    expect(bare(seen.Grid!)).toEqual(["clients", "people", "epic", "dates", "readiness", "search", "level", "callouts", "whole"]);
    for (const m of MODES) expect(bare(seen[m.name]!), m.name).toEqual(bare(seen.Grid!));
    // Callouts only on the Gantt; the whole project not in Readiness or Backlog.
    expect(seen.Gantt).toContain("callouts");
    for (const m of ["Grid", "Readiness", "Backlog"]) expect(seen[m], m).toContain("callouts:off");
    for (const m of ["Readiness", "Backlog"]) expect(seen[m], m).toContain("whole:off");
    await expect(page.getByRole("button", { name: "Show callouts" }).getAttribute("title")).resolves.toMatch(/Gantt's bars/);
    await expect(page.getByRole("button", { name: "Show callouts" }).getAttribute("aria-disabled")).resolves.toBe("true");
    // Disabled does nothing: still pressed after a click.
    const pressed = await page.getByRole("button", { name: "Show callouts" }).getAttribute("aria-pressed");
    await page.getByRole("button", { name: "Show callouts" }).click({ force: true });
    await expect(page.getByRole("button", { name: "Show callouts" }).getAttribute("aria-pressed")).resolves.toBe(pressed);
    // In Readiness, Not ready only is what the mode is: the popover says so, the kinds still apply.
    await mode(page, "Readiness");
    await page.getByRole("button", { name: /^Readiness:/ }).click();
    await expect(page.locator(".cell-pop .ah-tb-note").textContent()).resolves.toMatch(/only items that aren't ready/);
    await page.locator(".cell-pop").getByRole("button", { name: "Done" }).click();
    // No native select or date input anywhere in Ahead, in any mode.
    for (const m of MODES) {
      await mode(page, m.name);
      await expect(page.locator("main.ahead select, main.ahead input[type=date], main.ahead input[type=search]").count(), m.name).resolves.toBe(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("filters, the level and Show callouts carry across modes; the header, the switch and the summary agree; chips and Clear filters", async () => {
    const { page, errors } = await open("#/ahead/gantt");
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    await page.getByRole("group", { name: "Clients" }).getByRole("button", { name: "Northwind Foods" }).click();
    await page.getByRole("button", { name: /^Dates:/ }).click();
    await page.locator(".cell-pop").getByRole("button", { name: "Next 4 weeks" }).click();
    await page.locator(".cell-pop").getByRole("button", { name: "Done" }).click();
    await page.locator(".ah-toolbar .ah-levels").getByRole("button", { name: "Features", exact: true }).click();
    await page.getByRole("button", { name: "Show callouts" }).click();
    await expect(summary(page)).resolves.toMatch(/^Showing \d+ of \d+ · Northwind Foods · Everyone · Next 4 weeks$/);
    await expect(page.locator(".ah-tb-chip").allTextContents()).resolves.toEqual(["Northwind Foods×", "Next 4 weeks×"]);
    await expect(page.locator(".pa-marker").count()).resolves.toBe(0);
    await shot(page, "toolbar-gantt");
    for (const m of ["Grid", "Readiness", "Backlog"]) {
      await mode(page, m);
      await expect(summary(page), m).resolves.toMatch(/ · Northwind Foods · Everyone · Next 4 weeks$/);
      await expect(page.locator(".ah-toolbar .ah-levels").getByRole("button", { name: "Features", exact: true }).getAttribute("aria-pressed"), m).resolves.toBe("true");
      // The header's number is the summary's.
      const shown = Number(/^Showing (?:all )?(\d+)/.exec((await summary(page)) ?? "")?.[1]);
      const head = (await page.locator(".follow-ups-head h2").textContent()) ?? "";
      expect(head, m).toContain(m === "Readiness" ? `${shown} not ready yet` : `${shown} item`);
      if (m === "Readiness") await expect(page.getByRole("navigation", { name: "Ahead modes" }).getByRole("button", { name: /Readiness/ }).textContent()).resolves.toBe(`Readiness · ${shown}`);
      await shot(page, `toolbar-${m.toLowerCase()}`);
    }
    await mode(page, "Gantt");
    await expect(page.getByRole("button", { name: "Show callouts" }).getAttribute("aria-pressed")).resolves.toBe("false");
    // A chip removes only its own filter; Clear filters puts back every default.
    await page.locator(".ah-tb-chip", { hasText: "Next 4 weeks" }).click();
    await expect(summary(page)).resolves.toMatch(/ · Northwind Foods · Everyone · Any time$/);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(summary(page)).resolves.toMatch(/ · All clients · \w+ · Any time$/);
    await expect(page.locator(".ah-tb-chip").count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the address round-trips the view: a copied link opens the same filters, level and callouts in a new browser", async () => {
    const { page, errors } = await open("#/ahead/backlog");
    await page.getByRole("group", { name: "Clients" }).getByRole("button", { name: "Northwind Foods" }).click();
    await page.getByRole("button", { name: /^Readiness:/ }).click();
    await page.locator(".cell-pop").getByRole("button", { name: "Needs stories" }).click();
    await page.locator(".cell-pop").getByRole("button", { name: "Done" }).click();
    await page.getByRole("textbox", { name: "Search titles or #id" }).fill("supplier");
    await page.locator(".ah-toolbar .ah-levels").getByRole("button", { name: "Features", exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/ahead\/backlog\?/);
    const link = await page.evaluate(() => location.hash);
    expect(link).toContain("k=needs_stories");
    expect(link).toContain("q=supplier");
    expect(link).toContain("l=feature");
    const want = await summary(page);
    await page.close();
    // Someone else's browser: no stored filters, the link alone.
    const other = await open(link);
    await expect.poll(() => summary(other.page)).toBe(want);
    await expect(other.page.locator(".bl-row").count()).resolves.toBeGreaterThan(0);
    for (const t of await other.page.locator(".bl-row .bl-title a, .bl-row a").allTextContents()) expect(t.toLowerCase()).toContain("supplier");
    await expect(other.page.locator(".ah-toolbar .ah-levels").getByRole("button", { name: "Features", exact: true }).getAttribute("aria-pressed")).resolves.toBe("true");
    // Switching modes keeps the query on the address.
    await mode(other.page, "Readiness");
    await expect.poll(() => other.page.evaluate(() => location.hash)).toMatch(/^#\/ahead\/fix\?.*q=supplier/);
    expect([...errors, ...other.errors]).toEqual([]);
    await other.page.close();
  }, T);

  it("the search and readiness narrow Readiness and Backlog", async () => {
    const { page, errors } = await open("#/ahead/fix");
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    const all = await page.locator(".ah-fx-row:not(.ctx)").count();
    expect(all).toBeGreaterThan(1);
    await page.getByRole("textbox", { name: "Search titles or #id" }).fill("supplier onboarding");
    await expect.poll(() => page.locator(".ah-fx-row:not(.ctx)").count()).toBe(1);
    await expect(page.locator(".ah-fx-row:not(.ctx) .ah-title a").textContent()).resolves.toBe("Supplier onboarding");
    await page.getByRole("button", { name: "Clear the search" }).click();
    await page.getByRole("button", { name: /^Readiness:/ }).click();
    await page.locator(".cell-pop").getByRole("button", { name: "Unassigned" }).click();
    await page.locator(".cell-pop").getByRole("button", { name: "Done" }).click();
    const rows = await page.locator(".ah-fx-row:not(.ctx)").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    for (const r of rows) expect(r).toContain("Unassigned");
    // Backlog: the same filter narrows it.
    await mode(page, "Backlog");
    const bl = await page.locator(".bl-row").count();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect.poll(() => page.locator(".bl-row").count()).toBeGreaterThanOrEqual(bl);
    await page.getByRole("textbox", { name: "Search titles or #id" }).fill("#1120");
    await expect.poll(() => page.locator(".bl-row").count()).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the level folds every mode; Readiness has carets and Left, Right, Up and Down", async () => {
    const { page, errors } = await open("#/ahead");
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    const levels = page.locator(".ah-toolbar .ah-levels");
    const counts: Record<string, number[]> = {};
    for (const m of MODES) {
      await mode(page, m.name);
      counts[m.name] = [];
      for (const l of ["Stories", "Features", "Epics"]) {
        await levels.getByRole("button", { name: l, exact: true }).click();
        await page.waitForTimeout(200);
        counts[m.name]!.push(await page.locator(m.rows).count());
        if (l === "Epics") await shot(page, `level-epics-${m.name.toLowerCase()}`);
      }
    }
    // Fewer rows at each level up (Backlog lists that level's backlog).
    for (const m of ["Grid", "Gantt", "Readiness"]) {
      const [s, f, e] = counts[m]!;
      expect(s!, m).toBeGreaterThanOrEqual(f!);
      expect(f!, m).toBeGreaterThanOrEqual(e!);
      expect(s!, m).toBeGreaterThan(e!);
    }
    expect(new Set(counts.Backlog).size).toBeGreaterThan(1);
    // Readiness: a closed row says how many are under it; its caret and the keys open and close it.
    await mode(page, "Readiness");
    await levels.getByRole("button", { name: "Epics", exact: true }).click();
    const closed = page.locator(".ah-fx-item[aria-expanded=false]").first();
    await expect(closed.locator(".ah-fx-under").textContent()).resolves.toMatch(/\d+ more under it/);
    const key = await closed.getAttribute("data-key");
    const item = page.locator(`.ah-fx-item[data-key="${key}"]`);
    await item.focus();
    await page.keyboard.press("ArrowRight");
    await expect(item.getAttribute("aria-expanded")).resolves.toBe("true");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.depth)).toBe("1");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key)).toBe(key);
    await page.keyboard.press("ArrowLeft");
    await expect(item.getAttribute("aria-expanded")).resolves.toBe("false");
    await item.locator(".rm-expand").click();
    await expect(item.getAttribute("aria-expanded")).resolves.toBe("true");
    // Expand all in the control's menu.
    await page.locator(".ah-toolbar .ah-levels-more").click();
    await page.getByRole("menuitem", { name: "Expand all" }).click();
    await expect(levels.getByRole("button", { name: "Stories", exact: true }).getAttribute("aria-pressed")).resolves.toBe("true");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Gaps reads Readiness; the old addresses land on it", async () => {
    for (const hash of ["#/ahead/fix", "#/ahead/gaps"]) {
      const { page, errors } = await open(hash);
      await expect(page.locator("main.ahead-fix").getAttribute("aria-label")).resolves.toBe("Ahead: Readiness");
      await expect(page.locator(".follow-ups-head h2").textContent()).resolves.toMatch(/^Ahead · \d+ not ready yet$/);
      await expect(page.locator(".mode-switch .ms-btn").allTextContents()).resolves.toEqual(["Grid", "Gantt", expect.stringMatching(/^Readiness · \d+$/), "Backlog"]);
      if (hash === "#/ahead/fix") await shot(page, "readiness");
      expect(errors).toEqual([]);
      await page.close();
    }
  }, T);
});
