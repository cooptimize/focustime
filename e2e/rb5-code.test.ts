// RB-5: Code's By kind lists a database's SQL objects in folders, in a browser, on the demo's invented repos. A
// warehouse opens to its schemas, then the types in each; the Group by switch turns that into types, then schemas,
// with the open table still open and the tree opened to it; the switch is the same inside the warehouse and in the
// SQL group, and the choice is remembered in the demo session only; switching asks the server for nothing but to
// remember it; the filter narrows the tree and clearing it puts it back; a client with more than one database gets
// the database first; the keyboard walks the tree; the phone shows the same. With FOCUSTIME_SHOTS set, screenshots
// for docs/ux/rb5/after (dark and light at 1440×900, and the phone).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 180_000;
const panel = (page: Page) => page.locator("main.code-panel");
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
  if (!SHOTS) return;
  for (const t of ["dark", "light"] as const) {
    await theme(page, t);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${t}.png` });
  }
  await theme(page, "dark");
};
const go = async (page: Page, to: string) => {
  await page.evaluate((x) => (location.hash = x), to);
  await panel(page).waitFor();
};
function watchActions(page: Page) {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/action")) sent.push((JSON.parse(r.postData() ?? "{}") as { action: string }).action);
  });
  return sent;
}
/** A tree's rows as they show: "1 dim 5", "2 Tables 3", "3 Store". */
const rows = (tree: Locator) =>
  tree.locator('[role="treeitem"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-level")} ${e.querySelector(".cv-thing-name, .cv-sql-more")?.textContent}${e.querySelector(".cv-kind-count") ? ` ${e.querySelector(".cv-kind-count")!.textContent}` : ""}`));
