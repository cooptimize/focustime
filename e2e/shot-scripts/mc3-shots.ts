// MC-3: the before and after screenshots. Only when MC3_SHOTS names a folder; nothing runs otherwise. MC3_PHASE=before
// (run on main's build: Calls under More, the two lists) or after (this branch). Demo data only, dark, with Calls once
// in light. Clock: Thursday Nov 5, 2026 4:30 PM ET, the end of a day with calls behind it.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.MC3_SHOTS ?? null;
const AFTER = process.env.MC3_PHASE !== "before";
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>, clip?: { x: number; y: number; width: number; height: number }) {
  try {
    await run();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/${name}.png`, ...(clip ? { clip } : {}) });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

const CLOCK = "2026-11-05T16:30:00-05:00";
const LIST = AFTER ? "#/calls" : "#/meetings";

describe.skipIf(!CHROMIUM || !DIR)("MC-3 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  const setTheme = async (page: Page, t: string) => {
    await call(page, "ui.set_theme", { theme: t });
    await page.reload();
    await page.waitForSelector(".demo-tag", { timeout: 30_000 }).catch(() => undefined);
  };
  const go = async (page: Page, hash: string) => {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(1800);
  };
  const size = async (page: Page, s: string | null) => page.evaluate((x) => (x ? document.documentElement.setAttribute("data-text-size", x) : document.documentElement.removeAttribute("data-text-size")), s);

  // The top bar at each width with the Dev mark (seven tabs after).
  it("the top bar", async () => {
    const h = await startDemo("chromium", { FOCUSTIME_ENV: "dev" }, CLOCK);
    started.push(h);
    for (const w of [1280, 1366, 1440]) {
      const { page } = await freshPage(h, { width: w, height: 900 });
      await setTheme(page, "cooptimize-dark");
      await go(page, "#/week");
      for (const s of [null, "larger"] as const) {
        await size(page, s);
        await shot(page, `bar-${w}-${s ?? "default"}`, async () => undefined, { x: 0, y: 0, width: w, height: 72 });
      }
      await page.close();
    }
  }, T);

  for (const [label, w, hgt] of [["1440", 1440, 900], ["1366", 1366, 768], ["390", 390, 844]] as const) {
    it(`Calls at ${label}`, async () => {
      const h = await startDemo("chromium", {}, CLOCK);
      started.push(h);
      const { page } = await freshPage(h, { width: w, height: hgt });
      await setTheme(page, "cooptimize-light");
      await shot(page, `${label}-01-calls-light`, () => go(page, LIST));
      await setTheme(page, "cooptimize-dark");
      await shot(page, `${label}-02-calls`, () => go(page, LIST));
      const mine = (await call(page, "meeting.mine", {})).data;
      const id = mine.occurrences[0]?.id as number | undefined;
      if (id) await shot(page, `${label}-03-a-call`, () => go(page, AFTER ? `#/calls/${id}` : `#/meetings/${id}`));
      await shot(page, `${label}-04-setup`, async () => {
        await go(page, LIST);
        if (AFTER) {
          if (w <= 900) await page.locator("[data-call-row]").filter({ hasText: "Northwind data model review" }).first().click({ timeout: 10_000 });
          else await page.locator("[data-call-row]").filter({ hasText: "Northwind data model review" }).first().click({ timeout: 10_000 });
          await page.getByRole("region", { name: /^Review Northwind data model review/ }).waitFor({ timeout: 10_000 });
        } else {
          await page.locator(".mtg-other").filter({ hasText: "Northwind data model review" }).first().getByRole("button", { name: /^Review/ }).click({ timeout: 10_000 });
        }
      });
      await page.close();
    }, T);
  }
});
