// MC-6: before and after screenshots, MC-5's counts measured again and MC-6's three measures (week row titles cut at
// 1440 and 1280, phone lines that start with a separator, "N of M decided" in the window at 390). Only when MC6_SHOTS
// names a folder; MC6_PHASE=before (main's Calls) or after. Demo data only, dark. Clock: Thursday Nov 5, 2026 4:30 PM ET.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const DIR = process.env.MC6_SHOTS ?? null;
const AFTER = process.env.MC6_PHASE !== "before";
const P = AFTER ? "after" : "before";
const T = 900_000;
const missed: string[] = [];
const counts: Record<string, unknown> = {};
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

const CLOCK = "2026-11-05T16:30:00-05:00";
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(2200);
};
const setTheme = async (page: Page, t: string) => {
  await call(page, "ui.set_theme", { theme: t });
  await page.reload();
  await page.waitForSelector(".demo-tag", { timeout: 30_000 }).catch(() => undefined);
};

/** What is on screen now inside `sel`: its words (text in the window, visible), and every element's box. */
async function measure(page: Page, sel: string) {
  return page.evaluate((s) => {
    const root = document.querySelector(s);
    if (!root) return null;
    const vh = innerHeight;
    const inView = (r: DOMRect) => r.bottom > 0 && r.top < vh && r.width > 0 && r.height > 0;
    let words = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !el.offsetParent || getComputedStyle(el).visibility === "hidden" || el.closest(".sr-only")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      if (![...range.getClientRects()].some(inView)) continue;
      words += (n.textContent ?? "").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    }
    return { words };
  }, sel);
}

/** The list's rows: how many are wholly in view, and each one's lines (its height over a line's height). */
async function listRows(page: Page) {
  return page.evaluate(() => {
    const vh = innerHeight;
    const rows = [...document.querySelectorAll<HTMLElement>("[data-calls-list] .calls-rows > li")].filter((r) => r.offsetParent);
    const lh = parseFloat(getComputedStyle(document.body).lineHeight) || 18;
    const seen = rows.filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= vh;
    });
    const needs = rows.filter((r) => r.closest("[data-section='needs']"));
    const lines = (r: HTMLElement) => {
      // Lines of text: the row's text boxes grouped by height on the page (two boxes that overlap by half are one line).
      const boxes: { top: number; bottom: number }[] = [];
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!(n.textContent ?? "").trim() || !n.parentElement?.offsetParent || n.parentElement.closest(".sr-only")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const x of range.getClientRects()) if (x.width > 0) boxes.push({ top: x.top, bottom: x.bottom });
      }
      boxes.sort((a, b) => a.top - b.top);
      let n = 0;
      let last: { top: number; bottom: number } | null = null;
      for (const b of boxes) {
        if (last && Math.min(last.bottom, b.bottom) - Math.max(last.top, b.top) > 0.5 * Math.min(last.bottom - last.top, b.bottom - b.top)) continue;
        n++;
        last = b;
      }
      return n;
    };
    // How many one-line week rows the list's height holds below its head (the demo has fewer calls than fit).
    const scroll = document.querySelector<HTMLElement>("[data-calls-list] .calls-scroll");
    const one = rows.find((r) => r.classList.contains("one") && !r.closest("[data-section='needs']"));
    const fits = scroll && one ? Math.floor((Math.min(vh, scroll.getBoundingClientRect().bottom) - scroll.getBoundingClientRect().top) / (one.getBoundingClientRect().height + 2)) : null;
    return { visible: seen.length, fits, all: rows.length, needsLines: needs.map(lines), weekLines: rows.filter((r) => !r.closest("[data-section='needs']")).slice(0, 6).map(lines), lineHeight: lh };
  });
}

/** A call's page: proposals wholly in view, how often the open count is said, the sticky header's height. */
async function callPage(page: Page, open: number) {
  return page.evaluate((n) => {
    const vh = innerHeight;
    const props = [...document.querySelectorAll<HTMLElement>(".mtg-prop")].filter((p) => p.offsetParent);
    const seen = props.filter((p) => {
      const b = p.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= vh;
    }).length;
    const side = document.querySelector(".calls-page") ?? document.body;
    const text = (side as HTMLElement).innerText;
    const said = (text.match(new RegExp(`(^|\\D)${n}(\\D|$)`, "g")) ?? []).length;
    const sticky = document.querySelector<HTMLElement>(".mtg-sticky");
    const group = document.querySelector<HTMLElement>(".mtg-sec-head");
    return { groupHead: group ? Math.round(group.getBoundingClientRect().height) : null, proposals: props.length, proposalsVisible: seen, countSaid: said, stickyHeight: sticky ? Math.round(sticky.getBoundingClientRect().height) : null };
  }, open);
}

/** Controls under 44 px tall in `sel` (the phone). */
async function smallControls(page: Page, sel: string) {
  return page.evaluate((s) => {
    const root = document.querySelector(s) ?? document.body;
    return [...root.querySelectorAll<HTMLElement>("button, a[href], select, input:not([type=hidden]), [role=button]")]
      // A control's hit area: its label when it has one (a tick box), its row when it is stretched over the row (a call's name).
      .map((e) => ({ e, box: (e.closest("label") ?? (e.classList.contains("calls-row-main") && getComputedStyle(e, "::after").content !== "none" ? e.closest("li") : null) ?? e).getBoundingClientRect() }))
      .filter(({ e, box }) => e.offsetParent && box.height > 0 && box.height < 43.5 && !e.closest(".sr-only, .topbar, .bottom-bar, nav"))
      .map(({ e }) => e)
      .map((e) => `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}:${Math.round(e.getBoundingClientRect().height)}`);
  }, sel);
}

