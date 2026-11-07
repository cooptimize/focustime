// WK-2: the Board's Timeline toggle and per-column tiers, in demo mode with the clock on Friday Nov 6 2026 10:00 AM ET
// (Friday is today and the catch-up day, Thursday is PTO) and Friday given working hours (9:00 to 1:00), as on dev.
// The toggle: one click (the header button, B, Week's ⋯, the command menu), remembered after a reload. Hidden: cards are
// full width, the now line shows, meetings are lines, drag and drop works. Shown: each column takes its own tier; no
// column header cuts a word or a number; an overdue promise's label never overlaps the now line's time.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 240_000;
const FRI = "2026-11-06";
const MON_AM = '[data-drop="2026-11-02:AM"]';
const FRI_AM = `[data-drop="${FRI}:AM"]`;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>;

/** Week's Board, reloaded so what the test set through the API (Friday's hours, the toggle) is what the page shows. */
async function board(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = "#/week"));
  await page.reload();
  await page.locator("main.grid").waitFor();
  await page.locator(`main.grid ${FRI_AM}`).waitFor();
}

const hidden = (page: Page) => page.locator("main.grid").getAttribute("class").then((c) => (c ?? "").includes("no-timeline"));
const toggle = (page: Page) => page.locator(".week-head .tl-toggle");

async function openPanel(page: Page): Promise<void> {
  await page.locator(`main.grid ${MON_AM}`).click({ position: { x: 14, y: 12 } });
  await page.locator("aside.detail-panel").waitFor();
  await page.waitForTimeout(300);
}

/**
 * Every visible text in the column headers (day headers and card headers): not clipped by its header, not truncated
 * (no ellipsis, no clamp hiding lines), and no word or number split across two lines.
 */
async function headersWhole(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    };
    const els = [...document.querySelectorAll("main.grid .day-head .dow, main.grid .day-head .date, main.grid .day-head .today-pill, main.grid .day-head .pto-pill, main.grid .day-head .day-plan, main.grid .card-head .card-client, main.grid .card-head .card-when, main.grid .whole-label")].filter(visible);
    for (const el of els) {
      const head = el.closest(".day-head, .card-head, .half")!;
      const r = el.getBoundingClientRect();
      const h = head.getBoundingClientRect();
      const name = `${el.className}: "${(el.textContent ?? "").trim()}"`;
      if (r.right > h.right + 0.5 || r.left < h.left - 0.5) bad.push(`${name} clipped by its header`);
      // Truncated: an ellipsis or a clamp hides part of it.
      const leaf = [el, ...el.querySelectorAll("*")].filter((x) => visible(x) && getComputedStyle(x).overflow !== "visible");
      for (const x of leaf) if (x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 1) bad.push(`${name} truncated`);
      // Each word (or number) of each visible text node sits on one line.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement!;
        if (!visible(parent)) continue;
        const text = n.textContent ?? "";
        for (const m of text.matchAll(/[^\s–]+/g)) {
          const range = document.createRange();
          range.setStart(n, m.index!);
          range.setEnd(n, m.index! + m[0].length);
          const lines = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
          if (lines.size > 1) bad.push(`${name} splits "${m[0]}"`);
        }
      }
    }
    return bad;
  });
}

/** An overdue promise's label and the now line's time on the same rail never overlap. */
async function promiseClearOfNow(page: Page): Promise<number> {
  return page.evaluate(() => {
    let checked = 0;
    for (const rail of document.querySelectorAll("main.grid .ruler")) {
      const pill = rail.querySelector(".now-line .nl-pill")?.getBoundingClientRect();
      if (!pill) continue;
      for (const s of rail.querySelectorAll(".r-promise span")) {
        const b = s.getBoundingClientRect();
        if (b.width === 0 || getComputedStyle(s).display === "none") continue;
        checked++;
        const overlap = b.left < pill.right && pill.left < b.right && b.top < pill.bottom && pill.top < b.bottom;
        if (overlap) throw new Error(`promise label "${s.textContent}" overlaps the now line's time`);
      }
    }
    return checked;
  });
}

