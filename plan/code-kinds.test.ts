// RB-2: a repo's things by kind, from invented file paths only. Each layout in the documentation, and the odd cases.
import { describe, expect, it } from "vitest";
import { groupThings, KIND_GROUPS, markMatches, searchThings, thingsOf, type Thing } from "./code-kinds.ts";

const pick = (t: Thing[], name: string) => t.find((x) => x.name === name);

describe("Fabric items", () => {
  const things = thingsOf([
    "/ws/Margins.Report/.platform",
    "/ws/Margins.Report/definition.pbir",
    "/ws/Margins.Report/definition/report.json",
    "/ws/Margins.Report/definition/pages/p1/page.json",
    "/ws/Margins.SemanticModel/.platform",
    "/ws/Margins.SemanticModel/definition.pbism",
    "/ws/Margins.SemanticModel/definition/model.tmdl",
    "/ws/Margins.SemanticModel/definition/tables/Orders.tmdl",
    "/ws/Margins.SemanticModel/definition/tables/Calendar.tmdl",
    "/ws/Margins.SemanticModel/definition/relationships.tmdl",
    "/ws/Tidy up.Notebook/.platform",
    "/ws/Tidy up.Notebook/notebook-content.py",
    "/ws/Nightly load.DataPipeline/.platform",
    "/ws/Nightly load.DataPipeline/pipeline-content.json",
    "/ws/Bronze.Lakehouse/.platform",
    "/ws/Bronze.Lakehouse/shortcuts.metadata.json",
    "/ws/Gold.Warehouse/.platform",
    "/ws/Stores.Dataflow/.platform",
    "/ws/Alerts.Reflex/.platform",
    "/ws/Odd one.SomethingNew/.platform",
  ]);
  it("names an item by its folder before the last dot and types it by the part after", () => {
    expect(pick(things, "Margins")).toMatchObject({ kind: "report", detail: "Report", folder: "/ws/Margins.Report", file: "/ws/Margins.Report/definition/report.json" });
    expect(pick(things, "Tidy up")).toMatchObject({ kind: "notebook", detail: "Notebook", file: "/ws/Tidy up.Notebook/notebook-content.py" });
    expect(pick(things, "Nightly load")).toMatchObject({ kind: "pipeline", detail: "Pipeline", file: "/ws/Nightly load.DataPipeline/pipeline-content.json" });
    expect(pick(things, "Bronze")).toMatchObject({ kind: "lake", detail: "Lakehouse" });
    expect(pick(things, "Gold")).toMatchObject({ kind: "lake", detail: "Warehouse" });
    expect(pick(things, "Stores")).toMatchObject({ kind: "dataflow", detail: "Dataflow" });
    expect(pick(things, "Alerts")).toMatchObject({ kind: "fabric", detail: "Activator" });
  });
  it("shows a type that isn't on the list as it is written", () => {
    expect(pick(things, "Odd one")).toMatchObject({ kind: "fabric", detail: "SomethingNew" });
  });
  it("lists a semantic model's tables where there is one file per table", () => {
    const model = things.find((t) => t.kind === "model")!;
    expect(model).toMatchObject({ name: "Margins", detail: "Semantic model · 2 tables", file: "/ws/Margins.SemanticModel/definition/model.tmdl" });
    expect(model.tables).toEqual([
      { name: "Calendar", file: "/ws/Margins.SemanticModel/definition/tables/Calendar.tmdl" },
      { name: "Orders", file: "/ws/Margins.SemanticModel/definition/tables/Orders.tmdl" },
    ]);
  });
  it("every file inside an item belongs to the item, never to Other", () => {
    expect(things).toHaveLength(9);
    expect(things.some((t) => t.kind === "other")).toBe(false);
  });
  it("the older two-file marker makes an item; one of the two alone doesn't", () => {
    const t = thingsOf(["/Old.Report/item.metadata.json", "/Old.Report/item.config.json", "/Old.Report/report.json", "/Half.Report/item.metadata.json"]);
    expect(pick(t, "Old")).toMatchObject({ kind: "report", detail: "Report", file: "/Old.Report/report.json" });
    expect(t.find((x) => x.folder === "/Half.Report")).toMatchObject({ kind: "other", name: "item.metadata.json" });
  });
  it("a Power BI project's folders are items by their definition files, with the older Dataset name and a TMSL model", () => {
    const t = thingsOf(["/proj/Stock.pbip", "/proj/Stock.Report/definition.pbir", "/proj/Stock.Report/report.json", "/proj/Stock.Dataset/definition.pbism", "/proj/Stock.Dataset/model.bim"]);
    expect(t.find((x) => x.kind === "report")).toMatchObject({ name: "Stock", file: "/proj/Stock.Report/report.json" });
    expect(t.find((x) => x.kind === "model")).toMatchObject({ name: "Stock", detail: "Semantic model", file: "/proj/Stock.Dataset/model.bim" });
    expect(t.find((x) => x.kind === "model")!.tables).toBeUndefined();
    expect(t.find((x) => x.kind === "other")).toMatchObject({ name: "Stock.pbip", detail: "JSON" });
  });
  it("a folder renamed with no type after a dot keeps the folder's name, typed by a file inside when one says", () => {
    const t = thingsOf(["/Renamed model/.platform", "/Renamed model/definition.pbism", "/Renamed model/definition/tables/A.tmdl", "/Mystery/.platform", "/Mystery/thing.json"]);
    expect(pick(t, "Renamed model")).toMatchObject({ kind: "model", detail: "Semantic model · 1 table" });
    expect(pick(t, "Mystery")).toMatchObject({ kind: "fabric", detail: "Fabric item", file: "/Mystery/.platform" });
  });
  it("shows a character Fabric wrote as its HTML number", () => {
    expect(thingsOf(["/Cost&#58; plan.Report/.platform"])[0]).toMatchObject({ name: "Cost: plan", folder: "/Cost&#58; plan.Report" });
  });
  it("a marker at the repo's top doesn't make the whole repo one item", () => {
    expect(thingsOf(["/.platform", "/a.sql"]).map((t) => t.kind).sort()).toEqual(["other", "sql"]);
  });
});

