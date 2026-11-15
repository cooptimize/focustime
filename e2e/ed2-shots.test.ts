// ED-2: the before and after screenshots, one script for both so the pairs match. Only when ED2_SHOTS names a folder
// (docs/ux/ed2/before or docs/ux/ed2/after); nothing runs otherwise. Dark and light at 1440x900, demo data only
// (Atlas Freight's backlog, with ED-2's grooming examples). The before set is the same places on main's screens: what
// they offered before this step. A shot that can't be reached is named in the log and skipped.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { pickLevel } from "./backlog-helpers.ts";

const DIR = process.env.ED2_SHOTS ?? null;
const BEFORE = !!DIR && /before\/?$/.test(DIR);
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("ED-2 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) console.log(`ED-2 shots not taken:\n${missed.join("\n")}`);
    for (const h of started) await h.stop();
  });

  it("rename, move and bulk edit in Backlog's Grid", async () => {
    for (const theme of ["dark", "light"] as const) {
      // A fresh demo per theme, so both start from the same backlog.
      const h = await startDemo();
      started.push(h);
      const { page } = await freshPage(h, { width: 1440, height: 900 });
      await call(page, "ui.set_theme", { theme: `cooptimize-${theme}` });
      await page.reload();
      const go = async (hash: string) => {
        await page.evaluate((x) => (location.hash = x), hash);
        await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(500);
      };
      await go("#/backlog");
      const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
      for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
      await chips.getByRole("button", { name: "Atlas Freight", exact: true }).click();
      await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
      await pickLevel(page, "Features");
      const row = (title: string) => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) });
      const open = async (title: string) => {
        const r = row(title);
        if ((await r.getAttribute("aria-expanded")) !== "true") await r.locator(".ah-chev").first().click();
      };
      for (const f of ["Shipment tracking dashboard", "Delivery time estimates", "Carrier rate alerts"]) await open(f);
      await page.waitForTimeout(300);
      const tick = (title: string) => row(title).getByRole("checkbox").check({ force: true });
      const review = () => page.getByRole("dialog", { name: "Review changes" });
      /**
       * Save in the review: one preview per client, each confirmed. A preview whose write didn't confirm stays open
       * with each item's result and Try again: it is left open (that is the shot).
       */
      const saveAll = async () => {
        await review().getByRole("button", { name: /^Save \d+ items? to DevOps$/ }).click();
        const dlg = page.locator(".write-dialog");
        for (let i = 0; i < 6; i++) {
          const go = dlg.getByRole("button", { name: /in DevOps$/ }).first();
          if (!(await go.waitFor({ timeout: 8000 }).then(() => true, () => false))) break;
          await go.click();
          // Either this preview goes away (all confirmed; the next client's may follow) or it shows a result that didn't.
          const failed = dlg.locator(".set-problem[role=alert]").first();
          const left = await Promise.race([failed.waitFor({ timeout: 20_000 }).then(() => true), go.waitFor({ state: "detached", timeout: 20_000 }).then(() => false)]).catch(() => false);
          if (left) return;
          await page.waitForTimeout(600);
        }
      };

      if (BEFORE) {
        // 1. A title in a cell: before, it only opens the card.
        await shot(page, `rename-cell-${theme}`, async () => void (await row("Shipmnt list filter by region").locator(".ah-col-item").focus()));
        // 2. A row with staged changes: before, only dates, owner, state and size could be staged.
        await shot(page, `staged-row-${theme}`, async () => {
          await call(page, "ahead.stage", { clientKey: "Atlas", itemId: 3354, field: "size", value: 3 });
          await page.reload();
          await go("#/backlog");
          for (const f of ["Shipment tracking dashboard", "Delivery time estimates", "Carrier rate alerts"]) await open(f);
        });
        // 3. Move…'s picker: before, only on the story card.
        await shot(page, `move-picker-${theme}`, async () => {
          await page.evaluate(() => (location.hash = "#/item/Atlas/3354"));
          const card = page.getByRole("dialog", { name: /#3354/ });
          await card.locator(".sc-facts").waitFor();
          await card.getByRole("button", { name: "More for this item" }).click();
          await card.getByRole("menuitem", { name: /^Move/ }).click();
          await card.locator(".sc-move select").waitFor();
        });
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await go("#/backlog");
        // 4. A drag: before, rows don't drag (the same rows, at rest).
        await shot(page, `drag-${theme}`, async () => void (await row("Late delivery alerts for dispatchers").hover()));
        // 5. The bulk bar with rows ticked: before, four actions.
        await shot(page, `bulk-state-${theme}`, async () => {
          await tick("Late delivery alerts for dispatchers");
          await tick("Shipmnt list filter by region");
          await tick("Carrier rate alerts");
        });
        await page.getByRole("button", { name: "Clear", exact: true }).click();
        // 6. Review: before, no title or parent rows.
        await shot(page, `review-${theme}`, async () => {
          await call(page, "ahead.stage", { clientKey: "Atlas", itemId: 3313, field: "size", value: 2 });
          await call(page, "ahead.stage", { clientKey: "Atlas", itemId: 3340, field: "target", value: "2026-12-18" });
          await page.reload();
          await go("#/backlog");
          await page.getByRole("button", { name: "Review" }).click();
          await review().waitFor();
        });
        // 7. Save's results, one with Retry.
        await shot(page, `saved-${theme}`, async () => {
          await call(page, "demo.devops_change", { clientKey: "Atlas", change: { id: 3313, loseNextWrite: true } });
          await saveAll();
        });
      }
      await h.stop();
      started.splice(started.indexOf(h), 1);
    }
    // A missed shot fails the run, so it is seen.
    if (missed.length) throw new Error(`ED-2 shots not taken:\n${missed.join("\n")}`);
  }, T);
});
