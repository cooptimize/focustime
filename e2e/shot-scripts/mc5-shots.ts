// MC-5: the before and after screenshots and STEP 0.4's counts. Only when MC5_SHOTS names a folder; nothing runs
// otherwise. MC5_PHASE=before (main's Calls) or after (this branch). Demo data only (a fictional person, invented calls
// and recordings on a pretend Pocket), dark at 1440 by 900 and 390 by 844, with two in light. Clock: Thursday Nov 5,
// 2026 4:30 PM ET. The counts go to <folder>-<phase>.counts.json: words on screen in the list and on a call's page, lines
// per list row, calls and proposals visible without scrolling, how often the call's count is on screen, the sticky
// header's height, and controls under 44 px on the phone.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { phonePage } from "../mb1-helpers.ts";

const DIR = process.env.MC5_SHOTS ?? null;
const AFTER = process.env.MC5_PHASE !== "before";
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
    return { visible: seen.length, all: rows.length, needsLines: needs.map(lines), weekLines: rows.filter((r) => !r.closest("[data-section='needs']")).slice(0, 6).map(lines), lineHeight: lh };
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
    return { proposals: props.length, proposalsVisible: seen, countSaid: said, stickyHeight: sticky ? Math.round(sticky.getBoundingClientRect().height) : null };
  }, open);
}

/** Controls under 44 px tall in `sel` (the phone). */
async function smallControls(page: Page, sel: string) {
  return page.evaluate((s) => {
    const root = document.querySelector(s) ?? document.body;
    return [...root.querySelectorAll<HTMLElement>("button, a[href], select, input:not([type=hidden]), [role=button]")]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5 && !e.closest(".sr-only, .topbar, .bottom-bar, nav"))
      .map((e) => `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}:${Math.round(e.getBoundingClientRect().height)}`);
  }, sel);
}

describe.skipIf(!CHROMIUM || !DIR)("MC-5 screenshots and counts", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    const fs = await import("node:fs");
    const base = DIR!.replace(/\/+$/, "");
    fs.writeFileSync(`${base}-${P}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    fs.writeFileSync(`${base}-${P}.counts.json`, JSON.stringify(counts, null, 2));
    for (const h of started) await h.stop();
  });

  for (const [label, w, hgt] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
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

      // The list on Open, Closed and Hidden.
      await shot(page, `${label}-${P}-01-open`, () => go(page, "#/calls?show=open"));
      if (w <= 900) await go(page, "#/calls?show=open");
      c.listWords = (await measure(page, "[data-calls-list]"))?.words;
      c.rows = await listRows(page);
      if (w <= 900) c.listSmall = await smallControls(page, "[data-calls-list]");
      await shot(page, `${label}-${P}-02-closed`, () => go(page, "#/calls?show=closed"));
      await shot(page, `${label}-${P}-03-hidden`, () => go(page, "#/calls?show=hidden"));

      // A call with proposals.
      const mine = (await call(page, "meeting.mine", {})).data;
      const occ = (mine.occurrences as { id: number; open: number; state: string }[]);
      const withProps = occ.filter((o) => o.open > 0).sort((a, b) => b.open - a.open)[0];
      if (withProps) {
        await shot(page, `${label}-${P}-04-call`, () => go(page, `#/calls/${withProps.id}?show=open`));
        c.callWords = (await measure(page, ".calls-beside"))?.words;
        c.call = { open: withProps.open, ...(await callPage(page, withProps.open)) };
        if (w <= 900) c.callSmall = await smallControls(page, ".calls-beside");
        await shot(page, `${label}-${P}-05-transcript`, () => go(page, `#/calls/${withProps.id}/transcript`));
      }
      // A call that needs a transcript.
      c.states = occ.map((o) => o.state);
      const needs = occ.find((o) => o.state === "needs_upload");
      if (needs) await shot(page, `${label}-${P}-06-needs-transcript`, () => go(page, `#/calls/${needs.id}`));
      // A calendar call's setup.
      await shot(page, `${label}-${P}-07-setup`, async () => {
        await go(page, "#/calls?show=open");
        const r = page.locator("[data-calls-list] [data-call-row]").filter({ hasText: "Northwind data model review" }).first();
        await r.scrollIntoViewIfNeeded();
        await r.click({ timeout: 10_000 });
      });
      // Add a call, and the page it lands on.
      await shot(page, `${label}-${P}-08-add`, async () => {
        // A setup left open beside the list (two steps on the phone) would cover the list: start from a fresh page.
        await page.reload();
        await go(page, "#/calls?show=open");
        await page.getByRole("button", { name: "Add a call" }).first().click({ timeout: 10_000 });
      });
      await shot(page, `${label}-${P}-09-added`, async () => {
        const form = page.locator(".mtg-add, [data-add-call]").first();
        await form.getByLabel("Name").fill("Northwind data check-in");
        const about = form.locator("select").last();
        await about.selectOption({ label: "Northwind" }).catch(async () => about.selectOption({ index: 1 }));
        if (AFTER) {
          const later = form.getByRole("button", { name: "Later" });
          if (await later.count()) await later.click();
        }
        await form.locator("button[type=submit], button.primary").first().click();
        await page.waitForTimeout(1500);
      });
      if (AFTER) {
        // The pictures only this branch has: one proposal open with a needed field, Add a call's three choices, a
        // hand-added call choosing a recording, Select calls.
        if (withProps) {
          await shot(page, `${label}-after-10-open-proposal`, async () => {
            await go(page, `#/calls/${withProps.id}?show=open`);
            await page.locator("[data-prop-open]").first().click({ timeout: 10_000 });
          });
        }
        for (const [n, choice] of [["11", "Pocket recording"], ["12", "A file"], ["13", "Later"]] as const) {
          await shot(page, `${label}-after-${n}-add-${choice.toLowerCase().replace(/\s+/g, "-")}`, async () => {
            await go(page, "#/calls?show=open");
            await page.getByRole("button", { name: "Add a call" }).first().click({ timeout: 10_000 });
            await page.locator("[data-add-call]").getByRole("button", { name: choice }).click({ timeout: 10_000 });
          });
        }
        await shot(page, `${label}-after-14-hand-recording`, async () => {
          await go(page, "#/calls?show=open");
          await page.locator("[data-call-row]").filter({ hasText: "Northwind data check-in" }).first().click({ timeout: 10_000 });
          await page.locator("[data-transcript-choice]").getByRole("button", { name: "Pocket recording" }).click({ timeout: 10_000 });
          await page.locator("[data-rec-pick] [role=radio], [data-rec-pick] input").first().click({ timeout: 10_000 });
        });
        await shot(page, `${label}-after-15-select`, async () => {
          await go(page, "#/calls?show=open");
          await page.getByRole("button", { name: "More for Calls" }).click();
          await page.getByRole("menuitem", { name: /Select calls/ }).click();
        });
        if (w > 900) {
          await setTheme(page, "cooptimize-light");
          await shot(page, `${label}-after-16-open-light`, () => go(page, "#/calls?show=open"));
          if (withProps) await shot(page, `${label}-after-17-call-light`, () => go(page, `#/calls/${withProps.id}?show=open`));
          await setTheme(page, "cooptimize-dark");
        }
      }
      await page.close();
    }, T);
  }
});
