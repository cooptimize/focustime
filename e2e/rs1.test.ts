// RS-1: the restyle, measured rather than looked at, on the demo, in each theme and at each text size: every button is
// one of the shapes the style guide names (a pill 32 or 28 high, a round icon button, a switch's side, a chip, a row, a
// link); the tabs have no box, an icon each and the accent wash on the active one; a switch is a track with a lifted
// side; no control's text is a character standing in for an icon; every icon-only button has a name; a status pill
// has no line and a chip you press does; list rows in the Inbox, the block panel and the Backlog have no border of
// their own; and a block card still has its client edge and border, the selected one its ring. The top bar stays one
// row down to 1024 px. Demo data only (e2e/ps1-states.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { buildState, PS_CLOCK } from "./ps1-states.ts";

const T = 600_000;
const THEMES = ["cooptimize-dark", "cooptimize-light", "neutral"] as const;
const SIZES = [["default", 1], ["large", 1.1538], ["larger", 1.3077]] as const;
/** A character that used to stand in for an icon (back, next, more, add, close, folds, done, a drag handle). */
const MARKS = /^[‹›⋯×✕▸▾▴✓✗⋮+−]+$|^[▸▾✓✗+×] |[⋯▸▾⋮]$/u;

const go = async (page: Page, hash: string, wait = 1100) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
async function look(page: Page, theme: string, size: string) {
  await page.evaluate(([t, s]) => {
    document.documentElement.setAttribute("data-theme", t!);
    if (s === "default") document.documentElement.removeAttribute("data-text-size");
    else document.documentElement.setAttribute("data-text-size", s!);
  }, [theme, size] as const);
  await page.emulateMedia({ colorScheme: theme === "cooptimize-light" ? "light" : "dark" });
  await page.waitForTimeout(350);
}

/** Every button in view that isn't one of the shapes, with why. */
const oddButtons = (page: Page, scale: number) =>
  page.evaluate((scale) => {
    const out: string[] = [];
    const near = (a: number, b: number) => Math.abs(a - b) <= 1.2;
    const clear = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
    const [big, small] = [32 * scale, 28 * scale];
    for (const el of document.querySelectorAll<HTMLElement>("button")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || !el.checkVisibility({ opacityProperty: false, visibilityProperty: true })) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      // Not controls of this step: the brand's home mark and the demo tag, things drawn by time on a rail or timeline
      // (their height is their length), a Gantt bar's marker, the status bar's dot, color swatches.
      if (el.closest(".brand-home, .demo-tag, .tbox, .event, .r-ev, .r-promise, .now-line, .nl-time, .pa-marker, .pa-bar, .status-quiet, .statusbar, .adm-swatches, .color-slots, .day-tab")) continue;
      const cs = getComputedStyle(el);
      const radius = parseFloat(cs.borderTopLeftRadius);
      const pct = cs.borderTopLeftRadius.endsWith("%");
      const lined = parseFloat(cs.borderTopWidth) > 0 && !clear(cs.borderTopColor) && cs.borderTopStyle !== "none";
      const h = r.height;
      const round = (pct || radius >= h / 2 - 1) && near(r.width, h);
      const pill = pct || radius >= h / 2 - 1;
      const what = `${String(el.className).trim().split(/\s+/).slice(0, 3).join(".") || `(in .${String(el.parentElement?.className).split(" ")[0]})`} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(h)} r${cs.borderTopLeftRadius}`;
      // A link in a sentence, or a row-like button (a fold line, a row's head, a title): no line, a row's corners.
      if (el.matches(".link-btn") || (!lined && radius <= 8.5 && !pct)) continue;
      // A switch's side sits in its track.
      if (el.parentElement && near(parseFloat(getComputedStyle(el.parentElement).borderTopLeftRadius), 10) && radius <= 8.5) continue;
      // A field that opens a list (a date, a select) is an input: 32 high, 8 radius.
      if (el.matches(".date-field, .select-field, .cv-picker-btn")) {
        if (!near(h, big) || !near(radius, 8)) out.push(`field ${what}`);
        continue;
      }
      // A size is a chip whose pill is drawn inside its 28 px target (PS-1).
      if (el.matches(".size-chip")) continue;
      if (round) {
        if (!(near(h, big) || near(h, small) || near(h, 44))) out.push(`round, but not 32 or 28: ${what}`);
        continue;
      }
      if (!pill) {
        out.push(`not a pill: ${what}`);
        continue;
      }
      // A pill: a button at 32 or 28 (taller only where its words wrap), or a chip (smaller).
      if (h > big + 1.2 && h < 2 * small - 4 && !el.matches(".focus-btn, .big, .as-mic, .cap-send, .bb-capture")) out.push(`a pill ${Math.round(h)} high: ${what}`);
    }
    return [...new Set(out)];
  }, scale);

