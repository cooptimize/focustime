// MC-4: the before and after screenshots. Only when MC4_SHOTS names a folder; nothing runs otherwise. MC4_PHASE=before
// (run on main's build: the list, a call with proposals, a calendar call's setup) or after (this branch). Demo data only,
// dark at 1440 by 900, with the list and a call at 390 by 844 and one in light. Clock: Thursday Nov 5, 2026 4:30 PM ET
// (Thursday, so Week's header has its line; the end of a day with calls behind it).
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.MC4_SHOTS ?? null;
const AFTER = process.env.MC4_PHASE !== "before";
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>, full = false) {
  try {
    await run();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: full });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

const CLOCK = "2026-11-05T16:30:00-05:00";

describe.skipIf(!CHROMIUM || !DIR)("MC-4 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}-${AFTER ? "after" : "before"}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });
  const setTheme = async (page: Page, t: string) => {
    await call(page, "ui.set_theme", { theme: t });
    await page.reload();
    await page.waitForSelector(".demo-tag", { timeout: 30_000 }).catch(() => undefined);
  };
  const go = async (page: Page, hash: string) => {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(2200);
  };
  /** Calls on Open (the page remembers the last filter in this browser). */
  const openCalls = async (page: Page) => {
    await go(page, "#/calls");
    const f = page.locator("[data-calls-filter='open']");
    if ((await f.getAttribute("aria-pressed").catch(() => "true")) !== "true") (await f.click(), await page.waitForTimeout(800));
  };
  const row = (page: Page, name: RegExp) => page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: name }) }).first();

  for (const [label, w, hgt] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
    it(`Calls at ${label}`, async () => {
      const h = await startDemo("chromium", {}, CLOCK);
      started.push(h);
      const { page } = await freshPage(h, { width: w, height: hgt });
      const p = AFTER ? "after" : "before";
      await setTheme(page, "cooptimize-dark");
      await shot(page, `${label}-${p}-01-list`, () => go(page, "#/calls"), w > 900);
      const mine = (await call(page, "meeting.mine", {})).data;
      const withProps = (mine.occurrences as { id: number; open: number }[]).find((o) => o.open > 0)?.id;
      if (withProps) await shot(page, `${label}-${p}-02-a-call`, () => go(page, `#/calls/${withProps}`));
      await shot(page, `${label}-${p}-03-setup`, async () => {
        await go(page, "#/calls");
        const r = AFTER ? row(page, /Northwind data model review/).locator(".calls-row-main") : page.locator("[data-call-row]").filter({ hasText: "Northwind data model review" }).first();
        if (AFTER && w <= 900) await r.scrollIntoViewIfNeeded();
        await r.click({ timeout: 10_000 });
      });
      if (!AFTER) return;
      if (w > 900) {
        await setTheme(page, "cooptimize-light");
        await shot(page, `${label}-after-04-list-light`, () => go(page, "#/calls"));
        await setTheme(page, "cooptimize-dark");
        // Close out's list, and Week's Thursday line.
        await shot(page, `${label}-after-13-closeout`, async () => {
          await go(page, "#/day/closeout/2026-11-02");
          await page.locator("[data-closeout-calls]").waitFor({ timeout: 10_000 });
        });
        await shot(page, `${label}-after-14-week-line`, async () => {
          await go(page, "#/week");
          await page.locator("[data-week-calls-line]").waitFor({ timeout: 10_000 });
        });
        // The fold opened.
        await shot(page, `${label}-after-05-fold`, async () => {
          await go(page, "#/calls");
          await page.locator("[data-calls-fold='no-transcript'] > .link-btn").click();
          await page.locator("[data-calls-fold='no-transcript']").scrollIntoViewIfNeeded();
        });
        // A repeat's row and its menu.
        await shot(page, `${label}-after-06-repeat-menu`, async () => {
          await go(page, "#/calls");
          const f = page.locator("[data-calls-fold='no-transcript'] > .link-btn");
          if ((await f.getAttribute("aria-expanded")) !== "true") await f.click();
          const s = page.locator("[data-series-row]").first();
          await s.scrollIntoViewIfNeeded();
          await s.locator("[data-call-act='hide-menu']").click();
        });
        // Hide every one, then Hidden with Put back.
        await shot(page, `${label}-after-07-hidden`, async () => {
          await page.locator("[data-hide='every']").click();
          await page.waitForTimeout(600);
          await go(page, "#/calls?show=hidden");
        });
        // Skip all and close on a call with proposals, and its Undo.
        await shot(page, `${label}-after-08-skip-all-undo`, async () => {
          await go(page, "#/calls");
          await page.locator("[data-section='needs'] [data-call-act='skip-all']").first().click();
          await page.locator(".toast, [role='status']").filter({ hasText: /closed/ }).first().waitFor({ timeout: 10_000 });
        });
        await shot(page, `${label}-after-09-closed-list`, () => go(page, "#/calls?show=closed"));
        await shot(page, `${label}-after-10-closed-call`, async () => {
          await go(page, "#/calls?show=closed");
          await page.locator("[data-section='closed'] .calls-row-main").first().click();
          await page.locator("[data-closed-page]").waitFor({ timeout: 10_000 });
          await page.locator("[data-see-skipped]").click();
        });
        // Review from the row (a Teams transcript, a client on the row, no setup).
        await shot(page, `${label}-after-11-review-from-row`, async () => {
          await openCalls(page);
          await page.locator("[data-section='week-this'] [data-call-act='review']").first().click({ timeout: 10_000 });
          await page.waitForTimeout(300);
        });
        // The check failing: one quiet line with Check again.
        await shot(page, `${label}-after-12-check-failed`, async () => {
          await go(page, "#/week");
          const f = await call(page, "demo.fail_next", { action: "meeting.calls_check" });
          if (!f.ok) throw new Error(`fail_next: ${JSON.stringify(f)}`);
          await openCalls(page);
          await page.locator("[data-calls-check='failed']").waitFor({ timeout: 10_000 });
        });
      } else {
        await shot(page, `${label}-after-04-list-scrolled`, async () => {
          await openCalls(page);
          await page.mouse.wheel(0, 700);
        });
      }
      await page.close();
    }, T);
  }
});