describe("a data factory or a Synapse workspace", () => {
  it("one thing per file in the resource folders, under a root with two of them", () => {
    const t = thingsOf(["/adf/pipeline/pl_copy.json", "/adf/dataset/ds_in.json", "/adf/linkedService/ls_lake.json", "/adf/trigger/tr_daily.json", "/adf/dataflow/df_clean.json", "/adf/factory/f.json"]);
    expect(pick(t, "pl_copy")).toMatchObject({ kind: "pipeline", detail: "Data factory pipeline", folder: "/adf/pipeline", file: "/adf/pipeline/pl_copy.json" });
    expect(pick(t, "df_clean")).toMatchObject({ kind: "dataflow", detail: "Data factory data flow" });
    expect(pick(t, "ds_in")).toMatchObject({ kind: "other", detail: "Data factory dataset" });
    expect(pick(t, "ls_lake")).toMatchObject({ kind: "other", detail: "Data factory linked service" });
    expect(pick(t, "tr_daily")).toMatchObject({ kind: "other", detail: "Data factory trigger" });
    expect(pick(t, "f.json")).toMatchObject({ kind: "other", detail: "JSON" });
  });
  it("a Synapse workspace's notebooks and SQL scripts, at the repo's top", () => {
    const t = thingsOf(["/template-parameters-definition.json", "/notebook/nb_explore.json", "/sqlscript/top_rows.json", "/pipeline/pl_a.json"]);
    expect(pick(t, "nb_explore")).toMatchObject({ kind: "notebook", detail: "Synapse notebook" });
    expect(pick(t, "top_rows")).toMatchObject({ kind: "sql", detail: "Synapse SQL script" });
    expect(pick(t, "pl_a")).toMatchObject({ kind: "pipeline", detail: "Synapse pipeline" });
  });
  it("one folder named pipeline alone isn't a factory, unless a root file says so", () => {
    expect(thingsOf(["/x/pipeline/a.json"])[0]).toMatchObject({ kind: "other" });
    expect(pick(thingsOf(["/x/publish_config.json", "/x/pipeline/a.json"]), "a")).toMatchObject({ kind: "pipeline", detail: "Data factory pipeline" });
  });
  it("a repo that mixes Fabric items and a data factory", () => {
    const t = thingsOf(["/fabric/Daily.DataPipeline/.platform", "/fabric/Daily.DataPipeline/pipeline-content.json", "/adf/pipeline/pl_old.json", "/adf/dataset/ds.json", "/README.md"]);
    expect(groupThings(t).map((g) => [g.label, g.things.map((x) => x.name)])).toEqual([
      ["Pipelines", ["Daily", "pl_old"]],
      ["Other", ["ds", "README.md"]],
    ]);
    expect(pick(t, "Daily")!.detail).toBe("Pipeline");
  });
});

