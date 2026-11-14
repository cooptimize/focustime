// RB-4, STEP 0.3: the miss, proved before it is fixed. Search names couldn't find a file the tree plainly shows when
// the file sits inside an item's folder: RB-2 folded everything under an item into the item. Every name here is
// invented. Each case below failed on main (they were committed first as tests expected to fail).
import { describe, expect, it } from "vitest";
import { searchThings, thingsOf, type Kind } from "./code-kinds.ts";

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

const find = (paths: readonly string[], q: string, kind: Kind | null = null) => searchThings(thingsOf(paths), q, kind).map((h) => h.file);

describe("the miss: a table inside a warehouse item", () => {
  it.fails("finds the table by its name", () => {
    expect(find(INSIDE_REPO, "Pallet")).toContain("/ws/Depot.Warehouse/dim/Tables/Pallet.sql");
  });
  it.fails("finds it with the SQL kind too", () => {
    expect(find(INSIDE_REPO, "Pallet", "sql")).toContain("/ws/Depot.Warehouse/dim/Tables/Pallet.sql");
  });
  it.fails("finds the stored procedure beside it, with and without the SQL kind", () => {
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
  it.fails.each(cases)("%s", (_what, q, file) => {
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