/** Controls whose text is a character that used to stand in for an icon, and icon-only buttons with no name. */
const marksAndNames = (page: Page, marks: string) =>
  page.evaluate((marks) => {
    const re = new RegExp(marks, "u");
    const chars: string[] = [];
    const nameless: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], summary, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=radio], [role=switch], [role=option]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // The control's own words (text nodes anywhere under it, but not a nested control's).
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const own = [...el.querySelectorAll("*")].some((c) => c !== el && c.matches("button, a[href], [role=button]")) ? "" : text;
      const where = `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join(".")} "${text.slice(0, 30)}"`;
      if (own && re.test(own)) chars.push(where);
      for (const n of el.childNodes) if (n.nodeType === 3 && re.test((n.textContent ?? "").trim())) chars.push(where);
      if (el.tagName === "BUTTON" && !text && !(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.querySelector("[aria-label], title"))) nameless.push(where);
    }
    return { chars: [...new Set(chars)], nameless: [...new Set(nameless)] };
  }, marks);

/** A drawn line on an element's sides: any side with a width and a color that shows. */
const hasLine = (cs: { w: string; c: string; s: string }) => parseFloat(cs.w) > 0 && cs.s !== "none" && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)|transparent/.test(cs.c);
const linesOf = (page: Page, sel: string) =>
  page.evaluate((sel) => {
    return [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => {
      const cs = getComputedStyle(e);
      return { name: `${String(e.className).trim().split(/\s+/).slice(0, 3).join(".")} "${(e.textContent ?? "").trim().slice(0, 20)}"`, top: { w: cs.borderTopWidth, c: cs.borderTopColor, s: cs.borderTopStyle }, bottom: { w: cs.borderBottomWidth, c: cs.borderBottomColor, s: cs.borderBottomStyle }, left: { w: cs.borderLeftWidth, c: cs.borderLeftColor, s: cs.borderLeftStyle }, bg: cs.backgroundColor, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius };
    });
  }, sel);
const clearBg = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent";

