// MC-1e: the before and after screenshots, one script for both (run on main for before, on the branch for after). Only
// when MC1E_SHOTS names a folder; nothing runs otherwise. Demo data only; dark at 1440×900 and 390×844, and the page in
// light. A scene that a build doesn't have (the bar, the needed field) is noted as missed, never faked.
// Clock: Thu Nov 5, 2026 10:00 AM ET (the demo's Northwind weekly status call was Monday).
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.MC1E_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("MC-1e screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  it("the call's review page", async () => {
    const h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
    started.push(h);
    const open = async (width: number, height: number, theme: string) => {
      const { page } = await freshPage(h, { width, height });
      await call(page, "ui.set_theme", { theme });
      await page.evaluate(() => (location.hash = "#/week"));
      await page.reload();
      await page.waitForTimeout(1500);
      return page;
    };
    for (const [tag, w, ht] of [["desk", 1440, 900], ["phone", 390, 844]] as const) {
      const page = await open(w, ht, "cooptimize-dark");
      const id = (await call(page, "meeting.mine", {})).data.occurrences[0].id as number;
      const go = async (hash: string) => {
        await page.evaluate((x) => (location.hash = x), hash);
        await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1200);
      };
      await shot(page, `${tag}-1-page`, () => go(`#/meetings/${id}`));
      // Scrolled into the rows: what stays in view.
      await shot(page, `${tag}-2-scrolled`, async () => {
        // The page scrolls on a computer; the document does on a phone.
        await page.locator(".mtg-view").evaluate((el) => (el.scrollTo(0, 900), window.scrollTo(0, 900)));
      });
      // A new item's row (the Epic the demo's process needs a target date on, after; the first gap, before).
      await shot(page, `${tag}-3-new-item`, async () => {
        const row = page.locator(".mtg-prop").filter({ hasText: "Accountant reporting area" }).or(page.locator(".mtg-prop").filter({ has: page.locator("input[value='Accountant reporting area']") })).or(page.locator(".mtg-prop").first());
        await row.first().scrollIntoViewIfNeeded();
        const edit = row.first().getByRole("button", { name: "Edit" });
        if (await edit.count()) await edit.click();
      });
      // Ticked rows: the bar (after), or the old count and Confirm (before).
      await shot(page, `${tag}-4-ticked`, async () => {
        await go(`#/meetings/${id}/comments`).catch(() => go(`#/meetings/${id}`));
        const all = page.locator(".mtg-sec-head").getByRole("button", { name: "Select all" });
        if (await all.count()) await all.first().click();
        await page.locator(".mtg-bulk, .mtg-bar").first().scrollIntoViewIfNeeded();
      });
      // Writing: the one DevOps preview (after), or the page's own confirm dialog (before).
      await shot(page, `${tag}-5-preview`, async () => {
        await go(`#/meetings/${id}`);
        const create = page.locator(".mtg-prop").filter({ has: page.locator("input[value='Monthly statement as a PDF']") }).getByRole("button", { name: "Create in DevOps" });
        if (await create.count()) await create.click();
        else await page.getByRole("button", { name: /^Confirm \d+/ }).click();
        await page.locator(".write-dialog.devops, .mtg-confirm-box").first().waitFor({ timeout: 30_000 });
      });
      await page.keyboard.press("Escape");
      // Skipped rows folded at their section's foot (after); before, they stay in place as Skipped.
      await shot(page, `${tag}-8-folded`, async () => {
        await go(`#/meetings/${id}/promises`).catch(() => go(`#/meetings/${id}`));
        for (const words of ["Share three sample statements from last year", "Book a session with Northwind's accountants to walk through the statements"]) {
          const row = page.locator(".mtg-prop").filter({ has: page.locator(`input[value="${words}"]`) });
          if (await row.count()) await row.getByRole("button", { name: "Skip" }).click();
          await page.waitForTimeout(500);
        }
        const fold = page.locator(".mtg-fold").first();
        if (await fold.count()) await fold.scrollIntoViewIfNeeded();
        else await page.locator(".mtg-prop.skipped").first().scrollIntoViewIfNeeded();
      });
      await shot(page, `${tag}-6-transcript`, async () => {
        await page.evaluate((x) => (location.hash = x), `#/meetings/${id}/transcript`);
        await page.locator(".mtg-lines li").first().waitFor({ timeout: 30_000 });
      });
      await page.close();
    }
    const light = await open(1440, 900, "cooptimize-light");
    const id = (await call(light, "meeting.mine", {})).data.occurrences[0].id as number;
    await shot(light, "desk-7-light", async () => {
      await light.evaluate((x) => (location.hash = x), `#/meetings/${id}`);
      await light.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    });
    await light.close();
  }, T);
});
