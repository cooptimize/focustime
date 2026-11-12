// WK-5: Week makes room for today, measured in the browser on the demo's Thursday (e2e/wk5-states.ts). At 1280, 1440
// and 1920, Cards and Timeline, the block panel closed and open, every day shown and the catch-up day and weekend
// hidden, Default and Larger text: every to-do title in an open day has at least its readable width, a Week card's
// time sits under its title (never beside it) on one line, no header text is cut to under three characters, the day in
// focus is the widest column and no two columns overlap. A folded day opens on a click and on Enter. Hiding the
// catch-up day from Week's ⋯ survives a reload, the note counts a to-do moved onto it, and Show brings it back.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { buildWk5, WK5_CLOCK, WK5_FRIDAY, WK5_TODAY } from "./wk5-states.ts";
import { call } from "./sg1-helpers.ts";

const T = 600_000;
const SIZES = [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }];
/** A to-do title's narrowest width, in CSS px at Default text: about twelve characters (ui/weekfit.ts MIN_PX). */
const TITLE_MIN = 80;

async function layout(page: Page, which: "Cards" | "Timeline") {
  const b = page.locator(".week-head .day-switch button", { hasText: which }).first();
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
  await page.waitForTimeout(400);
}
const larger = (page: Page, on: boolean) =>
  page.evaluate((v) => (v ? document.documentElement.setAttribute("data-text-size", "larger") : document.documentElement.removeAttribute("data-text-size")), on);
const panel = (page: Page) => page.locator("aside.block-panel");
async function openToday(page: Page) {
  await page.locator(".day.today .half.focus .card-head").first().click({ position: { x: 4, y: 4 } });
  await panel(page).waitFor();
}
async function closePanel(page: Page) {
  for (let i = 0; i < 2 && (await panel(page).count()); i++) await page.keyboard.press("Escape");
  await panel(page).waitFor({ state: "detached" });
}
/** Waits out the columns' 180 ms ease. */
const settle = (page: Page) => page.waitForTimeout(450);

