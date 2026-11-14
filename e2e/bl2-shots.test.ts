// BL-2: the before and after screenshots, one script for both so the pairs match. Only when BL2_SHOTS names a folder
// (docs/ux/bl2/before or docs/ux/bl2/after); nothing runs otherwise. Dark and light at 1440x900: the Grid at Epics,
// Features and Stories; a feature opened to its stories; Epics with everything opened; the Epic filter on at Features;
// the Gantt at Features; a client listed by target date; the Filter popover. Demo data only. A shot that can't be
// reached is named in the log and skipped.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { moreItem, openFilter, pickLevel } from "./backlog-helpers.ts";

const DIR = process.env.BL2_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);

async function shot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("BL-2 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) console.log(`BL-2 shots not taken:\n${missed.join("\n")}`);
    for (const h of started) await h.stop();
  });

  it("Backlog's levels, in the Grid and the Gantt", async () => {
    const h = await startDemo();
    started.push(h);
    for (const theme of ["dark", "light"] as const) {
      const { page } = await freshPage(h, { width: 1440, height: 900 });
      await call(page, "ui.set_theme", { theme: `cooptimize-${theme}` });
      const go = async (hash: string) => {
        await page.evaluate((x) => (location.hash = x), hash);
        await page.locator(".ah-client, .pa-row").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(500);
      };
      // Atlas only, everyone's items: its epics are ranked one way and their features another.
      await page.reload();
      await go("#/backlog");
      const only = async (name: string) => {
        const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
        for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
        await chips.getByRole("button", { name, exact: true }).click();
        await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
        await page.waitForTimeout(300);
      };
      await only("Atlas Freight");
      const level = async (name: string) => {
        await pickLevel(page, name);
        await page.waitForTimeout(300);
      };
      await shot(page, `grid-epics-${theme}`, () => level("Epics"));
      await shot(page, `grid-features-${theme}`, () => level("Features"));
      await shot(page, `grid-stories-${theme}`, () => level("Stories"));
      await shot(page, `feature-opened-${theme}`, async () => {
        await level("Features");
        const row = page.locator(".ah-row", { hasText: "Shipment tracking dashboard" }).first();
        const caret = row.locator(".ah-chev").first();
        // Open it when it is closed (before BL-2, Features showed features closed too).
        if ((await caret.getAttribute("aria-expanded")) !== "true") await caret.click();
      });
      await shot(page, `epics-expanded-${theme}`, async () => {
        await level("Epics");
        await moreItem(page, "Expand all");
      });
      await shot(page, `epic-filter-${theme}`, async () => {
        await level("Features");
        const pop = await openFilter(page);
        await pop.getByRole("button", { name: /^Epic/ }).first().click();
        await page.getByRole("option", { name: /Shipment visibility/ }).click();
        await page.keyboard.press("Escape");
        await page.locator(".ah-filter-pop").waitFor({ state: "detached" }).catch(() => null);
      });
      // Back to every epic.
      await page.locator(".ah-tb-chip[data-chip=epic]").click().catch(() => null);
      await shot(page, `filter-popover-${theme}`, async () => {
        await level("Features");
        await openFilter(page);
      });
      await page.keyboard.press("Escape");
      await shot(page, `gantt-features-${theme}`, async () => {
        await page.getByRole("button", { name: "Gantt", exact: true }).click();
        await page.locator(".pa-row").first().waitFor({ timeout: 30_000 });
        await level("Features");
      });
      await shot(page, `target-date-client-${theme}`, async () => {
        await page.getByRole("button", { name: "Grid", exact: true }).click();
        await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
        await only("Harbor Health");
        await level("Features");
      });
      await page.close();
    }
  }, T);
});
