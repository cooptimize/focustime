// RB-3: "Where is it?" picked from the client's code. What is offered, how a word matches, and what a pick writes.
// Invented names only.
import { describe, expect, it } from "vitest";
import { sortRepo, type RepoThings } from "./code-kinds.ts";
import { ANSWER_MAX } from "./three-questions.ts";
import { browseLevel, fieldsOf, innerMatches, pagesOf, reportPages, suggest, tmdlFields, whereEntries, withPick, wordAt, writtenOf, WHERE_SHOWN } from "./where-lookup.ts";

const repo = (id: string, name: string, paths: string[]): RepoThings => ({ repo: { id, name, defaultBranch: "main", state: "ok" }, ...sortRepo(paths), cut: false, problem: null });
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const PATHS = [
  "/ws/Sales.Report/definition.pbir",
  "/ws/Sales.Report/report.json",
  "/ws/Margins.Report/definition.pbir",
  "/ws/Margins.Report/definition/report.json",
  "/ws/Margins.Report/definition/pages/90c2e07d8e84e7d5c026/page.json",
  "/ws/Sales.SemanticModel/definition.pbism",
  "/ws/Sales.SemanticModel/definition/model.tmdl",
  "/ws/Sales.SemanticModel/definition/tables/Customer.tmdl",
  "/ws/Sales.SemanticModel/definition/tables/Date.tmdl",
  "/ws/Gold.Warehouse/.platform",
  "/ws/Gold.Warehouse/dim/Tables/Customer.sql",
  "/ws/Gold.Warehouse/dim/Views/CustomerCurrent.sql",
  "/ws/Gold.Warehouse/Security/dim.sql",
  "/ws/Load orders.DataPipeline/.platform",
  "/ws/Load orders.DataPipeline/pipeline-content.json",
  "/adf/pipeline/pl_customer_load.json",
  "/adf/dataset/ds_customer.json",
  "/scripts/cleanup customers.sql",
  "/ws/Ops.Eventhouse/.platform",
  "/README.md",
];
const ENTRIES = whereEntries([repo(A, "analytics", PATHS)]);
const named = (n: string) => ENTRIES.find((e) => e.name === n)!;

describe("RB-3: what the box offers", () => {
  it("offers reports, models and their tables, pipelines, databases and their objects and SQL scripts, never Other or Other Fabric items", () => {
    const names = ENTRIES.map((e) => `${e.name} | ${writtenOf(e)}`);
    expect(names).toEqual(expect.arrayContaining([
      "Sales | Sales (report)",
      "Margins | Margins (report)",
      "Sales | Sales (semantic model)",
      "Customer | Customer (table, Sales semantic model)",
      "Gold | Gold (warehouse)",
      "dim.Customer | dim.Customer (table, Gold warehouse)",
      "dim.CustomerCurrent | dim.CustomerCurrent (view, Gold warehouse)",
      "Load orders | Load orders (pipeline)",
      "pl_customer_load | pl_customer_load (data factory pipeline)",
      "cleanup customers | cleanup customers (SQL script)",
    ]));
    // Not offered: a factory dataset, a README, an Eventhouse, a schema's own definition, a file inside an item.
    for (const n of ["ds_customer", "README.md", "Ops", "dim", "page.json"]) expect(ENTRIES.some((e) => e.name === n)).toBe(false);
    // Nothing in an entry is a link or is written but its name and words.
    expect(Object.keys(named("dim.Customer")).sort()).toEqual(["bare", "file", "id", "inside", "kind", "more", "name", "parent", "repoId", "repoName", "schema", "sqlType", "what", "within"]);
  });

  it("offers a second level only where one file holds it: a legacy report's pages and a TMDL table's measures", () => {
    expect(ENTRIES.find((e) => e.name === "Sales" && e.kind === "report")!.more).toBe("pages");
    // PBIR keeps one page.json per page: not offered.
    expect(named("Margins").more).toBeNull();
    expect(named("Customer").more).toBe("fields");
    expect(named("dim.Customer").more).toBeNull();
  });
});

