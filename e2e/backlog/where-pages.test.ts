// RB-3b: the lookup's second level for the layouts RB-3 left out, on the demo's invented code (sources/demo/code.ts):
// a report in the PBIR format (one page.json per page, a hidden page), a model kept as one model.bim (its tables, then
// a table's measures and columns from the same read), and measures declared apart from their table. Each listing is
// one code.inner request and one Code log row with the repo and the thing's file; no row per file. Edge cases and
// limits are unit tests (actions/code-inner.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS } from "../shots.ts";

let h: Harness;
const T = 240_000;
const VIEW = { width: 1440, height: 900 };
const call = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: R; error?: string }>;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-dark"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await page.emulateMedia({ colorScheme: "light" });
}
function actions(page: Page): { action: string; input: Record<string, unknown> }[] {
  const seen: { action: string; input: Record<string, unknown> }[] = [];
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/action") || r.method() !== "POST") return;
    try {
      const b = JSON.parse(r.postData() ?? "{}") as { action: string; input: Record<string, unknown> };
      seen.push({ action: b.action, input: b.input ?? {} });
    } catch {
      /* not an action */
    }
  });
  return seen;
}
const form = (page: Page) => page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });
const whereBox = (scope: Locator) => scope.locator('textarea[data-question="where"]');
const list = (page: Page) => page.getByRole("listbox");
const option = (page: Page, name: string | RegExp) => list(page).getByRole("option", { name });
async function choose(page: Page, scope: Locator, label: string, value: string) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const pop = page.locator(".cell-pop");
  const box = pop.getByRole("combobox");
  if (await box.count()) await box.fill(value);
  await pop.getByRole("option", { name: value }).first().click();
}
async function downTo(page: Page, name: string, key = "Enter") {
  for (let n = 0; n < 60; n++) {
    await page.keyboard.press("ArrowDown");
    const on = await list(page).locator('[role=option][aria-selected="true"]').getAttribute("aria-label");
    if (on?.startsWith(name)) return void (await page.keyboard.press(key));
  }
  throw new Error(`no row ${name}`);
}
type View = { event: string; clientKey: string; repoName: string; path: string };
const views = async (page: Page) => (await call<{ views: View[] }>(page, "admin.code_views", {})).data.views;

describe.skipIf(!CHROMIUM)("RB-3b: pages in today's report format and a one-file model's tables (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a report's pages in its order with the hidden one marked; a one-file model's tables, then a table's measures; measures kept apart; one row per listing", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    const seen = actions(page);
    const before = (await views(page)).length;
    await page.evaluate(() => (location.hash = "#/ahead"));
    await page.locator(".ah-new").click({ timeout: 30_000 });
    const f = form(page);
    await f.waitFor();
    await choose(page, f, "Client", "Northwind");
    await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
    const box = whereBox(f);
    await box.focus();

    // A report in today's format: "Pages" lists its pages in the report's own order, the hidden one marked.
    // Two words typed as one name: the pick from its pages replaces them both (review 3).
    await page.keyboard.type("The region revi");
    await list(page).waitFor({ timeout: 30_000 });
    await downTo(page, "Region review, Report", "ArrowRight");
    await option(page, /^Summary, Page of Region review/).waitFor({ timeout: 30_000 });
    const pages = await list(page).getByRole("option").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(pages).toEqual(["Back", "Summary, Page of Region review", "By region, Page of Region review", "Store detail, Page of Region review", "Store drill-through, Page of Region review · Hidden"]);
    await shot(page, "rb3b-pages-pbir");
    await downTo(page, "Store drill-through");
    await expect(box.inputValue()).resolves.toBe("The Store drill-through (hidden page, Region review report)");

    // A model kept as one file: its tables under it, then a table's measures and columns from the same read.
    await f.getByRole("button", { name: "Browse Northwind's code" }).click();
    await downTo(page, "Returns, Semantic model", "ArrowRight");
    await option(page, /^Reason codes, Table/).waitFor({ timeout: 30_000 });
    await shot(page, "rb3b-model-tables");
    await downTo(page, "Returns, Table", "ArrowRight");
    await option(page, /^Return Rate, Measure/).waitFor();
    expect(await list(page).getByRole("option").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Back", "Return Rate, Measure · Returns table", "Returned Amount, Measure · Returns table", "ReturnId, Column · Returns table", "Reason, Column · Returns table", "Amount, Column · Returns table"]);
    await downTo(page, "Return Rate");
    await expect(box.inputValue()).resolves.toBe("The Store drill-through (hidden page, Region review report) Return Rate (measure, Returns table, Returns semantic model)");

    // Measures declared in another file are found under their own table.
    await f.getByRole("button", { name: "Browse Northwind's code" }).click();
    await downTo(page, "Store visits, Semantic model", "ArrowRight");
    await downTo(page, "Store, Table", "ArrowRight");
    await option(page, /^Store Count, Measure/).waitFor({ timeout: 30_000 });
    expect(await list(page).getByRole("option").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Back", "Store Count, Measure · Store table", "Visits per Store, Measure · Store table", "StoreId, Column · Store table", "Region, Column · Store table"]);
    await page.keyboard.press("Escape");

    // One request and one row per listing, with the repo and the thing's file; no row per file; never the words.
    expect(seen.filter((s) => s.action === "code.inner").map((s) => `${s.input.list} ${s.input.path}`)).toEqual([
      "pages /report/Region review.Report/definition/report.json",
      "tables /report/Returns.SemanticModel/model.bim",
      "fields /report/Store visits.SemanticModel/definition/tables/Store.tmdl",
    ]);
    expect(seen.filter((s) => s.action === "code.file")).toEqual([]);
    const log = (await views(page)).slice(0, (await views(page)).length - before);
    expect(log.filter((v) => v.event !== "where_new_form").map((v) => `${v.event} ${v.repoName} ${v.path}`).sort()).toEqual([
      "fields_listed store-portal /report/Store visits.SemanticModel/definition/tables/Store.tmdl",
      "pages_listed store-portal /report/Region review.Report/definition/report.json",
      "tables_listed store-portal /report/Returns.SemanticModel/model.bim",
    ]);
    expect(JSON.stringify(log)).not.toMatch(/regio|The Store|Return Rate/);

    // The admin's page names each listing.
    await f.getByRole("button", { name: "Cancel" }).click();
    await page.evaluate(() => (location.hash = "#/settings/admin-audit/code-views"));
    const table = page.locator('[data-setting="code-views"] table');
    await table.waitFor({ timeout: 30_000 });
    const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.slice(0, 4).map((tr) => [...tr.querySelectorAll("td")].slice(3).map((td) => td.textContent)));
    expect(rows.slice(0, 3)).toEqual([
      ["store-portal", "Measures and columns listed", "/report/Store visits.SemanticModel/definition/tables/Store.tmdl"],
      ["store-portal", "Tables listed", "/report/Returns.SemanticModel/model.bim"],
      ["store-portal", "Pages listed", "/report/Region review.Report/definition/report.json"],
    ]);
    await page.locator('[data-setting="code-views"]').scrollIntoViewIfNeeded();
    await shot(page, "rb3b-code-log");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