/** MC-6's three measures: week row titles cut, phone lines starting with a separator, the decided line in the window. */
async function mc6Measures(page: Page) {
  return page.evaluate(() => {
    const cut = [...document.querySelectorAll<HTMLElement>("[data-calls-list] .calls-name")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent ?? "").slice(0, 30));
    // Each line of the call's meta: the piece that starts it, and whether a separator (its ::before) is drawn first.
    const meta = document.querySelector<HTMLElement>(".mtg-meta");
    const starts: string[] = [];
    let sepFirst = 0;
    if (meta) {
      const kids = [...meta.children].filter((k) => (k as HTMLElement).offsetParent && !k.classList.contains("sr-only")) as HTMLElement[];
      let lastTop = -1;
      for (const k of kids) {
        const r = k.getBoundingClientRect();
        if (Math.abs(r.top - lastTop) > 4) {
          lastTop = r.top;
          const before = getComputedStyle(k, "::before").content;
          const sep = /·/.test(before) || (k.textContent ?? "").trim().startsWith("·");
          if (sep) sepFirst++;
          starts.push(`${sep ? "· " : ""}${(k.textContent ?? "").trim().slice(0, 12)}`);
        }
      }
    }
    const dec = [...document.querySelectorAll<HTMLElement>(".mtg-decided, [data-decided]")].find((e) => e.offsetParent);
    const b = dec?.getBoundingClientRect();
    const decidedInView = !!b && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight;
    return { cut, metaLineStarts: starts, separatorFirst: sepFirst, decidedInView };
  });
}

describe.skipIf(!CHROMIUM || !DIR)("MC-6 screenshots and counts", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    const fs = await import("node:fs");
    const base = DIR!.replace(/\/+$/, "");
    fs.writeFileSync(`${base}-${P}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    fs.writeFileSync(`${base}-${P}.counts.json`, JSON.stringify(counts, null, 2));
    for (const h of started) await h.stop();
  });

  for (const [label, w, hgt] of [["1440", 1440, 900], ["1280", 1280, 800], ["390", 390, 844]] as const) {
    it(`Calls at ${label}`, async () => {
      const h = await startDemo("chromium", {}, CLOCK);
      started.push(h);
      const page = w > 900 ? (await freshPage(h, { width: w, height: hgt })).page : await phonePage(h, 390);
      if (w <= 900) await page.setViewportSize({ width: 390, height: 844 });
      await setTheme(page, "cooptimize-dark");
      await go(page, "#/week");
      await call(page, "pocket.connect", { key: "pk_demo_fine" });
      const c: Record<string, unknown> = {};
      counts[label] = c;

      await shot(page, `${label}-${P}-01-list`, () => go(page, "#/calls?show=open"));
      if (w <= 900) await go(page, "#/calls?show=open");
      c.listWords = (await measure(page, "[data-calls-list]"))?.words;
      c.rows = await listRows(page);
      c.cut = (await mc6Measures(page)).cut;
      if (label === "1280") return void (await page.close());

      const mine = (await call(page, "meeting.mine", {})).data;
      const occ = mine.occurrences as { id: number; open: number; state: string }[];
      const withProps = occ.filter((o) => o.open > 0).sort((a, b) => b.open - a.open)[0];
      if (withProps) {
        await shot(page, `${label}-${P}-02-call`, () => go(page, `#/calls/${withProps.id}?show=open`));
        c.callWords = (await measure(page, ".calls-beside"))?.words;
        c.call = { open: withProps.open, ...(await callPage(page, withProps.open)), ...(await mc6Measures(page)) };
        if (w > 900) await shot(page, `${label}-${P}-03-transcript`, () => go(page, `#/calls/${withProps.id}/transcript`));
      }
      // A chat call: its row's picker, and its setup when one opens.
      if (w > 900) {
        await shot(page, `${label}-${P}-04-chat-call`, async () => {
          await page.reload();
          await go(page, "#/calls?show=open");
          const row = page.locator("[data-calls-list] li").filter({ has: page.locator("[data-call-row^='cchat:']") }).first();
          c.chatChoices = await row.locator("select option").allTextContents();
          // The picture shows the row's picker opened out (its size), since a browser's own list isn't drawn in one.
          await row.locator("select").evaluate((e: HTMLSelectElement) => { e.size = e.options.length; e.style.position = "relative"; e.style.zIndex = "5"; e.style.height = "auto"; e.style.maxWidth = "none"; e.style.background = "var(--raised, #222)"; });
        });
        // Add a call with a recording chosen, and one with its own row.
        await shot(page, `${label}-${P}-05-add-recording`, async () => {
          await page.reload();
          await go(page, "#/calls?show=open");
          await page.getByRole("button", { name: "Add a call" }).first().click({ timeout: 10_000 });
          const pocket = page.locator("[data-add-call]").getByRole("button", { name: "Pocket recording" });
          if (await pocket.count()) await pocket.click();
          await page.locator("[data-rec-pick] input").nth(1).click({ timeout: 10_000 }).catch(() => undefined);
        });
      }
      await page.close();
    }, T);
  }
});