describe("RB-3: matching the word at the cursor", () => {
  it("needs two letters, puts a name that starts with the word first, then one that holds it, things before the things inside them", () => {
    expect(suggest(ENTRIES, "c")).toBeNull();
    const r = suggest(ENTRIES, "cust")!;
    expect(r.shown.map(writtenOf)).toEqual([
      "Customer (table, Sales semantic model)",
      "dim.Customer (table, Gold warehouse)",
      "dim.CustomerCurrent (view, Gold warehouse)",
      "cleanup customers (SQL script)",
      "pl_customer_load (data factory pipeline)",
    ]);
    // Two letters: only names that start with them ("to" in a sentence doesn't list every name holding it).
    expect(suggest(ENTRIES, "us")!.total).toBe(0);
    // A thing before a thing inside another when both start with the word; the same name in By kind's order.
    expect(suggest(ENTRIES, "sal")!.shown.map(writtenOf)).toEqual(["Sales (report)", "Sales (semantic model)"]);
  });

  it("shows at most eight and counts the rest", () => {
    const many = whereEntries([repo(A, "a", Array.from({ length: 20 }, (_, i) => `/sql/Tables/Order${String(i).padStart(2, "0")}.sql`))]);
    const r = suggest(many, "order")!;
    expect(r.shown).toHaveLength(WHERE_SHOWN);
    expect(r.total).toBe(20);
  });

  it("finds the word at the cursor, and a pick replaces only that word", () => {
    expect(wordAt("the Cust report", 8)).toEqual({ start: 4, end: 8, word: "Cust" });
    expect(wordAt("(dim.Cu", 7).word).toBe("dim.Cu");
    // In the middle of a word: what is before the cursor matches, the whole word is replaced.
    expect(wordAt("Custxx", 4)).toEqual({ start: 0, end: 6, word: "Cust" });
    const one = withPick("On cust page 2", 7, writtenOf(named("dim.Customer")))!;
    expect(one.text).toBe("On dim.Customer (table, Gold warehouse) page 2");
    expect(one.text.slice(0, one.cursor)).toBe("On dim.Customer (table, Gold warehouse)");
    // A second pick adds to the answer.
    const two = withPick(`${one.text.slice(0, one.cursor)} and sal${one.text.slice(one.cursor)}`, one.cursor + 8, "Sales (report)")!;
    expect(two.text).toBe("On dim.Customer (table, Gold warehouse) and Sales (report) page 2");
    // From browsing (no word): at the cursor, kept apart from the word before it.
    expect(withPick("See", 3, "Sales (report)", false)!.text).toBe("See Sales (report)");
    expect(withPick("", 0, "Sales (report)", false)!.text).toBe("Sales (report)");
    // Never longer than an answer may be.
    expect(withPick(`${"x".repeat(ANSWER_MAX - 4)} sa`, ANSWER_MAX - 1, "Sales (report)")).toBeNull();
  });

  it("names the repo's entries apart when a client has several repos", () => {
    const two = whereEntries([repo(A, "analytics", ["/sql/Tables/Orders.sql"]), repo(B, "portal", ["/sql/Tables/Orders.sql"])]);
    expect(two.map((e) => e.repoName)).toEqual(["analytics", "portal"]);
    expect(new Set(two.map((e) => e.id)).size).toBe(2);
  });
});

describe("RB-3: browsing by kind", () => {
  it("lists things by kind once each, and a database opens to its schemas, then types, then objects", () => {
    const top = browseLevel(ENTRIES, null);
    expect(top.groups.map((g) => g.label)).toEqual(["Reports", "Semantic models", "Pipelines", "Databases", "SQL scripts"]);
    const dbs = top.groups.find((g) => g.label === "Databases")!.rows;
    expect(dbs).toHaveLength(1);
    const gold = dbs[0]!;
    expect(gold.type === "entry" && gold.opens).toBe(true);
    const schemas = browseLevel(ENTRIES, gold.type === "entry" ? gold.entry.id : "");
    expect(schemas.groups[0]!.rows.map((r) => (r.type === "folder" ? `${r.label} ${r.count}` : ""))).toEqual(["dim 2"]);
    const dim = schemas.groups[0]!.rows[0]!;
    const types = browseLevel(ENTRIES, dim.type === "folder" ? dim.key : "");
    expect(types.groups[0]!.rows.map((r) => (r.type === "folder" ? r.label : ""))).toEqual(["Tables", "Views"]);
    const tables = types.groups[0]!.rows[0]!;
    const objects = browseLevel(ENTRIES, tables.type === "folder" ? tables.key : "");
    expect(objects.groups[0]!.rows.map((r) => (r.type === "entry" ? writtenOf(r.entry) : ""))).toEqual(["dim.Customer (table, Gold warehouse)"]);
    // A model opens to its tables.
    const model = browseLevel(ENTRIES, ENTRIES.find((e) => e.kind === "model" && !e.inside)!.id);
    expect(model.groups[0]!.rows.map((r) => (r.type === "entry" ? r.entry.name : ""))).toEqual(["Customer", "Date"]);
  });
});

describe("RB-3: pages and measures, from one file", () => {
  it("reads a legacy report's page names in order, and writes a page with its report", () => {
    const json = JSON.stringify({ sections: [{ name: "ReportSection2", displayName: "Margin by region", ordinal: 1 }, { name: "ReportSection", displayName: "Overview", ordinal: 0 }] });
    expect(reportPages(json)).toEqual(["Overview", "Margin by region"]);
    expect(reportPages("{ not json")).toBeNull();
    expect(reportPages(JSON.stringify({ config: "{}" }))).toBeNull();
    const sales = ENTRIES.find((e) => e.name === "Sales" && e.kind === "report")!;
    expect(pagesOf(sales, ["Margin by region"])[0]!.written).toBe("Margin by region, page of Sales report");
  });

  it("reads a TMDL table's measures and columns, and writes them with the table and model", () => {
    const tmdl = "/// Every customer.\ntable Customer\n\tlineageTag: x\n\n\tmeasure 'Active customers' = COUNTROWS ( Customer )\n\t\tformatString: 0\n\n\tmeasure Churn =\n\t\t\tDIVIDE ( 1, 2 )\n\n\tcolumn 'Customer Key'\n\t\tdataType: int64\n\n\tcolumn Region\n\t\tdataType: string\n\n\tcolumn 'O''Brien flag' = 1\n\n\tpartition Customer = m\n\t\tmode: import\n";
    const f = tmdlFields(tmdl)!;
    expect(f).toEqual([{ name: "Active customers", what: "measure" }, { name: "Churn", what: "measure" }, { name: "Customer Key", what: "column" }, { name: "Region", what: "column" }, { name: "O'Brien flag", what: "column" }]);
    expect(tmdlFields("model Model\n")).toBeNull();
    const picks = fieldsOf(named("Customer"), f);
    expect(picks.map((p) => p.written).slice(0, 3)).toEqual(["Active customers (measure, Customer table, Sales semantic model)", "Churn (measure, Customer table, Sales semantic model)", "Customer Key (column, Customer table, Sales semantic model)"]);
    expect(innerMatches(picks, "reg").map((p) => p.name)).toEqual(["Region"]);
  });
});
