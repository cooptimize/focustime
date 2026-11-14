// RB-4, STEP 0.3: the miss, proved before it is fixed. Search names couldn't find a file the tree plainly shows when
// the file sits inside an item's folder: RB-2 folded everything under an item into the item. Every name here is
// invented. Each case in the first two groups failed on main (they were committed first as tests expected to fail).
import { describe, expect, it } from "vitest";
import { fileLabels, searchThings, sortRepo, thingsOf, type Kind } from "./code-kinds.ts";

/** An invented repo with every layout the rules know, and files inside each kind of item. */
export const INSIDE_REPO = [
  "/README.md",
  "/LICENSE",
  "/ws/Depot.Warehouse/.platform",
  "/ws/Depot.Warehouse/Depot.sqlproj",
  "/ws/Depot.Warehouse/dim/Tables/Pallet.sql",
  "/ws/Depot.Warehouse/dim/Views/vPallet.sql",
  "/ws/Depot.Warehouse/dim/StoredProcedures/usp_FillPallet.sql",
  "/ws/Depot.Warehouse/Security/loader.sql",
  "/ws/Ledger.SQLDatabase/.platform",
  "/ws/Ledger.SQLDatabase/fin/Tables/Invoice.sql",
  "/ws/Ledger.SQLDatabase/fin/Functions/fnNet.sql",
  "/ws/Trips.Report/.platform",
  "/ws/Trips.Report/definition.pbir",
  "/ws/Trips.Report/definition/report.json",
  "/ws/Trips.Report/definition/pages/overview/page.json",
  "/ws/Trips.Report/StaticResources/banner.png",
  "/ws/Trips.SemanticModel/.platform",
  "/ws/Trips.SemanticModel/definition.pbism",
  "/ws/Trips.SemanticModel/definition/model.tmdl",
  "/ws/Trips.SemanticModel/definition/tables/Journey.tmdl",
  "/ws/Trips.SemanticModel/definition/relationships.tmdl",
  "/ws/Trips.SemanticModel/definition/roles/Readers.tmdl",
  "/ws/Old trips.SemanticModel/.platform",
  "/ws/Old trips.SemanticModel/model.bim",
  "/ws/Old trips.SemanticModel/diagramLayout.json",
  "/ws/Scratch.Lakehouse/.platform",
  "/ws/Scratch.Lakehouse/shortcuts.metadata.json",
  "/ws/Scratch.Lakehouse/notes/probe.ipynb",
  "/ws/Tidy.Notebook/.platform",
  "/ws/Tidy.Notebook/notebook-content.py",
  "/ws/Nightly.DataPipeline/.platform",
  "/ws/Nightly.DataPipeline/pipeline-content.json",
  "/adf/publish_config.json",
  "/adf/pipeline/pl_move.json",
  "/adf/pipeline/notes.md",
  "/adf/dataset/ds_in.json",
  "/sql/Stock.sqlproj",
  "/sql/stock/Tables/Bin.sql",
  "/sql/Tables/Crate.sql",
  "/loose/Tables/Hook.sql",
  "/docs/guide.md",
];

const find = (paths: readonly string[], q: string, kind: Kind | null = null) => {
  const s = sortRepo(paths);
  return searchThings(s.things, q, kind, s.files).map((h) => h.file);
};

describe("the miss: a table inside a warehouse item", () => {
  it("finds the table by its name", () => {
    expect(find(INSIDE_REPO, "Pallet")).toContain("/ws/Depot.Warehouse/dim/Tables/Pallet.sql");
  });
  it("finds it with the SQL kind too", () => {
    expect(find(INSIDE_REPO, "Pallet", "sql")).toContain("/ws/Depot.Warehouse/dim/Tables/Pallet.sql");
  });
  it("finds the stored procedure beside it, with and without the SQL kind", () => {
    expect(find(INSIDE_REPO, "usp_FillPallet")).toEqual(["/ws/Depot.Warehouse/dim/StoredProcedures/usp_FillPallet.sql"]);
    expect(find(INSIDE_REPO, "usp_FillPallet", "sql")).toEqual(["/ws/Depot.Warehouse/dim/StoredProcedures/usp_FillPallet.sql"]);
  });
});