type Problem = string;
/** Every measured rule, on the grid as it stands; returns what broke. */
function measure(page: Page, titleMin: number): Promise<Problem[]> {
  return page.evaluate((min) => {
    const out: string[] = [];
    /** The boxes of an element's text, line by line. */
    const textRects = (el: Element): DOMRect[] => {
      const rects: DOMRect[] = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!(n.textContent ?? "").trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        rects.push(...[...rg.getClientRects()].filter((r) => r.width > 0));
      }
      return rects;
    };
    /** How many lines an element's text takes (boxes whose vertical middles are within half a line), and its top. */
    const lines = (el: Element) => {
      const rs = textRects(el).sort((a, b) => a.top - b.top);
      const mids: number[] = [];
      for (const r of rs) {
        const m = (r.top + r.bottom) / 2;
        if (!mids.some((x) => Math.abs(x - m) < r.height / 2)) mids.push(m);
      }
      return { count: mids.length, top: rs.length ? Math.min(...rs.map((r) => r.top)) : Infinity };
    };
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-scale")) || 1;
    const grid = document.querySelector<HTMLElement>("main.grid")!;
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.push(`page scrolls sideways (${de.scrollWidth} > ${de.clientWidth})`);
    const cols = [...grid.querySelectorAll<HTMLElement>(":scope > section.day")];
    const label = (c: HTMLElement) => c.getAttribute("aria-label") ?? "?";
    // No overlap, and clear of the panel.
    const pl = document.querySelector("aside.block-panel")?.getBoundingClientRect().left ?? Infinity;
    cols.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      if (r.right > pl + 0.5) out.push(`${label(c)} under the panel`);
      const next = cols[i + 1]?.getBoundingClientRect();
      if (next && r.right > next.left + 0.5) out.push(`${label(c)} overlaps the next day`);
    });
    // The day in focus is the widest.
    const focus = grid.getAttribute("data-focus-day");
    if (focus) {
      const f = cols.find((c) => !c.classList.contains("folded") && c.querySelector(`[data-drop^="${focus}:"]`));
      if (!f) out.push(`the day in focus (${focus}) isn't an open column`);
      const fw = f?.getBoundingClientRect().width ?? 0;
      for (const c of cols) if (c !== f && c.getBoundingClientRect().width > fw + 0.5) out.push(`${label(c)} wider than the day in focus`);
    }
    for (const c of cols) {
      if (c.classList.contains("folded")) continue;
      // Titles keep their readable width; the time is under the title, on one line.
      for (const row of c.querySelectorAll<HTMLElement>(".half .pick-row.dens-week")) {
        const title = row.querySelector<HTMLElement>(".pr-title");
        if (!title || !title.offsetParent) continue;
        const name = (title.textContent ?? "").slice(0, 24);
        const tw = title.getBoundingClientRect().width;
        if (tw < min * scale - 0.5) out.push(`${label(c)}: "${name}" only ${Math.round(tw)} px wide`);
        if (!row.classList.contains("form-stack")) out.push(`${label(c)}: "${name}" isn't in Week's stacked form`);
        const time = row.querySelector<HTMLElement>(".pr-meta .pt-time");
        if (time && time.offsetParent) {
          // The text's own boxes (the button reaches above and below its line for a full tap target).
          const tLines = lines(time);
          // A title is two lines at most: text past its clamp is hidden, so its own box ends it.
          const titleBottom = Math.min(title.getBoundingClientRect().bottom, Math.max(...textRects(title).map((r) => r.bottom)));
          if (tLines.top < titleBottom - 1) out.push(`${label(c)}: "${name}" has its time beside the title`);
          if (tLines.count > 1) out.push(`${label(c)}: "${name}" time on ${tLines.count} lines`);
        }
      }
    }
    // No header text cut to under three characters (a day's header, a card's header).
    const leaves = [...grid.querySelectorAll<HTMLElement>(".day-head *, .card-head .card-client, .card-head .card-when")].filter((e) => e.offsetParent && e.children.length === 0 && (e.textContent ?? "").trim().length > 0);
    for (const e of leaves) {
      const text = (e.textContent ?? "").trim();
      if (e.scrollWidth <= e.clientWidth + 1) continue;
      const shown = Math.floor(text.length * (e.clientWidth / e.scrollWidth));
      if (shown < Math.min(3, text.length)) out.push(`"${text}" cut to ${shown} characters`);
    }
    return out;
  }, titleMin);
}