const folder = (tree: Locator, label: string, level = 1) => tree.locator(`[data-sql-folder="${label}"][data-sql-level="${level}"]`);
const call = (page: Page, action: string, input: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>;

describe.skipIf(!CHROMIUM)("Code lists a database's SQL objects by schema then type, or by type then schema (RB-5)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("a warehouse opens to schemas then types; Type turns it round with the table still open; the switch is one, remembered, and asks for nothing else", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    const sent = watchActions(page);
    await go(page, "#/code/Northwind/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    const lake = panel(page).locator('[data-code-kind="lake"]');
    await lake.getByRole("button", { name: "Inside Gold" }).click();
    const tree = lake.getByRole("tree", { name: "SQL objects of Gold" });
    // Schemas by name, No schema last, each with its count; folders start closed.
    expect(await rows(tree)).toEqual(["1 dim 5", "1 fact 4", "1 rpt 5", "1 stg 4", "1 No schema 4"]);
    expect(await lake.locator("[data-sql-group]").getAttribute("data-sql-group")).toBe("schema");
    await shots(page, "01-warehouse-open");
    await folder(tree, "dim").click();
    expect((await rows(tree)).slice(0, 4)).toEqual(["1 dim 5", "2 Tables 3", "2 Views 1", "2 Functions 1"]);
    await folder(tree, "Tables", 2).click();
    // Under dim › Tables a row says only its name.
    expect(await tree.locator('[data-code-table="Store"]').textContent()).toBe("Store");
    expect((await rows(tree)).slice(0, 5)).toEqual(["1 dim 5", "2 Tables 3", "3 Date", "3 Product", "3 Store"]);
    // A screen reader hears a folder's name, level and count.
    expect(await folder(tree, "dim").evaluate((e) => [e.getAttribute("role"), e.getAttribute("aria-level"), e.getAttribute("aria-expanded"), e.getAttribute("aria-label")])).toEqual(["treeitem", "1", "true", "dim, 5"]);
    await tree.locator('[data-code-table="Store"]').click();
    await panel(page).locator(".cv-file-view").waitFor();
    expect(await panel(page).locator(".cv-file-view").getAttribute("data-code-file")).toBe("/lake/Gold.Warehouse/dim/Tables/Store.sql");
    expect(await panel(page).locator("[data-code-show-in-files]").count()).toBe(1);
    await shots(page, "02-by-schema");
    // A schema's own definition is a Schema under its schema; the role, the shared query, the project file and the
    // loose script have no schema.
    await folder(tree, "stg").click();
    expect((await rows(tree)).filter((r) => r.startsWith("2 ")).slice(-3)).toEqual(["2 Tables 2", "2 Stored procedures 1", "2 Schemas 1"]);
    await folder(tree, "No schema").click();
    expect((await rows(tree)).slice(-4)).toEqual(["2 Security 1", "2 Shared queries 1", "2 SQL projects 1", "2 Scripts 1"]);

    // Type: types then schemas, the same table still open on the right and the tree opened to it.
    const before = sent.length;
    await lake.locator('[data-sql-group-btn="type"]').click();
    await expect.poll(() => lake.locator("[data-sql-group]").getAttribute("data-sql-group")).toBe("type");
    expect(await rows(tree)).toEqual(["1 Tables 7", "2 dim 3", "3 Date", "3 Product", "3 Store", "2 fact 2", "2 stg 2", "1 Views 4", "1 Stored procedures 3", "1 Functions 2", "1 Schemas 2", "1 Security 1", "1 Shared queries 1", "1 SQL projects 1", "1 Scripts 1"]);
    expect(await panel(page).locator(".cv-file-view").getAttribute("data-code-file")).toBe("/lake/Gold.Warehouse/dim/Tables/Store.sql");
    expect(await tree.locator('[data-sql-file="/lake/Gold.Warehouse/dim/Tables/Store.sql"]').getAttribute("aria-current")).toBe("true");
    // The two tables that share a name sit side by side under Tables, each in its schema.
    await folder(tree, "stg", 2).click();
    expect(await tree.locator('[data-code-table="Store"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-sql-file")))).toEqual(["/lake/Gold.Warehouse/dim/Tables/Store.sql", "/lake/Gold.Warehouse/stg/Tables/Store.sql"]);
    await shots(page, "03-by-type");
    // Names only: switching asked the server for nothing but to remember the choice.
    await expect.poll(() => sent.slice(before)).toEqual(["ui.set_code_sql_group"]);
    expect([...new Set(sent.filter((a) => a.startsWith("code.")))].sort()).toEqual(["code.clients", "code.file", "code.kinds", "code.repos"]);

    // The same switch in the SQL group: it is already on Type there, and a client with three databases gets the
    // database first.
    const sql = panel(page).locator('[data-code-kind="sql"]');
    const sqlTree = sql.getByRole("tree", { name: "SQL objects" });
    expect(await sql.locator("[data-sql-group]").getAttribute("data-sql-group")).toBe("type");
    expect((await rows(sqlTree)).filter((r) => r.startsWith("1 "))).toEqual(["1 Gold warehouse · sales-analytics 22", "1 Returns SQL database · sales-analytics 9", "1 Warehouse SQL project · sales-analytics 4", "1 Not in a database 1"]);
    await sql.locator('[data-sql-group-btn="schema"]').click();
    await expect.poll(() => lake.locator("[data-sql-group]").getAttribute("data-sql-group")).toBe("schema");
    await folder(sqlTree, "Returns SQL database · sales-analytics").click();
    // (The Gold warehouse above it is open to the table on the right.)
    const all = await rows(sqlTree);
    const from = all.indexOf("1 Returns SQL database · sales-analytics 9");
    expect(all.slice(from + 1, from + 6)).toEqual(["2 audit 2", "2 ops 4", "2 ref 1", "2 stg 1", "2 No schema 1"]);
    expect(all.slice(0, from).filter((r) => r.startsWith("3 "))).toEqual(["3 Tables 3", "3 Views 1", "3 Functions 1"]);
    await sql.scrollIntoViewIfNeeded();
    await sqlTree.locator('[data-sql-folder="ops"]').click();
    await shots(page, "05-sql-group");

    // Remembered: the demo session's own settings hold it, and a reload opens on it.
    await sql.locator('[data-sql-group-btn="type"]').click();
    await expect.poll(async () => (await call(page, "week.load", {})).data.ui.codeSqlGroup).toBe("type");
    await page.reload();
    await go(page, "#/code/Northwind/kinds");
    await panel(page).locator('[data-code-kind="sql"] [data-sql-group="type"]').waitFor();
    // A demo session's choice is nobody's: another demo session starts on Schema.
    const other = await freshPage(h, { width: 1440, height: 900 });
    expect((await call(other.page, "week.load", {})).data.ui.codeSqlGroup).toBe("schema");
    expect(errors).toEqual([]);
  });

  it("the filter narrows the tree: folders without a match hide, the others open, counts show matches; clearing puts it back", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    await go(page, "#/code/Northwind/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    const lake = panel(page).locator('[data-code-kind="lake"]');
    await lake.getByRole("button", { name: "Inside Gold" }).click();
    const tree = lake.getByRole("tree", { name: "SQL objects of Gold" });
    await folder(tree, "fact").click();
    const was = await rows(tree);
    await panel(page).getByLabel("Filter by name").fill("store");
    expect(await rows(tree)).toEqual(["1 dim 2", "2 Tables 1", "3 Store", "2 Views 1", "3 vStoreRegion", "1 rpt 2", "2 Views 2", "3 vStoreSales", "3 vTopStores", "1 stg 2", "2 Tables 1", "3 Store", "2 Stored procedures 1", "3 usp_StageStore"]);
    await shots(page, "04-filter");
    await panel(page).getByLabel("Filter by name").fill("");
    expect(await rows(tree)).toEqual(was);
    // Expand all and Collapse all.
    await lake.locator("[data-sql-expand]").click();
    expect((await rows(tree)).length).toBe(5 + 17 + 22);
    await lake.locator("[data-sql-collapse]").click();
    expect(await rows(tree)).toEqual(["1 dim 5", "1 fact 4", "1 rpt 5", "1 stg 4", "1 No schema 4"]);
    // One database or none: the grouping starts at the top (Atlas has loose SQL files only).
    await go(page, "#/code/Atlas/kinds");
    const sqlTree = panel(page).locator('[data-code-kind="sql"]').getByRole("tree", { name: "SQL objects" });
    await sqlTree.waitFor();
    expect(await rows(sqlTree)).toEqual(["1 No schema 2", "2 Tables 1", "2 Stored procedures 1"]);
    expect(errors).toEqual([]);
  });

  it("the keyboard walks the tree: Down and Up move, Right opens, Left closes, Enter opens the file", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/code/Northwind/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    const lake = panel(page).locator('[data-code-kind="lake"]');
    await lake.getByRole("button", { name: "Inside Gold" }).click();
    const tree = lake.getByRole("tree", { name: "SQL objects of Gold" });
    const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.querySelector(".cv-thing-name")?.textContent ?? null);
    // One row takes Tab; the arrows go from there.
    expect(await tree.locator('[tabindex="0"]').count()).toBe(1);
    await folder(tree, "dim").focus();
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe("fact");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    expect(await folder(tree, "dim").getAttribute("aria-expanded")).toBe("true");
    await page.keyboard.press("ArrowRight");
    expect(await focused()).toBe("Tables");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe("Store");
    await page.keyboard.press("Enter");
    await panel(page).locator(".cv-file-view").waitFor();
    expect(await panel(page).locator(".cv-file-view").getAttribute("data-code-file")).toBe("/lake/Gold.Warehouse/dim/Tables/Store.sql");
    // The opened file takes the focus, as it does everywhere in the panel; Tab comes back to the row that was left.
    expect(await tree.locator('[tabindex="0"]').getAttribute("data-code-table")).toBe("Store");
    await tree.locator('[tabindex="0"]').focus();
    // Left on an object goes to its folder; Left on an open folder closes it.
    await page.keyboard.press("ArrowLeft");
    expect(await focused()).toBe("Tables");
    await page.keyboard.press("ArrowLeft");
    expect(await folder(tree, "Tables", 2).getAttribute("aria-expanded")).toBe("false");
    await page.keyboard.press("ArrowLeft");
    expect(await focused()).toBe("dim");
    await page.keyboard.press("End");
    expect(await focused()).toBe("No schema");
    await page.keyboard.press("Home");
    expect(await focused()).toBe("dim");
    expect(errors).toEqual([]);
  });

  it("the phone: the same switch and tree in its list, kept open when a file is opened and closed", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await theme(page, "dark");
    await go(page, "#/code/Northwind/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    const lake = panel(page).locator('[data-code-kind="lake"]');
    await lake.getByRole("button", { name: "Inside Gold" }).click();
    const tree = lake.getByRole("tree", { name: "SQL objects of Gold" });
    await folder(tree, "dim").click();
    await folder(tree, "Tables", 2).click();
    await lake.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shots(page, "06-phone");
    await tree.locator('[data-code-table="Store"]').click();
    await panel(page).locator(".cv-file-view").waitFor();
    await page.goBack();
    await tree.locator('[data-code-table="Store"]').waitFor();
    await lake.locator('[data-sql-group-btn="type"]').click();
    expect((await rows(tree)).filter((r) => r.startsWith("1 ")).slice(0, 4)).toEqual(["1 Tables 7", "1 Views 4", "1 Stored procedures 3", "1 Functions 2"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});
