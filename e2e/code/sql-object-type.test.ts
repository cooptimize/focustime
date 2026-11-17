// UC-2 (browser, demo mode): with Databases, a second choice narrows to Tables, Views, Stored procedures or
// Functions: in By kind (the Databases group's Show) and in the search (beside Kind, once Databases is chosen). One
// type, or all, which shows what it shows today. It is one choice for both, kept for the visit. Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
let h: Harness;
const panel = (page: Page) => page.locator("[data-code-page]");
/** Every object row in the open database trees, as its file's type folder ("Tables", "Views", …). */
const treeTypes = (page: Page) => panel(page).locator(".cv-sql-row[data-sql-file]").evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute("data-sql-file") ?? "").split("/").slice(-2, -1)[0]))].sort());
const hits = (page: Page) => panel(page).locator("[data-code-results] [data-code-hit]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-code-hit")}|${e.querySelector(".cv-thing-detail")?.textContent ?? ""}`));

describe.skipIf(!CHROMIUM)("UC-2: one object type under Databases (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("narrows By kind's database trees to that type; all types puts them back", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/code/Northwind/kinds"));
    await panel(page).locator("[data-code-kinds]").waitFor({ timeout: 30_000 });
    const dbs = panel(page).locator('[data-code-kind="database"]');
    await dbs.locator("[data-sql-expand]").click();
    const all = await treeTypes(page);
    expect(all).toEqual(expect.arrayContaining(["Tables", "Views", "StoredProcedures", "Functions"]));
    const show = dbs.getByLabel("Object type");
    for (const [type, folder] of [["table", "Tables"], ["view", "Views"], ["procedure", "StoredProcedures"], ["function", "Functions"]] as const) {
      await show.selectOption(type);
      await expect.poll(() => treeTypes(page), { message: type }).toEqual([folder]);
    }
    await show.selectOption("");
    await expect.poll(() => treeTypes(page)).toEqual(all);
    // Review 2: one database open and a type it has none of: the choice stays on screen to undo it.
    const others = dbs.locator('.cv-thing-caret[aria-expanded=true]:not([aria-label="Inside Gold"])');
    while (await others.count()) await others.first().click();
    for (const type of ["table", "view", "procedure", "function"]) {
      await dbs.getByLabel("Object type").selectOption(type);
      await page.waitForTimeout(150);
      expect(await dbs.getByLabel("Object type").count(), type).toBe(1);
      expect(await dbs.locator("[data-sql-group-btn]").count(), type).toBe(2);
    }
    await dbs.getByLabel("Object type").selectOption("");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("narrows the search's names; offered only with Databases; all types shows what it shows today", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/code/Northwind/kinds"));
    await panel(page).locator("[data-code-kinds]").waitFor({ timeout: 30_000 });
    const box = panel(page).locator("[data-code-search]").first();
    await box.click();
    await box.fill("store");
    // Not offered until Databases is the kind.
    expect(await panel(page).locator(".cv-search-sqltype").count()).toBe(0);
    await panel(page).getByLabel("Kind", { exact: true }).selectOption("database");
    const type = panel(page).locator(".cv-search-sqltype");
    await type.waitFor();
    await panel(page).locator(".cv-search-go").click();
    await panel(page).locator("[data-code-results] [data-code-hit]").first().waitFor({ timeout: 30_000 });
    const every = await hits(page);
    expect(every.length).toBeGreaterThan(2);
    for (const [t, one] of [["table", "Table"], ["view", "View"], ["procedure", "Stored procedure"], ["function", "Function"]] as const) {
      await box.click();
      await type.selectOption(t);
      const got = await hits(page);
      expect(got.every((x) => x.split("|")[1]!.startsWith(one)), `${t}: ${got.join(", ")}`).toBe(true);
      expect(got, t).toEqual(every.filter((x) => x.split("|")[1]!.startsWith(`${one} `) || x.split("|")[1] === one));
    }
    await box.click();
    await type.selectOption("");
    expect(await hits(page)).toEqual(every);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
