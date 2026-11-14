// RB-4: the demo's invented repos. A5 holds for them (searching any file's own name finds that file), the warehouse
// and SQL database items open to what is inside them, and the fake of DevOps's code search answers from the demo's
// own files in the documented query forms. Everything here is invented.
import { describe, expect, it } from "vitest";
import { demoCodeGit, demoSearch } from "./code.ts";
import { fileLabels, searchThings, sortRepo } from "../../plan/code-kinds.ts";

const git = demoCodeGit();
const CLIENTS = ["Northwind", "Atlas", "Cooptimize", "Fabrikam", "Tailspin"];
const reposOf = async (client: string) => Promise.all((await git.repos(client)).filter((r) => r.defaultBranch).map(async (r) => ({ repo: r, paths: (await git.files(client, r)).paths })));

describe("names in the demo's repos (RB-4 A)", () => {
  it.each(CLIENTS)("A5: in %s, searching any file's own name finds that file", async (client) => {
    for (const { repo, paths } of await reposOf(client)) {
      const s = sortRepo(paths);
      for (const p of paths) expect(searchThings(s.things, p.slice(p.lastIndexOf("/") + 1), null, s.files).map((h) => h.file), `${repo.name} ${p}`).toContain(p);
    }
  });
  it("the Gold warehouse and the Returns SQL database open to their tables, views and procedures, which also sit under SQL", async () => {
    const sales = (await reposOf("Northwind")).find((r) => r.repo.name === "sales-analytics")!;
    const { things } = sortRepo(sales.paths);
    const gold = things.find((t) => t.name === "Gold")!;
    expect(gold).toMatchObject({ kind: "lake", detail: "Warehouse · 4 inside" });
    expect(gold.inside!.map((x) => [x.name, x.detail])).toEqual([["SalesLine", "Table in fact"], ["Store", "Table in dim"], ["usp_LoadSalesLine", "Stored procedure in fact"], ["vStoreRegion", "View in dim"]]);
    expect(things.find((t) => t.name === "Returns")).toMatchObject({ kind: "fabric", detail: "SQL database · 3 inside" });
    const sql = things.filter((t) => t.kind === "sql").map((t) => [t.name, t.detail]);
    expect(sql).toContainEqual(["Store", "Table in dim · Gold warehouse"]);
    expect(sql).toContainEqual(["usp_CloseReturn", "Stored procedure in ops · Returns SQL database"]);
    // The table is found by name, with and without the SQL kind.
    const { files } = sortRepo(sales.paths);
    for (const kind of [null, "sql"] as const) expect(searchThings(things, "SalesLine", kind, files).map((h) => h.file)).toContain("/lake/Gold.Warehouse/fact/Tables/SalesLine.sql");
  });
});

describe("the demo's fake of DevOps's code search (RB-4 B)", () => {
  const paths = async (client: string, text: string, top = 100) => (await git.search(client, text, top)).hits.map((h) => h.path).sort();
  it("a table's name finds the table and the procedures that use it, in two clients and more", async () => {
    expect(await paths("Northwind", "Watermarks")).toEqual(["/lake/Gold.Warehouse/fact/StoredProcedures/usp_LoadSalesLine.sql", "/sql/etl/StoredProcedures/usp_LoadOrders.sql"]);
    expect(await paths("Atlas", "Watermarks")).toEqual(["/adf/pipeline/pl_copy_shipments.json", "/adf/pipeline/pl_load_orders.json", "/sql/etl/StoredProcedures/usp_SetWatermark.sql", "/sql/etl/Tables/Watermarks.sql"]);
    expect(await paths("Tailspin", "Watermarks")).toEqual(["/adf/pipeline/pl_copy_flights.json", "/adf/pipeline/pl_load_orders.json", "/sql/etl/StoredProcedures/usp_SetWatermark.sql", "/sql/etl/Tables/Watermarks.sql"]);
  });
  it("counts the matches in each file and says which branch", async () => {
    const r = await git.search("Atlas", "Watermarks", 100);
    expect(r).toMatchObject({ count: 4, info: 0 });
    expect(r.hits.find((h) => h.path.endsWith("usp_SetWatermark.sql"))).toMatchObject({ branches: ["main"], matches: 1 });
  });
  it("understands a phrase, a * at the end of a word, AND, OR, NOT and ext:", async () => {
    expect(await paths("Northwind", '"MERGE [dbo].[Orders]"')).toEqual(["/sql/etl/StoredProcedures/usp_LoadOrders.sql"]);
    expect(await paths("Northwind", "usp_Load*")).toEqual(["/lake/Gold.Warehouse/fact/StoredProcedures/usp_LoadSalesLine.sql", "/sql/etl/StoredProcedures/usp_LoadOrders.sql"]);
    expect(await paths("Northwind", "Watermarks NOT SalesLine")).toEqual(["/sql/etl/StoredProcedures/usp_LoadOrders.sql"]);
    expect(await paths("Northwind", "ReturnRequest OR vStoreRegion")).toEqual(["/lake/Gold.Warehouse/dim/Views/vStoreRegion.sql", "/lake/Returns.SQLDatabase/ops/StoredProcedures/usp_CloseReturn.sql", "/lake/Returns.SQLDatabase/ops/Tables/ReturnRequest.sql", "/lake/Returns.SQLDatabase/ops/Views/vOpenReturns.sql"]);
    const all = await paths("Northwind", "Orders");
    const sql = await paths("Northwind", "(Orders) ext:sql");
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.length).toBeLessThan(all.length);
    expect(sql.every((p) => p.endsWith(".sql"))).toBe(true);
  });
  it("review 1: a table typed with its schema is found whatever brackets the file writes it with; a quote left open is refused", async () => {
    expect(await paths("Northwind", "dbo.Orders")).toEqual(await paths("Northwind", "[dbo].[Orders]"));
    expect((await paths("Northwind", "dbo.Orders")).length).toBe(4);
    expect(await paths("Atlas", "etl.Watermarks")).toEqual(await paths("Atlas", "[etl].[Watermarks]"));
    expect(await git.search("Northwind", '"SalesLine', 10)).toEqual({ count: 0, hits: [], info: 3 });
    // A phrase counts what the opened file will mark.
    expect((await git.search("Northwind", '"SalesLine"', 100)).hits.find((h) => h.path.endsWith("usp_LoadSalesLine.sql"))!.matches).toBe(3);
  });
  it("returns at most the number asked for and still counts the rest; a * at the start of a word is DevOps's code 4", async () => {
    const r = await git.search("Northwind", "Orders", 2);
    expect(r.hits).toHaveLength(2);
    expect(r.count).toBeGreaterThan(2);
    expect(demoSearch([], "*load", 10)).toEqual({ count: 0, hits: [], info: 4 });
  });
  it("Cooptimize's demo organization has no code search; Harbor's token can't read code", async () => {
    await expect(git.search("Cooptimize", "model", 10)).rejects.toMatchObject({ reason: "no_code_search" });
    await expect(git.search("Harbor", "model", 10)).rejects.toMatchObject({ reason: "needs_code_read" });
  });
  it("every file a search returns has a label by its name", async () => {
    for (const { repo, paths: all } of await reposOf("Northwind")) {
      const labels = fileLabels(all);
      for (const h of (await git.search("Northwind", "Store", 100)).hits.filter((x) => x.repoId === repo.id)) expect(labels.get(h.path), h.path).toBeDefined();
    }
  });
});