describe("SQL, notebooks and the rest", () => {
  it("a .sql file is a thing named by its file; schema and object folders are said where the path shows them", () => {
    const t = thingsOf(["/db/Shop.sqlproj", "/db/sales/Tables/Orders.sql", "/db/sales/Views/vOrders.sql", "/db/etl/Stored Procedures/usp_Load.sql", "/db/sales/Functions/fn_Tax.sql", "/scripts/fix.sql", "/Tables/Loose.sql"]);
    expect(pick(t, "Orders")).toMatchObject({ kind: "sql", detail: "Table in sales", file: "/db/sales/Tables/Orders.sql" });
    expect(pick(t, "vOrders")!.detail).toBe("View in sales");
    expect(pick(t, "usp_Load")!.detail).toBe("Stored procedure in etl");
    expect(pick(t, "fn_Tax")!.detail).toBe("Function in sales");
    expect(pick(t, "fix")!.detail).toBe("SQL script");
    expect(pick(t, "Loose")!.detail).toBe("Table");
    expect(pick(t, "Shop")).toMatchObject({ kind: "sql", detail: "SQL project" });
  });
  it("a notebook by its file type, and everything else as Other with its language", () => {
    const t = thingsOf(["/nb/explore.ipynb", "/deploy.ps1", "/azure-pipelines.yml", "/LICENSE"]);
    expect(pick(t, "explore")).toMatchObject({ kind: "notebook", detail: "Jupyter notebook" });
    expect(pick(t, "deploy.ps1")).toMatchObject({ kind: "other", detail: "PowerShell" });
    expect(pick(t, "azure-pipelines.yml")!.detail).toBe("YAML");
    expect(pick(t, "LICENSE")!.detail).toBe("Plain text");
  });
  it("groups come in their order and an empty group doesn't show", () => {
    const t = thingsOf(["/z.sql", "/A.Report/.platform", "/n.ipynb"]);
    expect(groupThings(t).map((g) => g.label)).toEqual([KIND_GROUPS.report, KIND_GROUPS.notebook, KIND_GROUPS.sql]);
    expect(groupThings([])).toEqual([]);
  });
  it("every file is one thing or inside an item, and 20,000 names sort in well under a second", () => {
    const paths: string[] = [];
    for (let i = 0; i < 400; i++) {
      paths.push(`/ws/Item ${i}.Report/.platform`, `/ws/Item ${i}.Report/definition.pbir`);
      for (let j = 0; j < 10; j++) paths.push(`/ws/Model ${i}.SemanticModel/definition/tables/T${j}.tmdl`);
      paths.push(`/ws/Model ${i}.SemanticModel/.platform`);
    }
    for (let i = 0; paths.length < 20_000; i++) paths.push(`/db/s${i % 40}/Tables/t${i}.sql`);
    const started = performance.now();
    const t = thingsOf(paths);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(t.filter((x) => x.kind === "report")).toHaveLength(400);
    expect(t.filter((x) => x.kind === "model").every((m) => m.tables?.length === 10)).toBe(true);
    expect(t.filter((x) => x.kind === "sql")).toHaveLength(20_000 - 400 * 13);
  });
});

describe("searching names", () => {
  const things = thingsOf(["/ws/Orders by store.Report/.platform", "/ws/Retail.SemanticModel/.platform", "/ws/Retail.SemanticModel/definition/tables/Date.tmdl", "/adf/pipeline/pl_load_orders.json", "/adf/dataset/ds_orders.json", "/sql/dbo/Tables/Orders.sql"]);
  it("matches the name, the file name and the folder names, any case, words in any order", () => {
    expect(searchThings(things, "ORDERS").map((h) => h.name).sort()).toEqual(["Orders", "Orders by store", "ds_orders", "pl_load_orders"]);
    expect(searchThings(things, "orders load").map((h) => h.name)).toEqual(["pl_load_orders"]);
    expect(searchThings(things, "dbo").map((h) => h.name)).toEqual(["Orders"]);
    expect(searchThings(things, "   ")).toEqual([]);
  });
  it("a model's table is a result of its own", () => {
    expect(searchThings(things, "date")).toMatchObject([{ name: "Date", detail: "Table in Retail", file: "/ws/Retail.SemanticModel/definition/tables/Date.tmdl" }]);
  });
  it("a kind narrows it", () => {
    expect(searchThings(things, "orders", "pipeline").map((h) => h.name)).toEqual(["pl_load_orders"]);
  });
  it("marks the matched parts of a path", () => {
    expect(markMatches("/adf/pipeline/pl_load_orders.json", "Orders pl_")).toEqual([
      { text: "/adf/pipeline/", hit: false },
      { text: "pl_", hit: true },
      { text: "load_", hit: false },
      { text: "orders", hit: true },
      { text: ".json", hit: false },
    ]);
  });
});
