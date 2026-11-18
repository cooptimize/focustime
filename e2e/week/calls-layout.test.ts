// PK-4 (from the product owner, Nov 18): two layout bugs from MC-4 on Calls, in demo mode. A Needs you row's state
// sits on one line beside the client, or the whole state goes under it: never a word a line. Every state a Needs you
// row can show is put in a real row and measured (the demo doesn't have a call in each). And Calls never makes the
// document scroll: only the list and the open call do, with the Pocket line and the filters at the list's head.
// At 1280 x 720 and 1440 x 900, at Default and the largest Text size. Clock: Thu Nov 5, 2026 10:00 AM ET.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { DEMO_POCKET_KEYS } from "../../sources/demo/pocket.ts";
import { CALL_STATE } from "../../plan/call-words.ts";

const T = 300_000;
const W = 30_000;
let h: Harness;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean }>;
const go = (page: Page, x: string) => page.evaluate((v) => (location.hash = v), x);

/** Every state a Needs you row can show in place of its progress. */
const STATES = [CALL_STATE.upload, CALL_STATE.readFailed, CALL_STATE.aiFailed, CALL_STATE.review(12)];

type Measure = { label: string; lines: number; width: number; longest: number; overflow: boolean };

/** Puts `label` in the first Needs you row (as its state, in place of its progress) and measures it. */
function measure(page: Page, label: string | null): Promise<Measure> {
  return page.evaluate((label) => {
    const row = document.querySelector<HTMLElement>(".calls-row.need-row")!;
    const two = row.querySelector<HTMLElement>(".calls-row-two")!;
    let el = two.querySelector<HTMLElement>(".calls-state, .calls-left")!;
    if (label !== null) {
      const s = document.createElement("span");
      s.className = "calls-state needs";
      s.textContent = label;
      el.replaceWith(s);
      el = s;
    }
    const text = el.textContent ?? "";
    // The longest run that may not break: a word, or the whole progress ("3 left of 11" keeps to one line).
    const runs = el.classList.contains("calls-left") ? [text] : text.split(/\s+/);
    const probe = document.createElement("span");
    probe.className = el.className;
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;max-width:none";
    two.appendChild(probe);
    let longest = 0;
    for (const r of runs) (probe.textContent = r), (longest = Math.max(longest, probe.getBoundingClientRect().width));
    probe.remove();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
    const box = el.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return { label: text, lines: Math.round(box.height / lh), width: box.width, longest, overflow: box.right > rowBox.right + 0.5 };
  }, label);
}

describe.skipIf(!CHROMIUM)("Calls' layout: Needs you states and a page that doesn't scroll (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  for (const [w, hgt] of [[1280, 720], [1440, 900]] as const) {
    for (const size of ["default", "larger"] as const) {
      it(`${w} x ${hgt}, ${size} text`, async () => {
        const { page, errors } = await freshPage(h, { width: w, height: hgt });
        await go(page, "#/week");
        await page.locator(".topbar").first().waitFor({ timeout: W });
        expect((await call(page, "ui.set_text_size", { size })).ok).toBe(true);
        // The longest head the list can have: Pocket's left-out line and Set my Pocket address open.
        expect((await call(page, "pocket.connect", { key: DEMO_POCKET_KEYS.shared })).ok).toBe(true);
        await page.reload();
        await page.locator(".topbar").first().waitFor({ timeout: W });
        await go(page, "#/calls");
        await page.locator(".calls-row.need-row").first().waitFor({ timeout: W });
        await expect.poll(() => page.locator("[data-pocket-line]").textContent(), { timeout: W }).toMatch(/Pocket checked at/);
        await page.locator("[data-pocket-set-address]").click();
        await page.locator("[data-pocket-address]").waitFor({ timeout: W });

        // The page itself never scrolls; the list does.
        const doc = await page.evaluate(() => ({ doc: document.scrollingElement!.scrollHeight, win: window.innerHeight, list: (() => { const s = document.querySelector<HTMLElement>(".calls-scroll")!; return { sh: s.scrollHeight, ch: s.clientHeight }; })() }));
        expect(doc.doc, `document ${doc.doc} vs window ${doc.win}`).toBeLessThanOrEqual(doc.win);
        expect(doc.list.sh).toBeGreaterThan(doc.list.ch);
        await page.evaluate(() => window.scrollTo(0, 400));
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        const bar = await page.locator(".topbar").first().boundingBox();
        expect(bar!.y).toBe(0);

        // Each Needs you state: at most two lines, never narrower than its longest word, inside its row.
        const all = [await measure(page, null)];
        for (const s of STATES) all.push(await measure(page, s));
        for (const m of all) {
          expect(m.lines, `${m.label}: ${m.lines} lines`).toBeLessThanOrEqual(2);
          expect(m.width + 0.5, `${m.label}: ${m.width} wide, its longest run ${m.longest}`).toBeGreaterThanOrEqual(m.longest);
          expect(m.overflow, `${m.label} runs out of its row`).toBe(false);
        }
        expect(errors).toEqual([]);
      }, T);
    }
  }
});

/**
 * With 30 or more calendar calls (the demo's long list), the document is exactly the window's height, scrolling the
 * list never moves the top bar, and every screen-reader-only label on Calls (the list and the open call) is placed
 * inside the page, never against it.
 */
describe.skipIf(!CHROMIUM)("Calls with a long list of calendar calls (browser, demo mode)", () => {
  let long: Harness;
  beforeAll(async () => {
    long = await startDemo("chromium", { FOCUSTIME_DEMO_CALLS: "long" }, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => long?.stop());

  for (const [w, hgt] of [[1280, 720], [1440, 900]] as const) {
    it(`${w} x ${hgt}: the page never scrolls`, async () => {
      const { page, errors } = await freshPage(long, { width: w, height: hgt });
      await go(page, "#/calls");
      await page.locator(".calls-row.need-row").first().waitFor({ timeout: W });
      await expect.poll(() => page.locator("[data-calls-list] li .calls-about").count(), { timeout: W }).toBeGreaterThanOrEqual(30);
      const sizes = () => page.evaluate(() => ({ doc: document.scrollingElement!.scrollHeight, win: window.innerHeight, y: window.scrollY, bar: document.querySelector(".topbar")!.getBoundingClientRect().top }));
      expect(await sizes()).toEqual({ doc: hgt, win: hgt, y: 0, bar: 0 });
      // Scroll the list to its end with the wheel, as a person does; the page stays where it is.
      const list = (await page.locator(".calls-scroll").boundingBox())!;
      await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
      for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => { const s = document.querySelector(".calls-scroll")!; return s.scrollTop > 0 && Math.abs(s.scrollTop + s.clientHeight - s.scrollHeight) < 2; })).toBe(true);
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(300);
      expect(await sizes()).toEqual({ doc: hgt, win: hgt, y: 0, bar: 0 });
      // Every screen-reader-only label on Calls is placed against a box inside the page, never the page itself.
      const loose = await page.evaluate(() =>
        [...document.querySelectorAll(".calls-page .sr-only")].filter((e) => { const p = (e as HTMLElement).offsetParent; return !p || p === document.body || !p.closest(".calls-page"); }).length);
      expect(loose).toBe(0);
      expect(errors).toEqual([]);
    }, T);
  }
});

