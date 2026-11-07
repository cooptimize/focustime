// AH-6: Ahead › Gantt as a planning layout, in demo mode: type icons at every level, indentation by level only, nothing
// but the hierarchy in the label column, each label on its bar's row (two-line titles, Larger text, after folding,
// callouts hidden), the callout marker and its popover with fixes, Show callouts remembered, Show: Epics · Features ·
// Stories with roll-ups and carets, arrow caps, the column resize remembered, keyboard, and no native inputs in Ahead.
// Screenshots go to FOCUSTIME_SHOTS when set (docs/ux/ah6/ for the PR).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { call } from "./mb1-helpers.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;

describe.skipIf(!CHROMIUM)("AH-6: Ahead › Gantt layout (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async (viewport = { width: 1440, height: 900 }, before?: (page: Page) => Promise<void>) => {
    const { page, errors } = await freshPage(h, viewport);
    await before?.(page);
    await page.evaluate(() => (location.hash = "#/ahead/gantt"));
    await page.locator(".pa-item").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(400);
    return { page, errors };
  };
  const level = (page: Page, name: string) => page.locator(".ah-gantt-bar .ah-levels").getByRole("button", { name, exact: true });
  const row = (page: Page, title: string) => page.locator(".pa-item", { has: page.getByRole("link", { name: title, exact: true }) });
  const shot = async (page: Page, name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  /** Every row: its level, the icon's left edge, the label's and bar's vertical centers. */
  const geometry = (page: Page) =>
    page.locator(".pa-item").evaluateAll((rows) =>
      rows.map((r) => {
        const label = r.querySelector(".pa-label")!.getBoundingClientRect();
        const icon = r.querySelector(".pa-type")?.getBoundingClientRect() ?? null;
        const title = r.querySelector(".pa-title")!.getBoundingClientRect();
        const bar = r.querySelector(".pa-bar")?.getBoundingClientRect() ?? null;
        const track = r.querySelector(".pa-track")!.getBoundingClientRect();
        return {
          level: Number(r.getAttribute("aria-level")),
          name: r.querySelector(".pa-title")!.textContent ?? "",
          iconX: icon ? Math.round(icon.left * 10) / 10 : null,
          label: { top: label.top, bottom: label.bottom, mid: (label.top + label.bottom) / 2 },
          title: { top: title.top, bottom: title.bottom, h: title.height },
          track: { top: track.top, bottom: track.bottom },
          bar: bar ? (bar.top + bar.bottom) / 2 : null,
        };
      }),
    );
  const expectAligned = async (page: Page, where: string) => {
    const g = await geometry(page);
    expect(g.length, where).toBeGreaterThan(3);
    for (const r of g) {
      expect(Math.abs(r.label.top - r.track.top), `${where}: ${r.name} label and track share a row`).toBeLessThan(1);
      expect(Math.abs(r.label.bottom - r.track.bottom), `${where}: ${r.name} label and track share a row`).toBeLessThan(1);
      expect(r.title.top, `${where}: ${r.name} title inside its row`).toBeGreaterThanOrEqual(r.label.top - 0.5);
      expect(r.title.bottom, `${where}: ${r.name} title inside its row`).toBeLessThanOrEqual(r.label.bottom + 0.5);
      if (r.bar !== null) expect(Math.abs(r.bar - r.label.mid), `${where}: ${r.name} bar centered on its label's row`).toBeLessThan(1.5);
    }
    return g;
  };
  const expectSameOffsets = async (page: Page, where: string) => {
    const g = await geometry(page);
    const by = new Map<number, Set<number | null>>();
    for (const r of g) by.set(r.level, (by.get(r.level) ?? new Set()).add(r.iconX));
    for (const [lvl, xs] of by) expect([...xs], `${where}: level ${lvl} icons share one left edge`).toHaveLength(1);
    // A fixed step per level.
    const x = (l: number) => [...(by.get(l) ?? [])][0] ?? null;
    if (x(1) !== null && x(2) !== null && x(3) !== null) expect(Math.abs(x(3)! - x(2)! - (x(2)! - x(1)!)), where).toBeLessThan(0.6);
  };

  it("type icons at every level, indentation by level only, nothing but the hierarchy in the label column", async () => {
    const { page, errors } = await open();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-1440.png` });
    await level(page, "Stories").click();
    await page.waitForTimeout(200);
    const rows = await page.locator(".pa-item").evaluateAll((els) =>
      els.map((r) => ({
        level: Number(r.getAttribute("aria-level")),
        aria: r.querySelector(".pa-label")!.getAttribute("aria-label") ?? "",
        type: r.querySelector(".pa-type")?.getAttribute("data-type") ?? null,
        fallback: !!r.querySelector(".pa-type.type-icon-fallback"),
        svgName: r.querySelector(".pa-type svg")?.getAttribute("aria-label") ?? null,
        text: (r.querySelector(".pa-label")!.textContent ?? "").replace(/[▸▾]/g, "").trim(),
        title: (r.querySelector(".pa-title")!.textContent ?? "").trim(),
        extras: r.querySelectorAll(".pa-label .ah-chip, .pa-label .pa-flags, .pa-label .pa-badge, .pa-label .ah-ro, .pa-label .pa-hours, .pa-label .rm-badge, .pa-label .ah-reach-unknown").length,
      })),
    );
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      // The icon is the type from the process model (the label names the same type), drawn, with its name.
      expect(r.type, r.title).toBeTruthy();
      expect(r.aria.startsWith(`${r.type} #`), r.title).toBe(true);
      expect(r.svgName, r.title).toBe(r.type);
      expect(r.fallback, `${r.title}: a known DevOps icon`).toBe(false);
      // Only the title: no pills, flags, counts or estimates.
      expect(r.extras, r.title).toBe(0);
      expect(r.text, r.title).toBe(r.title);
    }
    expect(new Set(rows.filter((r) => r.level === 1).map((r) => r.type))).toContain("Epic");
    expect(new Set(rows.filter((r) => r.level === 2).map((r) => r.type))).toEqual(new Set(["Feature"]));
    expect(rows.some((r) => r.level === 3)).toBe(true);
    // The same left edge for every icon at a level, with callouts on and off (and status in no way moving it).
    await expectSameOffsets(page, "callouts on");
    await page.getByRole("button", { name: "Show callouts" }).click();
    await expectSameOffsets(page, "callouts off");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("each label sits on its bar's row: two-line titles, Larger text, after folding, callouts hidden", async () => {
    // A narrow label column so titles wrap to two lines.
    const { page, errors } = await open({ width: 1440, height: 900 }, (p) => p.evaluate(() => localStorage.setItem("focustime.ahead.gantt.labelW", "200")));
    await level(page, "Stories").click();
    const g = await expectAligned(page, "2-line titles");
    const lineH = Math.min(...g.map((r) => r.title.h));
    expect(g.some((r) => r.title.h > lineH * 1.6), "some titles wrap to two lines").toBe(true);
    // Never more than two lines: the rest ends with an ellipsis, the full title and #id in the tooltip.
    for (const r of g) expect(r.title.h, r.name).toBeLessThan(lineH * 2.6);
    await expect(page.locator(".pa-item .pa-title").first().getAttribute("title")).resolves.toMatch(/\(#\d+\)$/);
    await shot(page, "after-2line");
    await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
    await page.waitForTimeout(300);
    await expectAligned(page, "Larger");
    await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
    await level(page, "Epics").click();
    await expectAligned(page, "Epics");
    await level(page, "Features").click();
    await row(page, "Order history export").locator(".pa-caret").click();
    await expectAligned(page, "a row expanded");
    await page.getByRole("button", { name: "Show callouts" }).click();
    await expectAligned(page, "callouts hidden");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the callout marker: its count, its popover lists them, each fix opens its flow; Show callouts hides them and is remembered", async () => {
    const { page, errors } = await open();
    const markers = page.locator(".pa-marker");
    const n = await markers.count();
    expect(n).toBeGreaterThan(0);
    const fixes = new Map<string, number>();
    let checked = 0;
    for (let i = 0; i < n; i++) {
      const m = markers.nth(i);
      const count = Number(await m.getAttribute("data-count"));
      await m.focus();
      const pop = page.locator(".pa-pop");
      await pop.waitFor({ timeout: 5_000 });
      // The count on the marker (shown past one) is the popover's list.
      await expect(pop.locator(".pa-pop-list li").count()).resolves.toBe(count);
      if (count > 1) await expect(m.locator(".pa-marker-n").textContent()).resolves.toBe(String(count));
      if (count === 1) await expect(m.locator(".pa-marker-n").count()).resolves.toBe(0);
      if (count) {
        const texts = await pop.locator(".pa-pop-text").allTextContents();
        const label = (await m.getAttribute("aria-label")) ?? "";
        for (const t of texts) expect(label).toContain(t.replace(/^.*?: (?=.)/s, "").slice(0, 12));
        checked++;
      }
      for (const f of await pop.locator("[data-fix]").evaluateAll((els) => els.map((e) => e.getAttribute("data-fix")!))) if (!fixes.has(f)) fixes.set(f, i);
      await page.keyboard.press("Escape");
      await pop.waitFor({ state: "hidden" });
    }
    expect(checked).toBeGreaterThan(0);
    // Hover opens it too.
    await markers.first().hover();
    await page.locator(".pa-pop").waitFor({ timeout: 5_000 });
    await shot(page, "marker-popover");
    await page.mouse.move(5, 500);
    await page.locator(".pa-pop").waitFor({ state: "hidden", timeout: 5_000 });
    // Each fix opens its flow: Break down the side panel, Set dates and Assign AH-5's editors.
    expect([...fixes.keys()]).toEqual(expect.arrayContaining(["breakdown", "dates"]));
    const runFix = async (fix: string) => {
      // A click opens it too (focus may already be on it, back from the last editor).
      await markers.nth(fixes.get(fix)!).click();
      await page.locator(`.pa-pop [data-fix="${fix}"]`).first().click();
    };
    await runFix("breakdown");
    await page.locator(".bd-panel").waitFor({ timeout: 10_000 });
    await page.locator(".bd-panel .bd-head").getByRole("button", { name: /close/i }).first().click();
    await page.locator(".bd-panel").waitFor({ state: "hidden" });
    await runFix("dates");
    await expect(page.locator(".cell-pop .cell-pop-title").textContent({ timeout: 5_000 })).resolves.toMatch(/^(Dates|Start date|Target date)$/);
    await page.keyboard.press("Escape");
    if (fixes.has("assignee")) {
      await runFix("assignee");
      await expect(page.locator(".cell-pop .cell-pop-title").textContent({ timeout: 5_000 })).resolves.toBe("Assigned to");
      await page.keyboard.press("Escape");
    }
    // Show callouts off: no markers, remembered after a reload.
    const toggle = page.getByRole("button", { name: "Show callouts" });
    await expect(toggle.getAttribute("aria-pressed")).resolves.toBe("true");
    await toggle.click();
    await expect.poll(() => page.locator(".pa-marker:visible").count()).toBe(0);
    await shot(page, "callouts-off");
    await page.reload();
    await page.evaluate(() => (location.hash = "#/ahead/gantt"));
    await page.locator(".pa-item").first().waitFor({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Show callouts" }).getAttribute("aria-pressed")).resolves.toBe("false");
    await expect(page.locator(".pa-marker:visible").count()).resolves.toBe(0);
    await page.getByRole("button", { name: "Show callouts" }).click();
    await shot(page, "callouts-on");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("levels: Epics, Features and Stories fold the tree; a roll-up spans its children with their count; carets work after a level; the choice is remembered", async () => {
    const { page, errors } = await open();
    const states = () => page.locator(".pa-item").evaluateAll((els) => els.map((e) => ({ level: Number(e.getAttribute("aria-level")), expanded: e.getAttribute("aria-expanded"), title: e.querySelector(".pa-title")!.textContent })));
    // Features (the default): epics open, features closed.
    await expect(level(page, "Features").getAttribute("aria-pressed")).resolves.toBe("true");
    let s = await states();
    for (const r of s) if (r.expanded !== null) expect(r.expanded, `${r.title}`).toBe(r.level === 1 ? "true" : "false");
    // Stories with no feature on screen are top rows at every level.
    const loose = s.filter((r) => r.level === 3).length;
    const epic = "Customer portal redesign";
    await shot(page, "level-features");
    await level(page, "Epics").click();
    s = await states();
    expect(s.every((r) => r.expanded !== "true")).toBe(true);
    expect(s.filter((r) => r.level === 3).length).toBe(loose);
    // The roll-up: its bar spans its children's bars, with their count.
    const roll = row(page, epic).locator(".pa-bar.rollup");
    const count = await roll.getAttribute("data-count");
    const rb = (await roll.boundingBox())!;
    const before = new Set(await page.locator(".pa-item .pa-title").allTextContents());
    await row(page, epic).locator(".pa-caret").click();
    const kids = await page.locator(".pa-item").evaluateAll((els, seen) => {
      const out = els.filter((e) => !seen.includes(e.querySelector(".pa-title")!.textContent ?? ""));
      const bars = out.map((e) => e.querySelector(".pa-bar:not(.rollup)")?.getBoundingClientRect()).filter((b): b is DOMRect => !!b);
      return { n: out.length, left: Math.min(...bars.map((b) => b.left)), right: Math.max(...bars.map((b) => b.right)) };
    }, [...before]);
    expect(kids.n).toBeGreaterThan(1);
    expect(count).toBe(`${kids.n} features`);
    expect(Math.abs(rb.x - kids.left)).toBeLessThan(1.5);
    expect(Math.abs(rb.x + rb.width - kids.right)).toBeLessThan(1.5);
    await row(page, epic).locator(".pa-caret").click();
    // Its marker combines what's under it.
    const own = Number(await row(page, epic).locator(".pa-marker").getAttribute("data-count"));
    expect(own).toBeGreaterThan(1);
    await shot(page, "level-epics");
    // A caret on top of the level.
    await row(page, epic).locator(".pa-caret").click();
    await expect(row(page, "Order history export").count()).resolves.toBe(1);
    await expect(row(page, epic).getAttribute("aria-expanded")).resolves.toBe("true");
    await level(page, "Stories").click();
    s = await states();
    for (const r of s) if (r.expanded !== null) expect(r.expanded, `${r.title}`).toBe("true");
    expect(s.some((r) => r.level === 3)).toBe(true);
    await shot(page, "level-stories");
    // A collapsed feature with its own dates keeps its bar; its stories' span is the bracket under it.
    await level(page, "Features").click();
    const bracket = row(page, "Order history export").locator(".pa-rollup-line");
    await expect(bracket.getAttribute("data-count")).resolves.toMatch(/^\d+ stor(y|ies)$/);
    await row(page, "Order history export").locator(".pa-caret").click();
    await expect(row(page, "Order history export").getAttribute("aria-expanded")).resolves.toBe("true");
    // Expand all and Collapse all in the control's menu.
    await page.locator(".ah-gantt-bar .ah-levels-more").click();
    await page.getByRole("menuitem", { name: "Collapse all" }).click();
    await expect.poll(async () => (await states()).every((r) => r.expanded !== "true")).toBe(true);
    // Remembered after a reload.
    await page.reload();
    await page.evaluate(() => (location.hash = "#/ahead/gantt"));
    await page.locator(".pa-item").first().waitFor({ timeout: 60_000 });
    await expect(level(page, "Epics").getAttribute("aria-pressed")).resolves.toBe("true");
    // The Grid has the same control, its own choice.
    await page.evaluate(() => (location.hash = "#/ahead"));
    await page.locator(".ah-row").first().waitFor({ timeout: 30_000 });
    const grid = page.locator(".ah-grid-bar .ah-levels");
    await expect(grid.getByRole("button", { name: "Stories", exact: true }).getAttribute("aria-pressed")).resolves.toBe("true");
    const all = await page.locator(".ah-row").count();
    await grid.getByRole("button", { name: "Epics", exact: true }).click();
    await expect.poll(() => page.locator(".ah-row").count()).toBeLessThan(all);
    await expect(page.locator(".ah-row.tier-story").count()).resolves.toBe(await page.locator(".ah-row.tier-story.depth-0").count());
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-epics.png` });
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("arrow caps for items past the timeline's edges, the date in their tooltip; an item with no bar in range keeps an aligned row", async () => {
    const { page, errors } = await open({ width: 1440, height: 900 }, async (p) => {
      // Store locator ends long after these 12 weeks; Knowledge base search ended before them.
      await call(p, "ahead.stage", { clientKey: "Northwind", itemId: 1150, field: "target", value: "2030-12-31" });
      await call(p, "ahead.stage", { clientKey: "Cooptimize", itemId: 4430, field: "start", value: "2026-08-03" });
      await call(p, "ahead.stage", { clientKey: "Cooptimize", itemId: 4430, field: "target", value: "2026-09-30" });
    });
    const capsAfter = await page.locator(".pa-capmark.after").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    const capsBefore = await page.locator(".pa-capmark.before").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    expect(capsAfter).toContain("Ends Dec 31, 2030");
    expect(capsBefore).toContain("Ended Sep 30");
    // No floating words: the old edge labels are gone.
    await expect(page.locator(".pa-beyond, .pa-before").count()).resolves.toBe(0);
    await expectAligned(page, "caps");
    await shot(page, "caps");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the label column resizes and is remembered", async () => {
    const { page } = await open();
    const w0 = (await page.locator(".pa-item .pa-label").first().boundingBox())!.width;
    const handle = page.locator(".pa-resize");
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 90, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await page.locator(".pa-item .pa-label").first().boundingBox())!.width).toBeGreaterThan(w0 + 80);
    const w1 = (await page.locator(".pa-item .pa-label").first().boundingBox())!.width;
    await page.reload();
    await page.evaluate(() => (location.hash = "#/ahead/gantt"));
    await page.locator(".pa-item").first().waitFor({ timeout: 60_000 });
    await expect.poll(async () => Math.round((await page.locator(".pa-item .pa-label").first().boundingBox())!.width)).toBe(Math.round(w1));
    await page.close();
  }, T);

  it("keyboard: Tab reaches the level control; Up and Down move between rows, Left collapses, Right expands", async () => {
    const { page } = await open();
    // The level control is in the tab order and works from the keyboard.
    const epics = level(page, "Epics");
    await epics.focus();
    await page.keyboard.press("Enter");
    await expect(epics.getAttribute("aria-pressed")).resolves.toBe("true");
    await level(page, "Features").focus();
    await page.keyboard.press("Space");
    await expect(level(page, "Features").getAttribute("aria-pressed")).resolves.toBe("true");
    // One tab stop for the tree: Tab from the level control lands on the first row after Show callouts.
    const first = page.locator(".pa-item > .pa-label").first();
    await expect(first.getAttribute("tabindex")).resolves.toBe("0");
    await expect(page.locator('.pa-item > .pa-label[tabindex="0"]').count()).resolves.toBe(1);
    const epicRow = row(page, "Customer portal redesign");
    await epicRow.locator(".pa-label").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(epicRow.getAttribute("aria-expanded")).resolves.toBe("false");
    await page.keyboard.press("ArrowRight");
    await expect(epicRow.getAttribute("aria-expanded")).resolves.toBe("true");
    await page.keyboard.press("ArrowDown");
    const focused = () => page.evaluate(() => document.activeElement?.closest(".pa-item")?.querySelector(".pa-title")?.textContent ?? null);
    const second = await focused();
    expect(second).not.toBe("Customer portal redesign");
    await page.keyboard.press("ArrowUp");
    await expect.poll(focused).toBe("Customer portal redesign");
    // Left on a child goes to its parent.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(focused).toBe("Customer portal redesign");
    await page.close();
  }, T);

  it("no native selects or date inputs anywhere in Ahead", async () => {
    const { page } = await open();
    for (const hash of ["#/ahead", "#/ahead/gantt", "#/ahead/fix", "#/ahead/backlog"]) {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.waitForTimeout(800);
      await expect(page.locator(".ahead select, .ahead input[type=date], .ahead input[type=datetime-local], .ahead input[type=month]").count(), hash).resolves.toBe(0);
    }
    await page.close();
  }, T);

  it("screens: 1920, Larger text", async () => {
    const { page, errors } = await open({ width: 1920, height: 1080 });
    await shot(page, "after-1920");
    await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "large"));
    await page.waitForTimeout(300);
    await expectAligned(page, "Large");
    await shot(page, "after-1920-large");
    await page.close();
    const small = await open({ width: 1440, height: 900 });
    await small.page.evaluate(() => document.documentElement.setAttribute("data-text-size", "large"));
    await small.page.waitForTimeout(300);
    await expectAligned(small.page, "1440 Large");
    await shot(small.page, "after-1440-large");
    await small.page.close();
    expect(errors).toEqual([]);
  }, T);
});