describe.skipIf(!CHROMIUM)("RS-1: pill controls, tabs with icons, one-line rows and one icon family", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  for (const theme of THEMES)
    it(`${theme}: buttons, tabs, a switch, pills, rows and block cards, at every text size`, async () => {
      const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, { dayPanel: "default" });
      await buildState(page, "ordinary");
      for (const [size, scale] of SIZES) {
        await look(page, theme, size);
        const where = `${theme}, ${size}`;

        // Week: the tabs, the switch, pills and block cards.
        await go(page, "#/week");
        // A block that isn't past (a past day's card is a folded, quieter card with no ring, PS-1).
        await page.locator("main .half.focus:not(.past) .card-head").first().click({ position: { x: 4, y: 4 } });
        await page.locator("aside.block-panel").waitFor({ timeout: 10_000 });
        expect(await oddButtons(page, scale), `${where}: Week`).toEqual([]);

        // Tabs: no box around the group, an icon in each, the accent wash on the active one only.
        const views = (await linesOf(page, "nav.views"))[0]!;
        expect(hasLine(views.top) || !clearBg(views.bg), `${where}: the tabs' group has a box`).toBe(false);
        const tabs = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".view-tab")].map((t) => ({ icon: !!t.querySelector("svg.ft-icon"), current: t.getAttribute("aria-current") === "page", bg: getComputedStyle(t).backgroundColor, h: t.getBoundingClientRect().height, radius: parseFloat(getComputedStyle(t).borderTopLeftRadius) })));
        expect(tabs.length, where).toBe(5);
        for (const t of tabs) {
          expect(t.icon, `${where}: a tab without an icon`).toBe(true);
          expect(Math.abs(t.h - 32 * scale), `${where}: a tab ${t.h} high`).toBeLessThan(1.2);
          expect(t.radius, where).toBeGreaterThanOrEqual(t.h / 2 - 1);
          expect(clearBg(t.bg), `${where}: the active tab has the wash, the others none`).toBe(!t.current);
        }
        expect(tabs.filter((t) => t.current).length, where).toBe(1);

        // A switch (Cards | Timeline): one track, the chosen side lifted.
        const sw = await page.evaluate(() => {
          const track = document.querySelector<HTMLElement>(".mode-area .day-switch")!;
          const on = track.querySelector<HTMLElement>('button[aria-pressed="true"]')!;
          const off = track.querySelector<HTMLElement>('button[aria-pressed="false"]')!;
          const [t, a, b] = [track, on, off].map((e) => getComputedStyle(e));
          return { trackBg: t!.backgroundColor, trackLine: t!.borderTopWidth, trackRadius: t!.borderTopLeftRadius, onBg: a!.backgroundColor, onShadow: a!.boxShadow, offBg: b!.backgroundColor, sides: track.querySelectorAll("button").length };
        });
        expect(sw.sides, where).toBe(2);
        expect(clearBg(sw.trackBg), `${where}: the switch has a track`).toBe(false);
        expect(parseFloat(sw.trackLine), `${where}: the track has no line`).toBe(0);
        expect(clearBg(sw.onBg) || sw.onBg === sw.trackBg, `${where}: the chosen side is lifted`).toBe(false);
        expect(sw.onShadow, where).not.toBe("none");
        expect(clearBg(sw.offBg), `${where}: the other side is the track`).toBe(true);

        // A status pill has no line; a block card keeps its client edge and its border; the selected one its ring.
        for (const p of await linesOf(page, "main .status-pill, main .due-badge, .today-pill, main .late-chip")) {
          expect(hasLine(p.top), `${where}: a status with a line: ${p.name}`).toBe(false);
          expect(clearBg(p.bg), `${where}: a status with no wash: ${p.name}`).toBe(false);
        }
        const cards = await linesOf(page, "main.grid .half.card.focus:not(.past)");
        expect(cards.length, where).toBeGreaterThan(2);
        for (const c of cards) {
          expect(parseFloat(c.left.w), `${where}: a card's client edge: ${c.name}`).toBeGreaterThanOrEqual(4);
          expect(hasLine(c.left) && hasLine(c.top) && hasLine(c.bottom), `${where}: a card's border: ${c.name}`).toBe(true);
          expect(clearBg(c.bg), `${where}: a card's surface: ${c.name}`).toBe(false);
          expect(parseFloat(c.radius), where).toBeGreaterThanOrEqual(10);
        }
        const selected = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>("main.grid .half.selected:not(.past)")!;
          const probe = document.createElement("i");
          probe.style.color = "var(--selected)";
          document.body.append(probe);
          const ring = getComputedStyle(probe).color;
          probe.remove();
          return { shadow: getComputedStyle(el).boxShadow, ring };
        });
        expect(selected.shadow, `${where}: the selected card's ring`).toContain(selected.ring);

        // The block panel's rows: no border of their own.
        for (const r of await linesOf(page, "aside.block-panel .aw-row, aside.block-panel li.pick-row")) expect(hasLine(r.top) || hasLine(r.bottom) || hasLine(r.left), `${where}: a panel row with a line: ${r.name}`).toBe(false);
        const marks = await marksAndNames(page, MARKS.source);
        expect(marks, `${where}: Week`).toEqual({ chars: [], nameless: [] });
        await page.keyboard.press("Escape");

        // Day, with its promise lines.
        await go(page, "#/day");
        expect(await oddButtons(page, scale), `${where}: Day`).toEqual([]);
        expect(await marksAndNames(page, MARKS.source), `${where}: Day`).toEqual({ chars: [], nameless: [] });
        for (const r of await linesOf(page, ".urgent-strip .us-line")) expect(hasLine(r.top) || hasLine(r.left), `${where}: a promise line with a line: ${r.name}`).toBe(false);
        await page.keyboard.press("Escape");

        // The Inbox: rows with no border; a chip you press has a line when off and a wash when on.
        await go(page, "#/inbox/promises", 1400);
        await page.locator("li.ib4-row").first().waitFor();
        expect(await oddButtons(page, scale), `${where}: Inbox`).toEqual([]);
        expect(await marksAndNames(page, MARKS.source), `${where}: Inbox`).toEqual({ chars: [], nameless: [] });
        const rows = await linesOf(page, "li.ib4-row:not(.open), li.ib4-row:not(.open) > .ib4-row-head");
        expect(rows.length, where).toBeGreaterThan(3);
        for (const r of rows) expect(hasLine(r.top) || hasLine(r.bottom) || hasLine(r.left), `${where}: an Inbox row with a line: ${r.name}`).toBe(false);
        for (const c of await linesOf(page, ".ib4-chip:not(.on)")) expect(hasLine(c.top), `${where}: a chip to press with no line: ${c.name}`).toBe(true);
        for (const c of await linesOf(page, ".ib4-chip.on")) expect(clearBg(c.bg), `${where}: the chosen chip has no wash`).toBe(false);

        // The Backlog: no lines between rows; its column heads stay; client chips have a line.
        await go(page, "#/backlog", 2200);
        await page.locator(".ah-row").first().waitFor({ timeout: 30_000 });
        expect(await oddButtons(page, scale), `${where}: Backlog`).toEqual([]);
        expect(await marksAndNames(page, MARKS.source), `${where}: Backlog`).toEqual({ chars: [], nameless: [] });
        const cells = await linesOf(page, ".ah-grid tbody .ah-cell");
        expect(cells.length, where).toBeGreaterThan(20);
        for (const c of cells) expect(hasLine(c.bottom) || hasLine(c.top), `${where}: a Backlog row with a line: ${c.name}`).toBe(false);
        expect((await linesOf(page, ".ah-grid thead th")).some((t) => hasLine(t.bottom)), `${where}: the column heads keep their rule`).toBe(true);
        for (const c of await linesOf(page, '.rm-chip[aria-pressed="false"], .rm-chip:not([aria-pressed])')) expect(hasLine(c.top), `${where}: a client filter with no line: ${c.name}`).toBe(true);

        // Status and Settings: every button a named shape; inputs 32 high with an 8 radius.
        await go(page, "#/status", 2000);
        expect(await oddButtons(page, scale), `${where}: Status`).toEqual([]);
        expect(await marksAndNames(page, MARKS.source), `${where}: Status`).toEqual({ chars: [], nameless: [] });
        await go(page, "#/settings/hours", 1200);
        expect(await oddButtons(page, scale), `${where}: Settings`).toEqual([]);
        const inputs = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.settings input[type="text"], .settings input[type="time"], .settings input[type="number"], .settings input[type="search"], .settings select')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ h: e.getBoundingClientRect().height, r: getComputedStyle(e).borderTopLeftRadius })));
        expect(inputs.length, where).toBeGreaterThan(1);
        for (const i of inputs) {
          expect(Math.abs(i.h - 32 * scale), `${where}: an input ${i.h} high`).toBeLessThan(1.5);
          expect(i.r, where).toBe("8px");
        }
        await page.keyboard.press("Escape");
      }
      expect(errors).toEqual([]);
      await page.close();
    }, T);

  it("menus: an icon before every item, group labels with no capitals, the shortcut in a key chip, 12 radius", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.keyboard.press("Control+k");
    const menu = page.locator(".command-menu");
    await menu.waitFor();
    const m = await menu.evaluate((el) => {
      const items = [...el.querySelectorAll<HTMLElement>(".menu-item")];
      const group = el.querySelector<HTMLElement>(".menu-group")!;
      return {
        radius: getComputedStyle(el).borderTopLeftRadius,
        items: items.length,
        noIcon: items.filter((i) => !i.querySelector(".menu-icon svg")).length,
        heights: [...new Set(items.slice(0, 12).map((i) => Math.round(i.getBoundingClientRect().height)))],
        groupCase: getComputedStyle(group).textTransform,
        key: !!el.querySelector(".menu-hint kbd"),
        activeBg: getComputedStyle(el.querySelector<HTMLElement>(".menu-item.active")!).backgroundColor,
      };
    });
    expect(m.radius).toBe("12px");
    expect(m.items).toBeGreaterThan(40);
    expect(m.noIcon).toBe(0);
    expect(m.heights).toEqual([32]);
    expect(m.groupCase).toBe("none");
    expect(m.key).toBe(true);
    expect(clearBg(m.activeBg)).toBe(false);
    await page.keyboard.press("Escape");
    // More, from its round icon button, by the name it had.
    const more = page.getByRole("button", { name: "More: the Guide, commands and keyboard shortcuts" });
    expect(await more.locator("svg.ft-icon").count()).toBe(1);
    await more.click();
    const pop = page.locator(".popup-menu");
    await pop.waitFor();
    expect(await pop.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("12px");
    expect(await pop.locator(".menu-item").count()).toBe(await pop.locator(".menu-item .menu-icon svg").count());
    await page.keyboard.press("Escape");
    // A dialog: 16 radius.
    await page.keyboard.press("n");
    await page.locator(".cap-dialog").waitFor();
    expect(await page.locator(".cap-dialog").evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("16px");
    expect(await marksAndNames(page, MARKS.source), "Capture").toEqual({ chars: [], nameless: [] });
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the top bar is one row at 1024, 1280 and 1440; Focus, Capture and Ask keep their words; the focus ring shows on a washed tab", async () => {
    for (const width of [1024, 1280, 1440]) {
      const { page } = await freshPage(h, { width, height: 800 });
      const top = await page.evaluate(() => {
        const bar = document.querySelector(".topbar")!;
        const tops = [...bar.querySelectorAll(".view-tab, .top-btn, .vm-chip, .person-chip")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => Math.round(r.top + r.height / 2));
        return { tops, rows: Math.max(...tops) - Math.min(...tops) <= 6 ? 1 : 2, wide: document.documentElement.scrollWidth - document.documentElement.clientWidth, words: [...bar.querySelectorAll(".top-btn:not(.top-more)")].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim().split(" ")[0]) };
      });
      expect(top.rows, `${width}: the top bar's controls share one row (${top.tops.join(" ")})`).toBe(1);
      expect(top.wide, `${width}: no sideways scroll`).toBeLessThanOrEqual(0);
      expect(top.words, `${width}`).toEqual(["Focus", "Capture", "Ask"]);
      if (width === 1440) {
        // The keyboard's ring on the active tab (which has the wash): an outline in the focus color, outside the pill.
        const tab = page.locator('.view-tab[aria-current="page"]');
        await tab.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions));
        const ring = await tab.evaluate((el) => {
          const cs = getComputedStyle(el);
          const probe = document.createElement("i");
          probe.style.color = "var(--focus)";
          document.body.append(probe);
          const focus = getComputedStyle(probe).color;
          probe.remove();
          return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, focus };
        });
        expect(ring.style).not.toBe("none");
        expect(ring.width).toBeGreaterThanOrEqual(2);
        expect(ring.color).toBe(ring.focus);
      }
      // With focus running the countdown takes Focus's place; from 1280 up the bar is still one row (under that it
      // took two rows before too: the countdown and its to-do's title need the room).
      if (width < 1280) {
        await page.close();
        continue;
      }
      await buildState(page, "ordinary");
      await page.locator(".top-btn.timer-btn").click();
      await page.getByRole("menuitem").first().click();
      await page.locator(".top-timer").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      const running = await page.evaluate(() => [...document.querySelectorAll(".topbar .view-tab, .topbar .top-btn, .topbar .vm-chip, .topbar .top-timer, .topbar .person-chip")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => Math.round(r.top + r.height / 2)));
      expect(Math.max(...running) - Math.min(...running), `${width}: one row with the timer running (${running.join(" ")})`).toBeLessThanOrEqual(6);
      expect(await page.locator(".top-timer-count").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${width}: the countdown shows whole`).toBe(true);
      await page.locator(".top-timer").click();
      await page.locator(".focus-screen").getByRole("button", { name: "Stop" }).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      await page.close();
    }
  }, T);

  it("the phone: the bottom bar's tabs are an icon over a label; Add and the round buttons are 44 px targets", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await buildState(page, "ordinary");
    await go(page, "#/day");
    const bar = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".bottom-bar .bb-tab")].map((t) => {
      const icon = t.querySelector("svg.ft-icon")?.getBoundingClientRect();
      const label = t.querySelector(".bb-label")?.getBoundingClientRect();
      return { icon: !!icon, over: !!icon && !!label && icon.bottom <= label.top + 2 };
    }));
    expect(bar.length).toBe(4);
    for (const t of bar) expect(t).toEqual({ icon: true, over: true });
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".page-head .more-btn, .today-head .more-btn, .mode-area .add-work-head, .pd-step button, .day-step")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect()).filter((r) => r.height < 43.5 || r.width < 43.5).length);
    expect(small).toBe(0);
    expect(await marksAndNames(page, MARKS.source), "the phone's Day").toEqual({ chars: [], nameless: [] });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