describe("every other way a file the tree shows couldn't be found by name", () => {
  const cases: [what: string, q: string, file: string][] = [
    ["a view inside a warehouse", "vPallet", "/ws/Depot.Warehouse/dim/Views/vPallet.sql"],
    ["a script inside a warehouse, outside the object folders", "loader", "/ws/Depot.Warehouse/Security/loader.sql"],
    ["a SQL project file inside a warehouse", "Depot.sqlproj", "/ws/Depot.Warehouse/Depot.sqlproj"],
    ["a table inside a SQL database item", "Invoice", "/ws/Ledger.SQLDatabase/fin/Tables/Invoice.sql"],
    ["a function inside a SQL database item", "fnNet", "/ws/Ledger.SQLDatabase/fin/Functions/fnNet.sql"],
    ["a notebook file inside a lakehouse", "probe", "/ws/Scratch.Lakehouse/notes/probe.ipynb"],
    ["a report's page file", "page.json", "/ws/Trips.Report/definition/pages/overview/page.json"],
    ["a report's image", "banner", "/ws/Trips.Report/StaticResources/banner.png"],
    ["a report's definition.pbir (the item opens on report.json)", "definition.pbir", "/ws/Trips.Report/definition.pbir"],
    ["a model's relationships file", "relationships", "/ws/Trips.SemanticModel/definition/relationships.tmdl"],
    ["a model's role file", "Readers", "/ws/Trips.SemanticModel/definition/roles/Readers.tmdl"],
    ["a file beside an older model's model.bim", "diagramLayout", "/ws/Old trips.SemanticModel/diagramLayout.json"],
    ["a lakehouse's shortcuts file", "shortcuts.metadata", "/ws/Scratch.Lakehouse/shortcuts.metadata.json"],
    ["an item's own .platform file, when the item opens on another file", ".platform", "/ws/Trips.Report/.platform"],
  ];
  it.each(cases)("%s", (_what, q, file) => {
    expect(find(INSIDE_REPO, q)).toContain(file);
  });
});

describe("what already worked, and still does", () => {
  it.each([
    ["a file under Other", "guide.md", "/docs/guide.md"],
    ["a file with no type", "LICENSE", "/LICENSE"],
    ["a factory's pipeline, by its name or its file's", "pl_move.json", "/adf/pipeline/pl_move.json"],
    ["a file in a factory folder that isn't JSON", "notes", "/adf/pipeline/notes.md"],
    ["a factory's root file", "publish_config", "/adf/publish_config.json"],
    ["a table outside an item", "Bin", "/sql/stock/Tables/Bin.sql"],
    ["an item, by its folder's name", "Depot", "/ws/Depot.Warehouse/.platform"],
    ["a model's table", "Journey", "/ws/Trips.SemanticModel/definition/tables/Journey.tmdl"],
  ])("%s", (_what, q, file) => {
    expect(find(INSIDE_REPO, q)).toContain(file);
  });
});

