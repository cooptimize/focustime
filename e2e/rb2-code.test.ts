// RB-2: Code by kind and Search names in a browser, on the demo's invented repos. By kind lists every group across a
// client's repos, a model opens to its tables, a row opens its file and Show in files lands on its folder; a search
// across clients fills in by client, says which client was left out and which failed, the keyboard reaches a result
// and opens it, Back returns to the results; the words typed are in no request, no address and no browser storage; an
// admin sees the two new rows in Code views; the phone. With FOCUSTIME_SHOTS set, screenshots for docs/ux/rb2 (dark
// and light at 1440×900, and the phone).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 180_000;
const panel = (page: Page) => page.locator("main.code-panel");
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
/** <name>-dark.png and <name>-light.png, then back to dark. */
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
const group = (page: Page, kind: string) => panel(page).locator(`[data-code-kind="${kind}"]`);
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Every action the page asks the server for from here on, with what it sends. */
function watchActions(page: Page) {
  const sent: { action: string; body: string }[] = [];
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/action")) return;
    const body = r.postData() ?? "";
    sent.push({ action: (JSON.parse(body) as { action: string }).action, body });
  });
  return sent;
}

describe.skipIf(!CHROMIUM)("Code by kind and Search names (RB-2)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("By kind lists every group across a client's repos; a model opens to its tables; a row opens its file; Show in files lands on its folder", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    const sent = watchActions(page);
    await go(page, "#/code/Northwind");
    const views = panel(page).locator(".cv-views");
    expect(await views.locator("[aria-pressed=true]").textContent()).toBe("Files");
    await views.getByRole("button", { name: "By kind" }).click();
    expect(await hash(page)).toBe("#/code/Northwind/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    // Every group, in order, with its count; an empty group wouldn't show.
    expect(await panel(page).locator(".cv-kind-head .cv-kind-label").allTextContents()).toEqual(["Reports", "Semantic models", "Pipelines", "Notebooks", "Dataflows", "Lakehouses and warehouses", "SQL", "Other Fabric items", "Other"]);
    expect(await group(page, "report").locator("[data-code-thing]").allTextContents()).toEqual(["SalesReport · sales-analytics", "Store visitsReport · store-portal"]);
    expect(await group(page, "lake").locator(".cv-thing-name").allTextContents()).toEqual(["Bronze", "Gold"]);
    expect(await group(page, "fabric").locator(".cv-thing-detail").allTextContents()).toEqual(["Activator · sales-analytics"]);
    expect(await group(page, "sql").locator(".cv-thing-detail").allTextContents()).toContain("Stored procedure in etl · sales-analytics");
    // Names only: the repos and By kind's one read, never a folder or a file.
    expect([...new Set(sent.map((s) => s.action).filter((a) => a.startsWith("code.")))]).toEqual(["code.clients", "code.repos", "code.kinds"]);
    await shots(page, "01-by-kind");

    // A model opens to its tables.
    const model = group(page, "model").locator(".cv-thing", { hasText: "Sales" }).first();
    const caret = model.getByRole("button", { name: "Tables of Sales" });
    expect(await caret.getAttribute("aria-expanded")).toBe("false");
    await caret.click();
    expect(await caret.getAttribute("aria-expanded")).toBe("true");
    expect(await model.locator("[data-code-table]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-table")))).toEqual(["Date", "Sales", "Store"]);
    await shots(page, "02-model-tables");

    // A table opens its file on the right, and says where it lives.
    await model.locator('[data-code-table="Date"]').click();
    const file = panel(page).locator(".cv-file-view");
    await file.waitFor();
    expect(await file.getAttribute("data-code-file")).toBe("/model/Sales.SemanticModel/definition/tables/Date.tmdl");
    expect(await hash(page)).toBe("#/code/Northwind/kinds/a1b2c3d4-0001-4000-8000-00000000a001/%2Fmodel%2FSales.SemanticModel%2Fdefinition%2Ftables%2FDate.tmdl");
    expect(await panel(page).locator("[data-code-lives] span").textContent()).toBe("In sales-analytics, /model/Sales.SemanticModel/definition/tables");
    // Still no folder read: By kind opens a file without the tree.
    expect(sent.some((s) => s.action === "code.folder" || s.action === "code.find")).toBe(false);
    await shots(page, "03-file-open");

    // The filter narrows by name as you type.
    const filter = panel(page).getByLabel("Filter by name");
    await filter.fill("orders");
    expect(await panel(page).locator("[data-code-thing]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-thing")))).toEqual(["Clean orders", "Orders", "usp_LoadOrders", "sample-orders.csv"]);
    await shots(page, "04-filter");
    await filter.fill("");

    // Show in files: Files, with the tree open at its folder and the file still open.
    await panel(page).locator("[data-code-show-in-files]").click();
    expect(await hash(page)).toBe("#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001/%2Fmodel%2FSales.SemanticModel%2Fdefinition%2Ftables%2FDate.tmdl");
    await panel(page).locator('.cv-tree [data-path="/model/Sales.SemanticModel/definition/tables/Date.tmdl"]').waitFor();
    expect(await views.locator("[aria-pressed=true]").textContent()).toBe("Files");
    // Back returns to By kind on the same file.
    await page.goBack();
    await panel(page).locator("[data-code-kinds]").waitFor();
    expect(await hash(page)).toContain("/kinds/");
    // A reopened By kind address lands on it.
    await page.reload();
    await panel(page).locator("[data-code-kinds]").waitFor();
    expect(await panel(page).locator(".cv-file-view").getAttribute("data-code-file")).toBe("/model/Sales.SemanticModel/definition/tables/Date.tmdl");
    expect(errors).toEqual([]);
  });

  it("a search across clients groups by client, names the client left out and the one that failed; the keyboard opens a result and Back returns; the words go nowhere", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    const sent = watchActions(page);
    // The command menu opens Code with the box focused.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Code: search names");
    await page.keyboard.press("Enter");
    await panel(page).waitFor();
    expect(await hash(page)).toBe("#/code/~search");
    const box = panel(page).getByRole("searchbox", { name: "Search names" });
    await box.waitFor();
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-code-search"));
    expect(await panel(page).locator(".cv-search-note").textContent()).toBe("Searches names only. Measures, columns and report pages live inside files and aren't searched.");
    // Nothing is read while typing.
    await page.keyboard.type("orders");
    await page.waitForTimeout(300);
    expect(sent.some((s) => s.action === "code.search")).toBe(false);

    // One slow client, to see the others fill in first.
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/action", async (route) => {
      if ((route.request().postData() ?? "").includes('"Tailspin"')) await held;
      await route.continue();
    });
    await page.keyboard.press("Enter");
    const results = panel(page).locator("[data-code-results]");
    await results.locator('[data-code-result-client="Northwind"]').waitFor();
    await results.locator("[data-code-result-failed]").waitFor();
    expect(await results.locator("[data-code-progress]").textContent()).toMatch(/^Read [1-4] of 5 clients…$/);
    await shots(page, "06-search-reading");
    release();
    await results.locator('[data-code-result-client="Tailspin"]').waitFor();
    await page.unroute("**/api/action");
    expect(await results.locator("[data-code-progress]").textContent()).toBe("6 results");
    // By client, in the list's order; the team-only client is named as left out; the one without Code (read) says why.
    expect(await results.locator("[data-code-result-client]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-result-client")))).toEqual(["Atlas", "Harbor", "Northwind", "Tailspin"]);
    expect(await results.locator("[data-code-left-out]").textContent()).toBe("Left out: Fabrikam. Only its team can read its code.");
    expect(await results.locator('[data-code-result-client="Harbor"] [data-code-result-failed]').textContent()).toBe("FocusTime can't read Harbor's code yet. The company DevOps token for Harbor needs Code (read).");
    const north = results.locator('[data-code-result-client="Northwind"]');
    expect(await north.locator(".cv-group-head").allTextContents()).toEqual(["Notebooks", "SQL", "Other"]);
    expect(await north.locator("[data-code-hit]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-hit")))).toEqual(["Clean orders", "Orders", "usp_LoadOrders", "sample-orders.csv"]);
    expect(await results.locator('[data-code-result-client="Atlas"] .cv-hit-where mark').allTextContents()).toEqual(["orders"]);
    await shots(page, "05-search-results");

    // A kind narrows what is shown without another read.
    const asked = sent.filter((s) => s.action === "code.search").length;
    await panel(page).getByLabel("Kind").selectOption("pipeline");
    expect(await results.locator("[data-code-hit]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-hit")))).toEqual(["pl_load_orders", "pl_load_orders"]);
    expect(sent.filter((s) => s.action === "code.search").length).toBe(asked);
    await panel(page).getByLabel("Kind").selectOption("");

    // The keyboard: Down from the box to the first result, Down again, Enter opens that client's Code at the file.
    await box.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-code-hit"))).toBe("Clean orders");
    await page.keyboard.press("Enter");
    await panel(page).locator(".cv-file-view").waitFor();
    expect(await hash(page)).toBe("#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001/%2Fpipelines%2FClean%20orders.Notebook%2Fnotebook-content.py");
    expect(await panel(page).locator("[data-code-title]").getAttribute("data-code-title")).toBe("Northwind");
    // Back returns to the results, as they were.
    await page.goBack();
    await results.waitFor();
    expect(await hash(page)).toBe("#/code/~search");
    expect(await results.locator("[data-code-progress]").textContent()).toBe("6 results");
    expect(await box.inputValue()).toBe("orders");

    // The words typed: in no request, not in the address, not in the browser's storage. Nor is any name.
    const searches = sent.filter((s) => s.action === "code.search");
    expect(searches.map((s) => s.body).sort()).toEqual(["Atlas", "Cooptimize", "Harbor", "Northwind", "Tailspin"].map((k) => JSON.stringify({ action: "code.search", input: { clientKey: k } })).sort());
    // The only requests that name anything are the opened file's own reads (its path, as RB-1 sends it).
    expect(sent.filter((s) => /orders/i.test(s.body)).map((s) => s.action).filter((a) => a !== "code.file" && a !== "code.folder")).toEqual([]);
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(stored).not.toMatch(/orders|pl_load|\.tmdl|notebook-content|~search/i);
    expect(errors).toEqual([]);
  });

  it("inside a client the search starts on This client, and All clients widens it", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const sent = watchActions(page);
    await go(page, "#/code/Atlas");
    const box = panel(page).getByRole("searchbox", { name: "Search names" });
    await box.fill("shipments pl");
    const where = panel(page).getByRole("group", { name: "Where to search" });
    expect(await where.locator("[aria-pressed=true]").textContent()).toBe("This client");
    await box.press("Enter");
    const results = panel(page).locator("[data-code-results]");
    await results.locator("[data-code-hit]").first().waitFor();
    expect(await hash(page)).toBe("#/code/Atlas/search");
    expect(sent.filter((s) => s.action === "code.search").map((s) => s.body)).toEqual([JSON.stringify({ action: "code.search", input: { clientKey: "Atlas" } })]);
    expect(await results.locator("[data-code-hit]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-hit")))).toEqual(["pl_copy_shipments"]);
    await panel(page).getByRole("group", { name: "Where to search" }).getByRole("button", { name: "All clients" }).click();
    await panel(page).getByRole("button", { name: "Search", exact: true }).click();
    await results.locator('[data-code-result-client="Tailspin"]').waitFor();
    expect(await hash(page)).toBe("#/code/~search");
    // Review 2: Back to the client's own search never shows the wider search's names under that client's name.
    await page.goBack();
    expect(await hash(page)).toBe("#/code/Atlas/search");
    await panel(page).locator(".cv-search-page").waitFor();
    expect(await panel(page).locator("[data-code-result-client]").count()).toBe(0);
    expect(await panel(page).locator(".cv-search-page .cv-note").last().textContent()).toBe("Type a name, then press Enter or Search.");
    expect(errors).toEqual([]);
  });

  it("the phone: By kind as a list, a row's file as its own page; a search and its results; no sideways scroll", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await theme(page, "dark");
    await go(page, "#/code/Northwind/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    expect(await noSidewaysScroll(page)).toBe(true);
    await shots(page, "10-phone-by-kind");
    await group(page, "pipeline").locator('[data-code-thing="Load sales"]').click();
    await panel(page).locator(".cv-file-view").waitFor();
    expect(await noSidewaysScroll(page)).toBe(true);
    await panel(page).getByRole("button", { name: /By kind/ }).first().click();
    await panel(page).locator("[data-code-kinds]").waitFor();
    await go(page, "#/code/~search");
    const box = panel(page).getByRole("searchbox", { name: "Search names" });
    await box.fill("sales");
    await box.press("Enter");
    await panel(page).locator('[data-code-result-client="Northwind"]').waitFor();
    expect(await noSidewaysScroll(page)).toBe(true);
    await shots(page, "11-phone-search");
    expect(errors).toEqual([]);
  });

  it("an admin sees Listed by kind and Searched names in Code views, with a client and nothing else", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/code/Atlas/kinds");
    await panel(page).locator("[data-code-kinds]").waitFor();
    await go(page, "#/code/~search");
    const box = panel(page).getByRole("searchbox", { name: "Search names" });
    await box.fill("zzzz-nothing");
    await box.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-code-progress]")?.textContent === "No name matches.");
    await page.evaluate(() => (location.hash = "#/settings/admin-audit/code-views"));
    const table = page.locator('[data-setting="code-views"] table');
    await table.waitFor();
    const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(2).map((td) => td.textContent)));
    expect(rows.filter((r) => r[2] === "Searched names").map((r) => r[0]).sort()).toEqual(["Atlas", "Cooptimize", "Northwind", "Tailspin"]);
    expect(rows.filter((r) => r[2] === "Listed by kind")).toEqual([["Atlas", "All its repos", "Listed by kind", ""]]);
    expect(await table.textContent()).not.toContain("zzzz");
    await shots(page, "07-code-views");
    expect(errors).toEqual([]);
  });
});
