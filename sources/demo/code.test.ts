// RB-4: the demo's invented repos. A5 holds for them (searching any file's own name finds that file), the warehouse
// and SQL database items open to what is inside them, and the fake of DevOps's code search answers from the demo's
// own files in the documented query forms. Everything here is invented.
import { describe, expect, it } from "vitest";
import { demoCodeGit, demoSearch } from "./code.ts";
import { fileLabels, listedThings, NO_SCHEMA, searchThings, sortRepo, sqlTree } from "../../plan/code-kinds.ts";

const git = demoCodeGit();
const CLIENTS = ["Northwind", "Atlas", "Cooptimize", "Fabrikam", "Tailspin"];
const reposOf = async (client: string) => Promise.all((await git.repos(client)).filter((r) => r.defaultBranch).map(async (r) => ({ repo: r, paths: (await git.files(client, r, "main")).paths })));

describe("names in the demo's repos (RB-4 A)", () => {
  it.each(CLIENTS)("A5: in %s, searching any file's own name finds that file", async (client) => {
    for (const { repo, paths } of await reposOf(client)) {
      const s = sortRepo(paths);
      for (const p of paths) expect(searchThings(s.things, p.slice(p.lastIndexOf("/") + 1), null, s.files).map((h) => h.file), `${repo.name} ${p}`).toContain(p);
    }
  });
  it("the Gold warehouse and the Returns SQL database open to their tables, views and procedures, listed only inside them (RB-6)", async () => {
    const sales = (await reposOf("Northwind")).find((r) => r.repo.name === "sales-analytics")!;
    const { things } = sortRepo(sales.paths);
    const gold = things.find((t) => t.name === "Gold")!;
    expect(gold).toMatchObject({ kind: "database", detail: "Warehouse · 22 objects" });
    expect(gold.inside!.filter((x) => x.schema === "fact").map((x) => [x.name, x.detail])).toEqual([["Returns", "Table in fact"], ["SalesLine", "Table in fact"], ["usp_LoadSalesLine", "Stored procedure in fact"], ["vDailySales", "View in fact"]]);
    expect(things.find((t) => t.name === "Returns" && t.kind === "database" && !t.item)).toMatchObject({ detail: "SQL database · 9 objects" });
    expect(listedThings(things).filter((t) => t.kind === "database").map((t) => t.name)).toEqual(["Gold", "Returns", "Warehouse"]);
    const sql = things.filter((t) => t.kind === "database" && t.item).map((t) => [t.name, t.detail]);
    expect(sql).toContainEqual(["Store", "Table in dim · Gold warehouse"]);
    expect(sql).toContainEqual(["usp_CloseReturn", "Stored procedure in ops · Returns SQL database"]);
    // The table is found by name, with and without the Databases kind.
    const { files } = sortRepo(sales.paths);
    for (const kind of [null, "database"] as const) expect(searchThings(things, "SalesLine", kind, files).map((h) => h.file)).toContain("/lake/Gold.Warehouse/fact/Tables/SalesLine.sql");
  });
});

describe("the demo's databases have enough to group (RB-5 C1)", () => {
  it("the warehouse and the SQL database: four schemas each, every type, a name in two schemas, a schema's own definition, a loose script", async () => {
    const sales = (await reposOf("Northwind")).find((r) => r.repo.name === "sales-analytics")!;
    const sql = sortRepo(sales.paths).things.filter((t) => t.sqlType);
    for (const [db, schemas] of [["Gold warehouse", ["dim", "fact", "rpt", "stg", NO_SCHEMA]], ["Returns SQL database", ["audit", "ops", "ref", "stg", NO_SCHEMA]]] as const) {
      const objects = sql.filter((t) => t.dbName === db);
      expect(sqlTree(objects, "schema").folders.map((f) => f.label), db).toEqual(schemas);
      expect(sqlTree(objects, "type").folders.map((f) => f.label), db).toEqual(expect.arrayContaining(["Tables", "Views", "Stored procedures", "Functions", "Schemas", "Scripts"]));
    }
    const gold = sql.filter((t) => t.dbName === "Gold warehouse");
    expect(sqlTree(gold, "type").folders.map((f) => `${f.label} ${f.count}`)).toEqual(["Tables 7", "Views 4", "Stored procedures 3", "Functions 2", "Schemas 2", "Security 1", "Shared queries 1", "SQL projects 1", "Scripts 1"]);
    expect(gold.filter((t) => t.name === "Store").map((t) => `${t.schema}.${t.name} ${t.sqlType}`).sort()).toEqual(["dim.Store table", "stg.Store table"]);
    expect(gold.find((t) => t.file.endsWith("/Security/stg.sql"))).toMatchObject({ sqlType: "schema", schema: "stg" });
    expect(gold.find((t) => t.name === "PostDeployment")).toMatchObject({ sqlType: "script" });
    // RB-6: the SQL project is a database too, and the loose SQL files are SQL scripts.
    expect(sql.filter((t) => t.dbName === "Warehouse SQL project").map((t) => t.name).sort()).toEqual(["Orders", "usp_LoadOrders", "vSales"]);
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

describe("the demo's branches (RB-7 G)", () => {
  const sales = async () => (await git.repos("Northwind")).find((r) => r.name === "sales-analytics")!;
  it("sales-analytics has main, dev and three more; the other repos have only main", async () => {
    expect((await git.branches("Northwind", await sales())).names).toEqual(["dev", "feature/returns-model", "feature/store-region-dimension-cleanup-before-the-quarterly-refresh", "main", "release/2026-11"]);
    const portal = (await git.repos("Northwind")).find((r) => r.name === "store-portal")!;
    expect((await git.branches("Northwind", portal)).names).toEqual(["main"]);
  });
  it("a branch has its own files; one it doesn't have is not found", async () => {
    const r = await sales();
    const only = "/lake/Gold.Warehouse/rpt/Views/vReturnsByStore.sql";
    expect((await git.files("Northwind", r, "dev")).paths).toContain(only);
    expect((await git.files("Northwind", r, "main")).paths).not.toContain(only);
    expect((await git.file("Northwind", r, "/README.md", "dev")).text).toContain("On dev");
    await expect(git.folder("Northwind", r, "/", "nope")).rejects.toThrow(/not_found/);
  });
  it("code search looks in main and dev only, and says which branches a file was found on", async () => {
    const r = await git.search("Northwind", "vReturnsByStore", 50);
    expect(r.hits.map((h) => [h.path, h.branches])).toEqual([["/lake/Gold.Warehouse/rpt/Views/vReturnsByStore.sql", ["dev"]]]);
    const rate = await git.search("Northwind", "vReturnRate", 50);
    expect(rate.hits).toEqual([]);
  });
});