describe("RB-4: things inside an item", () => {
  const { things, files } = sortRepo(INSIDE_REPO);
  const at = (file: string) => things.find((t) => t.file === file)!;
  it("a .sql file inside an item is a table, view, procedure, function or script by its folders, and says its schema and its item", () => {
    expect(at("/ws/Depot.Warehouse/dim/Tables/Pallet.sql")).toMatchObject({ kind: "sql", name: "Pallet", detail: "Table in dim · Depot warehouse", item: "Depot warehouse" });
    expect(at("/ws/Depot.Warehouse/dim/Views/vPallet.sql")).toMatchObject({ kind: "sql", detail: "View in dim · Depot warehouse" });
    expect(at("/ws/Depot.Warehouse/dim/StoredProcedures/usp_FillPallet.sql")).toMatchObject({ kind: "sql", detail: "Stored procedure in dim · Depot warehouse" });
    expect(at("/ws/Depot.Warehouse/Security/loader.sql")).toMatchObject({ kind: "sql", detail: "SQL script · Depot warehouse" });
    expect(at("/ws/Ledger.SQLDatabase/fin/Functions/fnNet.sql")).toMatchObject({ kind: "sql", detail: "Function in fin · Ledger SQL database" });
    expect(at("/ws/Scratch.Lakehouse/notes/probe.ipynb")).toMatchObject({ kind: "notebook", name: "probe", detail: "Jupyter notebook · Scratch lakehouse" });
  });
  it("the item is still a thing, and opens to what is inside it", () => {
    const depot = things.find((t) => t.name === "Depot" && t.kind === "lake")!;
    expect(depot.detail).toBe("Warehouse · 5 inside");
    expect(depot.inside!.map((x) => [x.name, x.detail, x.kind])).toEqual([
      ["Depot", "SQL project", "sql"],
      ["loader", "SQL script", "sql"],
      ["Pallet", "Table in dim", "sql"],
      ["usp_FillPallet", "Stored procedure in dim", "sql"],
      ["vPallet", "View in dim", "sql"],
    ]);
    // A model still opens to its tables.
    expect(things.find((t) => t.name === "Trips" && t.kind === "model")).toMatchObject({ detail: "Semantic model · 1 table", tables: [{ name: "Journey" }] });
  });
  it("a notebook item's own content file is the notebook, never a script inside it", () => {
    const t = thingsOf(["/n/Clean.Notebook/.platform", "/n/Clean.Notebook/notebook-content.sql"]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "notebook", name: "Clean", detail: "Notebook" });
  });
  it("a folder above Tables is a schema only where the path shows one", () => {
    expect(at("/sql/stock/Tables/Bin.sql").detail).toBe("Table in stock"); // under a SQL project
    expect(at("/sql/Tables/Crate.sql").detail).toBe("Table"); // the project's own folder isn't a schema
    expect(at("/loose/Tables/Hook.sql").detail).toBe("Table"); // no project: "loose" is only a folder
    expect(thingsOf(["/db/Tables/ops.Shift.sql"])[0]!.detail).toBe("Table in ops"); // a two-part name
    expect(thingsOf(["/W.Warehouse/.platform", "/W.Warehouse/Tables/Lot.sql"]).find((t) => t.name === "Lot")!.detail).toBe("Table · W warehouse");
  });
  it("a file found only by its own name comes last, as a file in its item", () => {
    const hits = searchThings(things, "definition", null, files);
    expect(hits.at(-1)).toMatchObject({ asFile: true, name: "definition.pbism", detail: "File in Trips semantic model", kind: "model" });
    expect(hits.findIndex((h) => h.asFile)).toBeGreaterThan(0);
    // The kind filter keeps a file with its item's kind.
    expect(searchThings(things, "page.json", "report", files).map((h) => h.file)).toEqual(["/ws/Trips.Report/definition/pages/overview/page.json"]);
    expect(searchThings(things, "page.json", "sql", files)).toEqual([]);
  });
  it("A5: searching any file's own name finds that file", () => {
    for (const p of INSIDE_REPO) expect(find(INSIDE_REPO, p.slice(p.lastIndexOf("/") + 1)), p).toContain(p);
  });
  it("every file has a label for a list of files", () => {
    const labels = fileLabels(INSIDE_REPO);
    expect([...labels.keys()].sort()).toEqual([...INSIDE_REPO].sort());
    expect(labels.get("/ws/Depot.Warehouse/dim/StoredProcedures/usp_FillPallet.sql")).toEqual({ kind: "sql", detail: "Stored procedure in dim · Depot warehouse" });
    expect(labels.get("/ws/Trips.Report/definition/report.json")).toEqual({ kind: "report", detail: "File in Trips report" });
    expect(labels.get("/ws/Trips.SemanticModel/definition/tables/Journey.tmdl")).toEqual({ kind: "model", detail: "Table in Trips" });
    expect(labels.get("/adf/pipeline/pl_move.json")).toEqual({ kind: "pipeline", detail: "Data factory pipeline" });
    expect(labels.get("/docs/guide.md")).toEqual({ kind: "other", detail: "Markdown" });
  });
});