describe.skipIf(!CHROMIUM)("WK-2: the Board's Timeline toggle and per-column tiers", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, `${FRI}T10:00:00-05:00`);
  }, T);
  afterAll(async () => h?.stop());

  it("the toggle hides and shows the timeline in one click, from the button, B, Week's ⋯ and the command menu, and is remembered", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "hours.set_day", { date: FRI, segments: ["09:00-13:00"] })).ok).toBe(true);
    await board(page);
    await expect(hidden(page)).resolves.toBe(false);
    await expect(toggle(page).getAttribute("aria-pressed")).resolves.toBe("true");
    await expect(toggle(page).getAttribute("title")).resolves.toBe("Hide timeline (B)");

    // The button: one click hides, one shows.
    await toggle(page).click();
    await expect.poll(() => hidden(page)).toBe(true);
    await expect(toggle(page).getAttribute("title")).resolves.toBe("Show timeline (B)");
    await expect(page.locator("main.grid .ruler, main.grid .day-strip").count()).resolves.toBe(0);
    // Remembered after a reload.
    await page.reload();
    await page.locator("main.grid").waitFor();
    await expect.poll(() => hidden(page)).toBe(true);
    await toggle(page).click();
    await expect.poll(() => hidden(page)).toBe(false);

    // B (not while typing).
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("b");
    await expect.poll(() => hidden(page)).toBe(true);
    await page.keyboard.press("b");
    await expect.poll(() => hidden(page)).toBe(false);

    // Week's ⋯: "Timeline", checked while shown.
    await page.getByRole("button", { name: "View options for Week" }).click();
    const item = page.locator(".popup-menu .menu-item", { hasText: "Timeline" }).last();
    await expect(item.getAttribute("class")).resolves.toContain("checked");
    await item.click();
    await expect.poll(() => hidden(page)).toBe(true);

    // The command menu.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Timeline");
    await page.getByRole("menuitem", { name: /^Timeline(?!s)/ }).first().click();
    await expect.poll(() => hidden(page)).toBe(false);
    expect((await call(page, "week.load", {})).data.ui.showTimelines).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("hidden: full-width cards, the now line on today, meetings as lines, and drag and drop as before", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "hours.set_day", { date: FRI, segments: ["09:00-13:00"] })).ok).toBe(true);
    expect((await call(page, "ui.set_show_timelines", { show: false })).ok).toBe(true);
    await board(page);
    await expect.poll(() => hidden(page)).toBe(true);
    // Full width: the card's list fills the card (no rail's margin).
    const widths = await page.locator(`main.grid ${MON_AM}`).evaluate((card) => {
      const body = card.querySelector(".card-body")!.getBoundingClientRect();
      return { card: card.getBoundingClientRect().width, body: body.width };
    });
    expect(widths.body).toBeGreaterThan(widths.card - 40);
    // The now line on Friday's block under way.
    await expect(page.locator(`main.grid ${FRI_AM} .now-line`).count()).resolves.toBe(1);
    await expect(page.locator(`main.grid ${FRI_AM} .now-line .nl-pill`).textContent()).resolves.toBe("10:00");
    // Meetings as lines with their time.
    const lines = page.locator(`main.grid ${MON_AM} .card-events li`);
    await expect(lines.count()).resolves.toBeGreaterThan(0);
    await expect(lines.first().locator(".ce-time").textContent()).resolves.toMatch(/^\d{1,2}:\d\d–\d{1,2}:\d\d$/);
    // Drag a story from the detail panel onto Friday (today), as with the timeline shown.
    await openPanel(page);
    const pick = page.locator("aside.detail-panel .ps-row[data-story][draggable='true']").first();
    await pick.waitFor();
    // As WK-1's drag (D858): over each day, nudging the pointer while it rests, so the target answers.
    const a = (await pick.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
    for (const date of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", FRI]) {
      const target = page.locator(`main.grid [data-drop="${date}:AM"]`);
      const b = (await target.boundingBox())!;
      const at = { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 60) };
      await page.mouse.move(at.x, at.y, { steps: 6 });
      await expect.poll(async () => {
        await page.mouse.move(at.x + 1, at.y + 1);
        await page.mouse.move(at.x, at.y);
        return (await target.locator(".drop-tip").count()) > 0 && /drop-(over|no)/.test((await target.getAttribute("class")) ?? "");
      }, { message: `${date} answers the drag` }).toBe(true);
    }
    await page.mouse.up();
    await page.locator(".undo-toast", { hasText: /^Added to Fri/ }).waitFor();
    // The new to-do sits in Friday's list.
    await expect.poll(() => page.locator(`main.grid ${FRI_AM} .checklist li`).count()).toBeGreaterThan(0);
    expect((await call(page, "ui.set_show_timelines", { show: true })).ok).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("2560: Friday keeps the rail with titles, and the overdue promise's label at now clears the now line's time", async () => {
    const { page, errors } = await freshPage(h, { width: 2560, height: 1440 });
    expect((await call(page, "hours.set_day", { date: FRI, segments: ["09:00-13:00"] })).ok).toBe(true);
    expect((await call(page, "ui.set_show_timelines", { show: true })).ok).toBe(true);
    await board(page);
    await page.locator(`main.grid ${FRI_AM} .ruler:not(.slim) .r-promise`).first().waitFor();
    await expect(promiseClearOfNow(page)).resolves.toBeGreaterThan(0);
    await expect(headersWhole(page)).resolves.toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  const SIZES = [[1920, 1080], [1896, 1000], [1366, 768]] as const;
  for (const [width, height] of SIZES)
    for (const panel of [false, true])
      for (const shown of [true, false])
        it(`${width}${panel ? ", panel open" : ""}, timeline ${shown ? "shown" : "hidden"}: columns take their own tier; no header text is cut; promises clear the now line`, async () => {
          const { page, errors } = await freshPage(h, { width, height });
          expect((await call(page, "hours.set_day", { date: FRI, segments: ["09:00-13:00"] })).ok).toBe(true);
          expect((await call(page, "ui.set_show_timelines", { show: shown })).ok).toBe(true);
          await board(page);
          if (panel) await openPanel(page);
          const grid = page.locator("main.grid");
          const days = grid.locator(":scope > section.day:not(.folded)");
          if (shown) {
            // Each open column's tier is the one its own width calls for.
            const tiers = await days.evaluateAll((els) =>
              els.map((d) => {
                const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-scale")) || 1;
                const w = d.getBoundingClientRect().width / scale;
                const want = w >= 320 ? "rail" : w >= 250 ? "ruler" : w >= 170 ? "strip" : "mini";
                const has = /tier-(rail|ruler|strip|mini)/.exec(d.className)?.[1] ?? null;
                return { label: d.getAttribute("aria-label"), w: Math.round(w), want, has };
              }),
            );
            for (const t of tiers) expect(t.has, `${t.label} (${t.w} px)`).toBe(t.want);
            // Friday (narrower than Monday) never draws a wider tier than Monday.
            const order = ["rail", "ruler", "strip", "mini"];
            const mon = tiers.find((t) => t.label?.startsWith("Monday"));
            const fri = tiers.find((t) => t.label?.startsWith("Friday"));
            if (mon && fri) expect(order.indexOf(fri.has!)).toBeGreaterThanOrEqual(order.indexOf(mon.has!));
            // Friday's card draws exactly its tier's element.
            if (fri) {
              const el = fri.has === "rail" ? ".ruler:not(.slim)" : fri.has === "ruler" ? ".ruler.slim" : ".day-strip";
              await expect(grid.locator(`${FRI_AM} ${el}`).count()).resolves.toBe(1);
            }
            await promiseClearOfNow(page);
          }
          await expect(headersWhole(page)).resolves.toEqual([]);
          // "+ Add to-do", never "+ Add work".
          await expect(grid.locator(".add-work").first().textContent()).resolves.toBe("+ Add to-do");
          await expect(page.getByText("Add work", { exact: false }).count()).resolves.toBe(0);
          expect(errors).toEqual([]);
          await page.close();
        }, T);
});