describe.skipIf(!CHROMIUM)("WK-5: Week makes room for today (browser, demo Thursday)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, WK5_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  for (const size of SIZES)
    it(`${size.width}: titles readable, times under titles on one line, headers whole, the focus day widest, no overlap`, async () => {
      const { page, errors } = await freshPage(h, size);
      await buildWk5(page);
      await page.evaluate(() => (location.hash = "#/week"));
      await page.locator("main.grid").waitFor();
      const broken: string[] = [];
      for (const hide of [false, true]) {
        await call(page, "ui.set_week_days", { catchUp: !hide, weekend: !hide });
        await page.reload();
        await page.locator("main.grid").waitFor({ timeout: 60_000 });
        if (hide) {
          await expect(page.locator(`main.grid [data-drop^="${WK5_FRIDAY}:"]`).count()).resolves.toBe(0);
          await expect(page.locator(".hidden-days-note").innerText()).resolves.toMatch(/hidden · \d+ to-dos?/);
        }
        for (const which of ["Cards", "Timeline"] as const) {
          await layout(page, which);
          for (const big of [false, true]) {
            await larger(page, big);
            for (const withPanel of [false, true]) {
              if (withPanel) await openToday(page);
              await settle(page);
              const at = `${which}, ${hide ? "days hidden" : "all days"}, ${big ? "Larger" : "Default"}${withPanel ? ", panel" : ""}`;
              for (const p of await measure(page, TITLE_MIN)) broken.push(`${at}: ${p}`);
              // Today is in focus (the panel is on today's block).
              await expect(page.locator("main.grid").getAttribute("data-focus-day")).resolves.toBe(WK5_TODAY);
              if (withPanel) await closePanel(page);
            }
          }
          await larger(page, false);
        }
      }
      await call(page, "ui.set_week_days", { catchUp: true, weekend: true });
      expect(broken).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }, T);

  it("a folded day opens on a click and on Enter, and takes the focus", async () => {
    const { page, errors } = await freshPage(h, { width: 1280, height: 720 });
    await buildWk5(page);
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator("main.grid").waitFor();
    await larger(page, true);
    await settle(page);
    const grid = page.locator("main.grid");
    const folded = grid.locator(":scope > section.day.folded");
    expect(await folded.count()).toBeGreaterThan(0);
    // The screen reader name says the day, its blocks and their counts.
    const first = folded.first().locator(".fold-open");
    await expect(first.getAttribute("aria-label")).resolves.toMatch(/^\w{3} \w{3} \d+.*: .+, \d+ to-dos?.*\. Open \w+day$/);
    // A click: that day opens and takes the focus; today stays open.
    const label = (await folded.first().getAttribute("aria-label"))!;
    await first.click();
    await settle(page);
    await expect(grid.locator(`:scope > section.day[aria-label="${label}"]`).count()).resolves.toBe(0);
    const focus1 = await grid.getAttribute("data-focus-day");
    expect(focus1).not.toBe(WK5_TODAY);
    expect(await measure(page, TITLE_MIN)).toEqual([]);
    // Enter on another folded day's header does the same.
    const other = grid.locator(":scope > section.day.folded .fold-open").first();
    await other.focus();
    await page.keyboard.press("Enter");
    await settle(page);
    await expect.poll(() => grid.getAttribute("data-focus-day")).not.toBe(focus1);
    expect(await measure(page, TITLE_MIN)).toEqual([]);
    await larger(page, false);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("hide the catch-up day from Week's ⋯: still hidden after a reload, the note counts a to-do moved there, Show brings it back", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await buildWk5(page);
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator("main.grid").waitFor();
    const friday = page.locator(`main.grid [data-drop^="${WK5_FRIDAY}:"]`);
    expect(await friday.count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "View options for Week" }).click();
    await page.getByRole("menuitem", { name: /^Show Friday/ }).click();
    await expect.poll(() => friday.count()).toBe(0);
    await page.reload();
    await page.locator("main.grid").waitFor({ timeout: 60_000 });
    await expect(friday.count()).resolves.toBe(0);
    const note = page.locator(".hidden-days-note");
    await expect(note.innerText()).resolves.toMatch(/^Fri hidden · 1 to-do\b/);
    // A to-do from today goes onto Friday (its ⋯ Move, here the same action): the note counts it.
    const w = (await call(page, "week.load", {})).data as { plan?: Record<string, { picks: { id: number; status: string; half: string }[] }> };
    const todo = w.plan?.[WK5_TODAY]?.picks.find((p) => p.status === "planned" && p.half === "PM")!;
    expect((await call(page, "pick.move", { id: todo.id, date: WK5_FRIDAY, half: "AM" })).ok).toBe(true);
    await page.reload();
    await page.locator("main.grid").waitFor({ timeout: 60_000 });
    await expect(note.innerText()).resolves.toMatch(/^Fri hidden · 2 to-dos\b/);
    // Show: Friday is back for this visit, the note gone; the setting is unchanged (hidden again after leaving Week).
    await note.getByRole("button", { name: /Show the hidden days/ }).click();
    await expect.poll(() => friday.count()).toBeGreaterThan(0);
    await expect(note.count()).resolves.toBe(0);
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    await page.locator("main.grid").waitFor();
    await expect.poll(() => friday.count()).toBe(0);
    // Back on from the menu.
    await page.getByRole("button", { name: "View options for Week" }).click();
    await page.getByRole("menuitem", { name: /^Show Friday/ }).click();
    await expect.poll(() => friday.count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
