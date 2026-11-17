// Was e2e/rb4-code.test.ts (RB-4) until BT-1.
// RB-4: Code's search in a browser, on the demo's invented repos. A table inside a warehouse item is found by name,
// with and without the SQL kind, and By kind opens the warehouse to what is inside it; a file that is no thing of its
// own is found under Files. Search inside files asks the demo's fake of DevOps's code search: a table's name lists the
// procedures and pipelines that use it across clients, each client that can't answer says why, a result opens with
// its matches marked and a stepper, Back returns; the words are in no address and no browser storage, and a names
// search still sends none; an admin sees Searched inside files with a client and never the words; the phone. With
// FOCUSTIME_SHOTS set, screenshots for screenshots/rb4 (dark and light at 1440×900, and the phone).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS } from "../shots.ts";

let h: Harness;
const T = 180_000;
const panel = (page: Page) => page.locator("[data-code-page]");
const hash = (page: Page) => page.evaluate(() => location.hash);
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
const hits = (page: Page, within = "") => panel(page).locator(`${within} [data-code-hit]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-code-hit")));
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
function watchActions(page: Page) {
  const sent: { action: string; body: string }[] = [];
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/action")) return;
    const body = r.postData() ?? "";
    sent.push({ action: (JSON.parse(body) as { action: string }).action, body });
  });
  return sent;
}
const SALES = "a1b2c3d4-0001-4000-8000-00000000a001";

describe.skipIf(!CHROMIUM)("Code's search finds what is inside items, and inside files (RB-4)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("a table inside a warehouse is found by name, with and without the SQL kind; By kind opens the warehouse; a plain file is found under Files; the words stay in the browser", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    const sent = watchActions(page);
    await go(page, "#/code/Northwind");
    const box = panel(page).getByRole("searchbox", { name: "Search code" });
    // RB-6: the choices open once the box has focus.
    await box.click();
    expect(await panel(page).locator("[data-code-search-note]").textContent()).toBe("Searches names only. Measures, columns and report pages live inside files: switch to Inside files for those.");
    expect(await panel(page).getByRole("group", { name: "What to search" }).locator("[aria-pressed=true]").textContent()).toBe("Names");
    await box.fill("SalesLine");
    await box.press("Enter");
    const results = panel(page).locator("[data-code-results]");
    await results.locator("[data-code-hit]").first().waitFor();
    expect(await hits(page)).toEqual(["SalesLine", "usp_LoadSalesLine"]);
    expect(await results.locator('[data-code-hit="SalesLine"] .cv-thing-detail').textContent()).toBe("Table in fact · Gold warehouse · sales-analytics");
    await shots(page, "01-table-in-warehouse-by-name");
    // RB-6: Databases keeps it (the warehouse's group, and its objects'); SQL scripts, for loose SQL only, doesn't.
    await panel(page).getByLabel("Kind").selectOption("database");
    expect(await hits(page)).toEqual(["SalesLine", "usp_LoadSalesLine"]);
    // Review 1: a kind it isn't says so with a way out.
    await panel(page).getByLabel("Kind").selectOption("script");
    expect(await results.locator("[data-code-progress]").textContent()).toBe("No name of that kind matches. Try All kinds.");
    await panel(page).getByLabel("Kind").selectOption("report");
    expect(await results.locator("[data-code-progress]").textContent()).toBe("No name of that kind matches. Try All kinds.");
    await panel(page).getByLabel("Kind").selectOption("");
    // Review 1: a table typed with its schema, and a folder inside an item.
    await box.fill("fact.SalesLine");
    await box.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-code-progress]")?.textContent === "1 result");
    expect(await hits(page)).toEqual(["SalesLine"]);
    await box.fill("roles");
    await box.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-code-progress]")?.textContent === "1 result");
    expect(await hits(page)).toEqual(["Store managers.tmdl"]);
    // A file that is no thing of its own is found by its own name, last, under Files.
    await box.fill("definition.pbism");
    await box.press("Enter");
    await results.locator('[data-code-result-kind="files"] [data-code-hit]').waitFor();
    expect(await results.locator(".cv-group-head").allTextContents()).toEqual(["Files"]);
    expect(await results.locator('[data-code-hit="definition.pbism"] .cv-thing-detail').textContent()).toBe("File in Sales semantic model · sales-analytics");
    // Test 8: a names search sends no request that carries the words.
    expect(sent.filter((s) => /salesline|pbism|roles/i.test(s.body))).toEqual([]);
    expect(sent.filter((s) => s.action === "code.search").map((s) => s.body)).toEqual(Array.from({ length: 4 }, () => JSON.stringify({ action: "code.search", input: { clientKey: "Northwind" } })));

    // By kind: the warehouse, under Databases (RB-6), opens to its tables, views and procedures, listed nowhere else.
    await go(page, "#/code/Northwind/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    const lake = panel(page).locator('[data-code-kind="database"]');
    await lake.getByRole("button", { name: "Inside Gold" }).click();
    // RB-5: what is inside is a tree, by schema then type; the table's row sits under fact › Tables.
    await expect.poll(() => lake.locator("[data-sql-folder]").evaluateAll((els) => els.map((e) => e.getAttribute("data-sql-folder")))).toEqual(["dim", "fact", "rpt", "stg", "No schema"]);
    await lake.locator('[data-sql-folder="fact"]').click();
    await lake.locator('[data-sql-folder="Tables"]').click();
    expect(await lake.locator("[data-code-table]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-table")))).toEqual(["Returns", "SalesLine"]);
    expect(await lake.locator('[data-code-thing="Gold"] .cv-thing-detail').textContent()).toBe("Warehouse · 22 objects · sales-analytics");
    expect(await panel(page).locator('[data-code-kinds] [data-code-table="SalesLine"]').count()).toBe(1);
    // A model still opens to its tables.
    await panel(page).locator('[data-code-kind="model"]').getByRole("button", { name: "Tables of Sales" }).click();
    expect(await panel(page).locator('[data-code-kind="model"] [data-code-table]').evaluateAll((els) => els.map((e) => e.getAttribute("data-code-table")))).toEqual(["Date", "Sales", "Store"]);
    await lake.locator('[data-code-table="SalesLine"]').click();
    await panel(page).locator(".cv-file-view").waitFor();
    expect(await panel(page).locator(".cv-file-view").getAttribute("data-code-file")).toBe("/lake/Gold.Warehouse/fact/Tables/SalesLine.sql");
    await shots(page, "02-by-kind-warehouse-open");
    expect(errors).toEqual([]);
  });

  it("inside files: a table's name lists what uses it across clients; each client that can't answer says why; the words are in no address or storage", { timeout: T }, async () => {
    // One slow client, to see the others fill in first: held only while `slow` (FT-1: the route is set before the page
    // opens and stays, so it can't miss the search's requests and every one of them is seen).
    let slow = false;
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 }, {
      before: (p) =>
        p.route("**/api/action", async (route) => {
          if (slow && (route.request().postData() ?? "").includes('"Tailspin"')) await held;
          await route.continue();
        }),
    });
    await theme(page, "dark");
    const sent = watchActions(page);
    // The command menu opens Code with the switch set and the box focused.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Code: search inside files");
    await page.keyboard.press("Enter");
    await panel(page).waitFor();
    expect(await hash(page)).toBe("#/code/~inside");
    const box = panel(page).getByRole("searchbox", { name: "Search code" });
    await box.waitFor();
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-code-search"));
    expect(await panel(page).getByRole("group", { name: "What to search" }).locator("[aria-pressed=true]").textContent()).toBe("Inside files");
    expect(await panel(page).locator("[data-code-search-note]").textContent()).toBe("Each client's DevOps is asked which files hold the words. FocusTime reads no file to search it.");
    // Nothing is asked while typing.
    await page.keyboard.type("Watermarks");
    await page.waitForTimeout(300);
    expect(sent.some((s) => s.action === "code.inside")).toBe(false);

    slow = true;
    await page.keyboard.press("Enter");
    const results = panel(page).locator("[data-code-inside-results]");
    await results.locator('[data-code-result-client="Northwind"]').waitFor();
    await results.locator('[data-code-result-client="Cooptimize"]').waitFor();
    expect(await results.locator("[data-code-progress]").textContent()).toMatch(/^Asked [1-4] of 5 clients…$/);
    release();
    slow = false;
    await results.locator('[data-code-result-client="Tailspin"]').waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-code-progress]")?.textContent?.startsWith("Asked"));
    expect(await results.locator("[data-code-progress]").textContent()).toBe("10 files. 3 of 5 clients could be searched.");
    expect(await results.locator("[data-code-result-client]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-result-client")))).toEqual(["Atlas", "Cooptimize", "Harbor", "Northwind", "Tailspin"]);
    // What uses the table, in two clients and more: procedures and pipelines, each a file with its match count.
    expect(await hits(page, '[data-code-result-client="Atlas"]')).toEqual(["pl_copy_shipments.json", "pl_load_orders.json", "usp_SetWatermark.sql", "Watermarks.sql"]);
    expect(await hits(page, '[data-code-result-client="Northwind"]')).toEqual(["usp_LoadSalesLine.sql", "usp_LoadOrders.sql"]);
    expect(await results.locator('[data-code-result-client="Northwind"] [data-code-hit="usp_LoadSalesLine.sql"]').textContent()).toBe("usp_LoadSalesLine.sqlStored procedure in fact · Gold warehouse1 match/lake/Gold.Warehouse/fact/StoredProcedures/usp_LoadSalesLine.sql");
    // No line of any file is on the screen: only names, kinds, counts and paths.
    expect(await results.textContent()).not.toMatch(/UPDATE|MERGE|SET NOCOUNT|CREATE/);
    // Each client that can't answer says why, in plain words; the team-only client is left out and named.
    expect(await results.locator('[data-code-result-client="Cooptimize"] [data-code-result-failed]').textContent()).toBe("Cooptimize's DevOps doesn't have code search turned on, so FocusTime can't search inside its files. An administrator of that DevOps organization can add Microsoft's Code Search extension to it.");
    expect(await results.locator('[data-code-result-client="Harbor"] [data-code-result-failed]').textContent()).toBe("FocusTime can't read Harbor's code yet. The company DevOps token for Harbor needs Code (read).");
    expect(await results.locator("[data-code-left-out]").textContent()).toBe("Left out: Fabrikam. Only its team can read its code.");
    expect(await results.locator("[data-code-inside-scope]").textContent()).toBe("Only each repo's default branch is searched. Forks aren't searched.");
    await shots(page, "03-inside-files-across-clients");
    await results.locator('[data-code-result-client="Cooptimize"]').scrollIntoViewIfNeeded();
    if (SHOTS) await results.locator('[data-code-result-client="Cooptimize"]').screenshot({ path: `${SHOTS}/04-no-code-search-dark.png` });

    // Review 1: a table typed with its schema finds the files that write it with brackets; clients with nothing are named.
    await box.fill("dbo.Orders");
    await box.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-code-progress]")?.textContent === "4 files. 3 of 5 clients could be searched.");
    expect(await results.locator("[data-code-nothing-in]").textContent()).toBe("Nothing in Atlas and Tailspin.");
    await results.locator('[data-code-result-client="Northwind"] [data-code-hit="vSales.sql"]').click();
    await panel(page).locator(".cv-file-view").waitFor();
    // One match, drawn across the file's colored pieces: "dbo].[Orders" inside "[dbo].[Orders]".
    expect((await panel(page).locator(".cv-file-view mark.cv-mark").allTextContents()).join("")).toBe("dbo].[Orders");
    expect(await panel(page).locator("[data-code-match-at]").textContent()).toBe("1 of 1");
    await panel(page).locator("[data-code-back-to-results]").click();
    await results.waitFor();
    // A warehouse's files pass the Databases kind (RB-6), and so do the SQL project's.
    await panel(page).getByLabel("Kind").selectOption("database");
    expect(await hits(page)).toEqual(["usp_LoadSalesLine.sql", "Orders.sql", "vSales.sql", "usp_LoadOrders.sql"]);
    await panel(page).getByLabel("Kind").selectOption("");
    // A quote left open is refused in plain words, never "no file".
    await box.fill('"Orders');
    await box.press("Enter");
    await results.locator('[data-code-result-client="Northwind"] [data-code-result-failed="bad_query"]').waitFor();
    // FT-1: Northwind answers first; the line is read once every client has (until then it says "Asked 4 of 5…").
    await page.waitForFunction(() => !document.querySelector("[data-code-progress]")?.textContent?.startsWith("Asked"));
    expect(await results.locator("[data-code-progress]").textContent()).toBe("");
    await box.fill("Watermarks");
    await box.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-code-progress]")?.textContent === "10 files. 3 of 5 clients could be searched.");

    // The kind narrows what is shown without asking again (nothing was cut).
    const asked = sent.filter((s) => s.action === "code.inside").length;
    await panel(page).getByLabel("Kind").selectOption("pipeline");
    expect(await hits(page)).toEqual(["pl_copy_shipments.json", "pl_load_orders.json", "pl_copy_flights.json", "pl_load_orders.json"]);
    expect(sent.filter((s) => s.action === "code.inside").length).toBe(asked);
    await panel(page).getByLabel("Kind").selectOption("");

    // The words went only in the search's own requests, one per client a person may read, never for the team-only one.
    const searches = sent.filter((s) => s.action === "code.inside");
    expect(searches.filter((s) => s.body.includes('"Watermarks"')).map((s) => s.body).sort()).toEqual(["Atlas", "Atlas", "Cooptimize", "Cooptimize", "Harbor", "Harbor", "Northwind", "Northwind", "Tailspin", "Tailspin"].map((k) => JSON.stringify({ action: "code.inside", input: { clientKey: k, words: "Watermarks" } })).sort());
    expect(searches.every((s) => !s.body.includes("Fabrikam"))).toBe(true);
    expect(sent.filter((s) => /watermarks/i.test(s.body) && s.action !== "code.inside")).toEqual([]);
    expect(await hash(page)).toBe("#/code/~inside");
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(stored).not.toMatch(/watermark|orders|usp_|~inside/i);
    expect(errors).toEqual([]);
  });

  it("a result opens that client's Code at the file with every match marked and a stepper; Back returns to the results", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    const sent = watchActions(page);
    await go(page, "#/code/Northwind");
    // Inside a client the search starts on This client; the switch moves it to Inside files.
    const box = panel(page).getByRole("searchbox", { name: "Search code" });
    await box.click();
    await panel(page).getByRole("group", { name: "What to search" }).getByRole("button", { name: "Inside files" }).click();
    await box.fill("Orders");
    await panel(page).getByLabel("Kind").selectOption("database");
    await box.press("Enter");
    const results = panel(page).locator("[data-code-inside-results]");
    await results.locator("[data-code-hit]").first().waitFor();
    expect(await hash(page)).toBe("#/code/Northwind/inside");
    expect(sent.filter((s) => s.action === "code.inside").map((s) => s.body)).toEqual([JSON.stringify({ action: "code.inside", input: { clientKey: "Northwind", words: "Orders", kind: "database" } })]);
    expect(await results.locator("[data-code-progress]").textContent()).toBe("4 files");
    expect(await hits(page)).toEqual(["usp_LoadSalesLine.sql", "Orders.sql", "vSales.sql", "usp_LoadOrders.sql"]);
    // Nothing of a file has been asked for yet.
    expect(sent.some((s) => s.action === "code.file")).toBe(false);

    // The keyboard: Down from the box into the results, then Enter on one.
    await box.focus();
    // NM-2: one key at a time, waiting for the focus to land; four quick presses lost one on CI's runners.
    const order = await hits(page);
    for (let n = 0; n < 4; n++) {
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-code-hit"))).toBe(order[n]);
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-code-hit"))).toBe("usp_LoadOrders.sql");
    await page.keyboard.press("Enter");
    const file = panel(page).locator(".cv-file-view");
    await file.waitFor();
    expect(await hash(page)).toBe(`#/code/Northwind/${SALES}/%2Fsql%2Fetl%2FStoredProcedures%2Fusp_LoadOrders.sql`);
    expect(await panel(page).locator("[data-code-title]").getAttribute("data-code-title")).toBe("Northwind");
    // Every match of the words, found in the opened text, and the stepper moves between them.
    // Whole words, as the search matched them: the "Orders" in usp_LoadOrders isn't one.
    expect(await file.locator("mark.cv-mark").allTextContents()).toEqual(["Orders", "Orders", "Orders"]);
    const at = file.locator("[data-code-match-at]");
    expect(await at.textContent()).toBe("1 of 3");
    expect(await file.locator("mark.cv-mark.on").getAttribute("data-code-mark")).toBe("0");
    await file.getByRole("button", { name: "Next match" }).focus();
    await page.keyboard.press("Enter");
    expect(await at.textContent()).toBe("2 of 3");
    expect(await file.locator("mark.cv-mark.on").getAttribute("data-code-mark")).toBe("1");
    await file.getByRole("button", { name: "Previous match" }).click();
    await file.getByRole("button", { name: "Previous match" }).click();
    expect(await at.textContent()).toBe("3 of 3");
    // The file is still text, drawn the same way: the whole line reads as it did.
    expect(await file.locator(".cv-line").first().textContent()).toBe("CREATE PROCEDURE [etl].[usp_LoadOrders]");
    await shots(page, "05-result-opened-matches-marked");

    // Back to the results, as they were, by the button and by the browser's Back.
    await panel(page).locator("[data-code-back-to-results]").click();
    await results.waitFor();
    expect(await hash(page)).toBe("#/code/Northwind/inside");
    expect(await results.locator("[data-code-progress]").textContent()).toBe("4 files");
    expect(await box.inputValue()).toBe("Orders");
    await page.goBack();
    await file.waitFor();
    await page.goBack();
    await results.waitFor();
    // A file opened another way has no marks.
    await go(page, `#/code/Northwind/${SALES}/%2Fsql%2Fdbo%2FTables%2FOrders.sql`);
    await file.waitFor();
    expect(await file.locator("mark.cv-mark").count()).toBe(0);
    expect(await file.locator("[data-code-stepper]").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  it("an admin sees Searched inside files and the opened file in Code views, with a client and never the words", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/code/Atlas/inside");
    const box = panel(page).getByRole("searchbox", { name: "Search code" });
    await box.fill("zzqxnothing OR Watermarks");
    await box.press("Enter");
    await panel(page).locator('[data-code-hit="usp_SetWatermark.sql"]').click();
    await panel(page).locator(".cv-file-view").waitFor();
    await page.evaluate(() => (location.hash = "#/settings/admin-audit/code-views"));
    const table = page.locator('[data-setting="code-views"] table');
    await table.waitFor();
    const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(2).map((td) => td.textContent)));
    expect(rows.filter((r) => r[0] === "Atlas" && r[2] === "Searched inside files")).toEqual([["Atlas", "All its repos", "Searched inside files", ""]]);
    expect(rows.filter((r) => r[0] === "Atlas" && r[2] === "Opened a file")).toEqual([["Atlas", "freight-ingest", "Opened a file", "/sql/etl/StoredProcedures/usp_SetWatermark.sql"]]);
    expect(await table.textContent()).not.toContain("zzqx");
    expect(errors).toEqual([]);
  });

  it("the phone: the switch, a search inside files and its results, a result and Back; no sideways scroll", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await theme(page, "dark");
    await go(page, "#/code/~search");
    const box = panel(page).getByRole("searchbox", { name: "Search code" });
    await box.click();
    await panel(page).getByRole("group", { name: "What to search" }).getByRole("button", { name: "Inside files" }).click();
    expect(await hash(page)).toBe("#/code/~inside");
    await box.fill("Watermarks");
    await box.press("Enter");
    await panel(page).locator('[data-code-result-client="Tailspin"]').waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-code-progress]")?.textContent?.startsWith("Asked"));
    expect(await noSidewaysScroll(page)).toBe(true);
    expect(await panel(page).locator("[data-code-results-page] [data-code-log-line]").textContent()).toContain("Never the words");
    await shots(page, "06-phone-inside-files");
    await panel(page).locator('[data-code-result-client="Northwind"] [data-code-hit="usp_LoadOrders.sql"]').click();
    await panel(page).locator(".cv-file-view").waitFor();
    expect(await panel(page).locator("[data-code-match-at]").textContent()).toBe("1 of 1");
    expect(await noSidewaysScroll(page)).toBe(true);
    await panel(page).getByRole("button", { name: /Back to results/ }).first().click();
    await panel(page).locator('[data-code-result-client="Northwind"]').waitFor();
    expect(await hash(page)).toBe("#/code/~inside");
    expect(errors).toEqual([]);
  });
});
