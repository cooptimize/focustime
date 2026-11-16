// RB-6: the screenshots for screenshots/rb6/<set>/ (dark and light at 1440×900, the top bar at 1280 and 1920, the phone),
// taken on the demo when FOCUSTIME_SHOTS names a folder. It runs on the layout as it is: the "before" set was taken
// with the selectors of the layout before RB-6 (git history), the "after" set with these.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 240_000;
const BEFORE = process.env.FOCUSTIME_RB6_SET === "before";
const root = (page: Page) => page.locator(BEFORE ? "main.code-panel" : "[data-code-page]");
const theme = async (page: Page, t: "dark" | "light") => {
  await page.emulateMedia({ colorScheme: t });
  await page.evaluate((v) => {
    v = v === "light" ? "cooptimize-light" : "cooptimize-dark";
    const w = window as unknown as { __shotTheme?: MutationObserver };
    w.__shotTheme?.disconnect();
    const set = () => document.documentElement.dataset.theme !== v && (document.documentElement.dataset.theme = v);
    set();
    w.__shotTheme = new MutationObserver(set);
    w.__shotTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }, t as string);
};
const shots = async (page: Page, name: string) => {
  for (const t of ["dark", "light"] as const) {
    await theme(page, t);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${name}-${t}.png` });
  }
  await theme(page, "dark");
};
const go = async (page: Page, to: string) => {
  await page.evaluate((x) => (location.hash = x), to);
  await root(page).waitFor();
  await page.waitForTimeout(400);
};
const search = async (page: Page, words: string, opts: { inside?: boolean; all?: boolean } = {}) => {
  const box = page.locator("[data-code-search]").first();
  await box.click();
  if (opts.inside) await page.locator('[data-code-mode="inside"]').first().click();
  if (opts.all) await page.getByRole("button", { name: "All clients" }).first().click();
  await box.fill(words);
  await box.press("Enter");
};

describe.skipIf(!CHROMIUM || !SHOTS)("RB-6 screenshots", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("the set", { timeout: T }, async () => {
    for (const w of [1280, 1920]) {
      const { page } = await freshPage(h, { width: w, height: 900 });
      await go(page, "#/code");
      for (const t of ["dark", "light"] as const) {
        await theme(page, t);
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${SHOTS}/01-top-bar-${w}-${t}.png`, clip: { x: 0, y: 0, width: w, height: 64 } });
      }
      await page.close();
    }
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/code");
    await shots(page, "02-front-page");
    await go(page, "#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001");
    await page.locator('[role="tree"] [data-path="/lake"]').first().click();
    await page.waitForTimeout(300);
    await shots(page, "03-client-files");
    await go(page, "#/code/Northwind/kinds");
    await page.locator("[data-code-kinds]").waitFor();
    await shots(page, "04-client-by-kind");
    // The search row: closed, then open.
    await go(page, "#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001");
    await shots(page, "05-search-closed");
    await page.locator("[data-code-search]").first().click();
    await page.waitForTimeout(200);
    await shots(page, "06-search-open");
    await search(page, "store", { all: true });
    await page.locator("[data-code-results]").waitFor();
    await page.waitForTimeout(800);
    await shots(page, "07-results-names");
    await page.locator("[data-code-hit]").first().click();
    await page.locator(".cv-file-view").waitFor();
    await shots(page, "09-file-from-result");
    await go(page, "#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001");
    await search(page, "StoreKey", { inside: true, all: true });
    await page.locator("[data-code-inside-results]").waitFor();
    await page.waitForTimeout(800);
    await shots(page, "08-results-inside");
    // The Databases group (before RB-6: the warehouse under Lakehouses and warehouses, and the SQL group).
    await go(page, "#/code/Northwind/kinds");
    await page.locator("[data-code-kinds]").waitFor();
    if (BEFORE) await page.getByRole("button", { name: "Inside Gold" }).click();
    else await page.locator('[data-code-kind="database"]').getByRole("button", { name: "Inside Gold" }).click();
    await page.waitForTimeout(300);
    await shots(page, "10-databases");
    await page.close();
    // The phone.
    const phone = await freshPage(h, { width: 390, height: 844 });
    await go(phone.page, "#/code/Northwind/kinds");
    await phone.page.waitForTimeout(600);
    await shots(phone.page, "11-phone");
    await phone.page.close();
  });
});
