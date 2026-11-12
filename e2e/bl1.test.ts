// BL-1, measured in demo mode: at 1440×900 and 1280×720 the first row of data starts within about 200 px of the top;
// the filters are one row; the chevron is at least 16 px with a target the row's full height and at least 28 px wide;
// Left and Right fold and unfold; no cell shows a dash; a row never shows two chips that mean one thing; selecting rows
// shows the bulk bar and its actions stage changes; Needs attention shows only rows with a fix, each with its action.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 120_000;
const LIMIT = 200;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const;

describe.skipIf(!CHROMIUM)("BL-1: Backlog, measured (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async (hash: string, viewport: { width: number; height: number } = VIEWPORTS[0]) => {
    const { page, errors } = await freshPage(h, viewport);
    await page.evaluate((x) => (location.hash = x), hash);
    await page.locator(".ah-toolbar").waitFor({ timeout: 60_000 });
    await page.locator(".ah-grid tbody .ah-row, .pa-item").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(300);
    return { page, errors };
  };
  const firstRowTop = (page: Page) =>
    page.evaluate(() => {
      const r = document.querySelector(".ah-grid tbody .ah-row, .pa-item")?.getBoundingClientRect();
      return r ? Math.round(r.top) : null;
    });

  it("the first row of data starts within about 200 px at 1440×900 and 1280×720, with one row of filters", async () => {
    for (const vp of VIEWPORTS) {
      const { page, errors } = await open("#/backlog", vp);
      const top = await firstRowTop(page);
      expect(top, `${vp.width}×${vp.height}`).not.toBeNull();
      expect(top!, `${vp.width}×${vp.height}: the first row at ${top}px`).toBeLessThanOrEqual(LIMIT);
      // One row: every control in the toolbar's row sits on one line.
      const tops = await page.locator(".ah-toolbar .ah-tb-row").first().evaluate((row) =>
        [...row.querySelectorAll("button, input")]
          .filter((e) => !e.closest("[hidden]") && (e as HTMLElement).offsetParent !== null && !e.closest(".ah-tb-summary"))
          .map((e) => {
            const r = e.getBoundingClientRect();
            return Math.round(r.top + r.height / 2);
          }),
      );
      expect(tops.length).toBeGreaterThan(4);
      expect(Math.max(...tops) - Math.min(...tops), `${vp.width}: the filters wrap`).toBeLessThanOrEqual(6);
      await expect(page.locator(".ah-toolbar .ah-tb-row").count()).resolves.toBe(1);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, T);

  it("the chevron: at least 16 px, the row's full height, at least 28 px wide; Left and Right fold the focused row", async () => {
    const { page, errors } = await open("#/backlog");
    const row = page.locator(".ah-grid tbody .ah-row", { has: page.locator(".ah-chev") }).first();
    const chev = row.locator(".ah-chev");
    const [svg, btn, cell] = await Promise.all([chev.locator("svg").boundingBox(), chev.boundingBox(), row.locator(".ah-col-item").boundingBox()]);
    expect(svg!.width).toBeGreaterThanOrEqual(16);
    expect(svg!.height).toBeGreaterThanOrEqual(16);
    expect(btn!.width).toBeGreaterThanOrEqual(28);
    // The target fills the row's height (the cell's, less its 1px border).
    expect(btn!.height).toBeGreaterThanOrEqual(cell!.height - 2);
    // On hover it takes the normal text color.
    await chev.hover();
    const [hover, text] = await page.evaluate(() => [getComputedStyle(document.querySelector(".ah-grid .ah-chev")!).color, getComputedStyle(document.body).color]);
    expect(hover).toBe(text);
    // Left closes, Right opens: the focused row's own control.
    const key = await row.getAttribute("data-key");
    const was = await chev.getAttribute("aria-expanded");
    await row.locator(".ah-col-item").focus();
    await page.keyboard.press(was === "true" ? "ArrowLeft" : "ArrowRight");
    await expect.poll(() => page.locator(`.ah-row[data-key="${key}"] .ah-chev`).getAttribute("aria-expanded")).toBe(was === "true" ? "false" : "true");
    await page.keyboard.press(was === "true" ? "ArrowRight" : "ArrowLeft");
    await expect.poll(() => page.locator(`.ah-row[data-key="${key}"] .ah-chev`).getAttribute("aria-expanded")).toBe(was);
    // The Gantt draws the same control.
    await page.evaluate(() => (location.hash = "#/backlog/gantt"));
    const g = page.locator(".pa-label .ah-chev").first();
    await g.waitFor({ timeout: 30_000 });
    const gb = (await g.boundingBox())!;
    expect(gb.width).toBeGreaterThanOrEqual(28);
    expect((await g.locator("svg").boundingBox())!.width).toBeGreaterThanOrEqual(16);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("no cell shows a dash, and a row never shows two chips that mean one thing", async () => {
    const { page, errors } = await open("#/backlog");
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    await page.waitForTimeout(300);
    const dashes = await page.locator(".ah-grid tbody td").evaluateAll((tds) => tds.map((t) => (t.textContent ?? "").trim()).filter((t) => /^[-–—]$/.test(t)));
    expect(dashes).toEqual([]);
    // One status chip per row; its other reasons ("+2") and the State column never repeat it.
    const doubles = await page.locator(".ah-grid tbody .ah-row").evaluateAll((rows) =>
      rows.flatMap((r) => {
        const main = [...r.querySelectorAll(".ah-col-status .ah-chip:not(.ah-more)")].map((c) => (c.textContent ?? "").trim());
        const more = [...r.querySelectorAll(".ah-col-status .ah-more-list > span")].map((c) => (c.textContent ?? "").split(":")[0]!.trim());
        const state = (r.querySelector(".ah-state")?.textContent ?? "").trim();
        const said = [...main, ...more, ...(state ? [state] : [])].map((t) => t.toLowerCase());
        return main.length <= 1 && new Set(said).size === said.length ? [] : [`${r.getAttribute("data-key")}: ${said.join(", ")}`];
      }),
    );
    await expect(page.locator(".ah-grid tbody .ah-col-status .ah-chip:not(.ah-more)").count()).resolves.toBeGreaterThan(0);
    expect(doubles).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("selecting rows shows the bulk bar, and its actions stage changes (nothing written before Save)", async () => {
    const { page, errors } = await open("#/backlog");
    const writes: string[] = [];
    page.on("request", (r) => {
      if (/"action":"devops\.(preview|confirm)"/.test(r.postData() ?? "")) writes.push(r.postData()!);
    });
    await expect(page.locator(".bl-bulk").count()).resolves.toBe(0);
    const pending = async () => Number(/(\d+) changes?/.exec((await page.locator(".ah-pending").textContent().catch(() => "")) ?? "")?.[1] ?? 0);
    const before = await pending();
    const ticks = page.locator(".ah-grid tbody .ah-row:not(.ro) input[type=checkbox]");
    await ticks.nth(0).click({ force: true });
    await ticks.nth(1).click({ force: true });
    await expect(page.locator(".bl-bulk strong").textContent()).resolves.toBe("2 selected");
    await page.locator(".bl-bulk").getByRole("button", { name: "2 weeks" }).click();
    await page.locator(".bl-result").waitFor();
    await expect.poll(pending).toBeGreaterThan(before);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Needs attention shows only rows with a fix, each with its action", async () => {
    const { page, errors } = await open("#/backlog/attention");
    await page.locator(".ah-att-line").waitFor({ timeout: 30_000 });
    const entries = page.locator(".ah-client .ah-row:not(.context)");
    await expect.poll(() => entries.count()).toBeGreaterThan(0);
    const missing = await entries.evaluateAll((rows) => rows.filter((r) => !r.querySelector(".ah-fix button")).map((r) => r.getAttribute("data-key")));
    expect(missing).toEqual([]);
    // Every entry has a reason in its Status.
    const quiet = await entries.evaluateAll((rows) => rows.filter((r) => /nothing to fix/.test(r.querySelector(".ah-col-status")?.getAttribute("aria-label") ?? "nothing to fix")).map((r) => r.getAttribute("data-key")));
    expect(quiet).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
