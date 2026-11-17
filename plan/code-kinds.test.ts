// RB-2: a repo's things by kind, from invented file paths only. Each layout in the documentation, and the odd cases.
import { describe, expect, it } from "vitest";
import { groupThings, KIND_GROUPS, KINDS, listedThings, markMatches, searchThings, shareCap, sortRepo, thingsOf, type Thing } from "./code-kinds.ts";

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
    // RB-6: a warehouse is a database.
    expect(pick(things, "Gold")).toMatchObject({ kind: "database", detail: "Warehouse" });
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
  it("a folder with a dot of its own and no known type after it is typed by a file inside, and keeps its whole name (review 2)", () => {
    const t = thingsOf(["/Sales v1.5/.platform", "/Sales v1.5/definition.pbir", "/Sales v1.5/report.json", "/Plan v2.1/.platform"]);
    expect(pick(t, "Sales v1.5")).toMatchObject({ kind: "report", detail: "Report" });
    // Nothing inside says what it is: the part after the dot shows as it is written.
    expect(pick(t, "Plan v2")).toMatchObject({ kind: "fabric", detail: "1" });
  });
  it("shows a character Fabric wrote as its HTML number", () => {
    expect(thingsOf(["/Cost&#58; plan.Report/.platform"])[0]).toMatchObject({ name: "Cost: plan", folder: "/Cost&#58; plan.Report" });
  });
  it("a marker at the repo's top doesn't make the whole repo one item", () => {
    expect(thingsOf(["/.platform", "/a.sql"]).map((t) => t.kind).sort()).toEqual(["other", "script"]);
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
    expect(pick(t, "top_rows")).toMatchObject({ kind: "script", detail: "Synapse SQL script" });
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
    // RB-6: a SQL project is a database holding its objects; they are listed only inside it.
    expect(pick(t, "Orders")).toMatchObject({ kind: "database", detail: "Table in sales · Shop SQL project", item: "Shop SQL project", file: "/db/sales/Tables/Orders.sql" });
    expect(pick(t, "vOrders")!.detail).toBe("View in sales · Shop SQL project");
    expect(pick(t, "usp_Load")!.detail).toBe("Stored procedure in etl · Shop SQL project");
    expect(pick(t, "fn_Tax")!.detail).toBe("Function in sales · Shop SQL project");
    expect(pick(t, "fix")).toMatchObject({ kind: "script", detail: "SQL script" });
    expect(pick(t, "Loose")).toMatchObject({ kind: "script", detail: "Table" });
    const shop = pick(t, "Shop")!;
    expect(shop).toMatchObject({ kind: "database", detail: "SQL project · 4 objects", file: "/db/Shop.sqlproj" });
    expect(shop.inside!.map((x) => [x.name, x.detail])).toEqual([["fn_Tax", "Function in sales"], ["Orders", "Table in sales"], ["usp_Load", "Stored procedure in etl"], ["vOrders", "View in sales"]]);
    expect(listedThings(t).map((x) => x.name).sort()).toEqual(["Loose", "Shop", "fix"]);
  });
  it("a notebook by its file type, and everything else as Other with its language", () => {
    const t = thingsOf(["/nb/explore.ipynb", "/deploy.ps1", "/azure-pipelines.yml", "/LICENSE"]);
    expect(pick(t, "explore")).toMatchObject({ kind: "notebook", detail: "Jupyter notebook" });
    expect(pick(t, "deploy.ps1")).toMatchObject({ kind: "other", detail: "PowerShell" });
    expect(pick(t, "azure-pipelines.yml")!.detail).toBe("YAML");
    expect(pick(t, "LICENSE")!.detail).toBe("File");
    // Review 1: a file Code can't name a language for says its type, never "Plain text".
    const odd = thingsOf(["/a/map.png", "/a/old.parquet", "/a/Model.pbix", "/a/page.html", "/a/rows.csv", "/a/notes.txt"]);
    expect(odd.map((x) => [x.name, x.detail])).toEqual([["map.png", "PNG file"], ["Model.pbix", "PBIX file"], ["notes.txt", "Plain text"], ["old.parquet", "PARQUET file"], ["page.html", "HTML"], ["rows.csv", "CSV"]]);
  });
  it("groups come in their order and an empty group doesn't show", () => {
    const t = thingsOf(["/z.sql", "/A.Report/.platform", "/n.ipynb"]);
    expect(groupThings(t).map((g) => g.label)).toEqual([KIND_GROUPS.report, KIND_GROUPS.notebook, KIND_GROUPS.script]);
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
    expect(t.filter((x) => x.kind === "script")).toHaveLength(20_000 - 400 * 13);
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
  it("names first, then things found only by a folder's name; a table only by its own name (review 1)", () => {
    const t = thingsOf(["/db/etl/StoredProcedures/usp_Load.sql", "/ws/Store visits.SemanticModel/.platform", "/ws/Store visits.SemanticModel/definition/tables/Date.tmdl", "/ws/Store visits.SemanticModel/definition/tables/Store.tmdl", "/ws/Store list.Dataflow/.platform"]);
    expect(searchThings(t, "store").map((h) => [h.name, h.detail])).toEqual([["Store visits", "Semantic model"], ["Store", "Table in Store visits"], ["Store list", "Dataflow"], ["usp_Load", "Stored procedure"]]);
  });
  it("a model's table is a result of its own", () => {
    expect(searchThings(things, "date")).toMatchObject([{ name: "Date", detail: "Table in Retail", file: "/ws/Retail.SemanticModel/definition/tables/Date.tmdl" }]);
  });
  it("a kind narrows it", () => {
    expect(searchThings(things, "orders", "pipeline").map((h) => h.name)).toEqual(["pl_load_orders"]);
  });
  it("over the limit, clients take what is left in order, and each still knows its own count (review 2)", () => {
    expect(shareCap([150, 80, 30], 200)).toEqual([150, 50, 0]);
    expect(shareCap([3, 4], 200)).toEqual([3, 4]);
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

describe("one home per thing (RB-6)", () => {
  it("review: a project file named only .sqlproj is no project, and nothing is lost or thrown", () => {
    const t = thingsOf(["/db/.sqlproj", "/db/dbo/Tables/Orders.sql", "/db/dbo/Views/vOrders.sql"]);
    expect(t.map((x) => x.file).sort()).toEqual(["/db/.sqlproj", "/db/dbo/Tables/Orders.sql", "/db/dbo/Views/vOrders.sql"]);
    expect(t.some((x) => x.kind === "database" && !x.item)).toBe(false);
  });
  /** A repo with every kind of home: a warehouse, a SQL database, a SQL project, a model, items with things inside, loose SQL. */
  const REPO = [
    "/ws/Kiln.Warehouse/.platform",
    "/ws/Kiln.Warehouse/kiln.sqlproj",
    "/ws/Kiln.Warehouse/fire/Tables/Batch.sql",
    "/ws/Kiln.Warehouse/fire/Views/vBatch.sql",
    "/ws/Kiln.Warehouse/Security/fire.sql",
    "/ws/Ledger.SQLDatabase/.platform",
    "/ws/Ledger.SQLDatabase/acct/Tables/Entry.sql",
    "/ws/Ledger.SQLDatabase/acct/StoredProcedures/usp_Post.sql",
    "/ws/Yard.SemanticModel/.platform",
    "/ws/Yard.SemanticModel/definition/model.tmdl",
    "/ws/Yard.SemanticModel/definition/tables/Stack.tmdl",
    "/ws/Bronze.Lakehouse/.platform",
    "/ws/Bronze.Lakehouse/explore.ipynb",
    "/ws/Tidy.Notebook/.platform",
    "/ws/Tidy.Notebook/notebook-content.sql",
    "/db/Quarry.sqlproj",
    "/db/ore/Tables/Seam.sql",
    "/db/Security/ore.sql",
    "/db/README.md",
    "/scripts/one-off.sql",
    "/scripts/Tables/Loose.sql",
    "/adf/pipeline/pl_a.json",
    "/adf/sqlscript/q.json",
    "/adf/publish_config.json",
  ];
  const sorted = sortRepo(REPO);
  /** Every file By kind lists, with the group it shows under: a row of a group, or inside one row (its tables or objects). */
  const homes = () => {
    const out = new Map<string, string[]>();
    const add = (file: string, where: string) => out.set(file, [...(out.get(file) ?? []), where]);
    for (const g of groupThings(listedThings(sorted.things)))
      for (const t of g.things) {
        add(t.file, g.label);
        for (const tb of t.tables ?? []) add(tb.file, `${g.label} › ${t.name}`);
        for (const x of t.inside ?? []) add(x.file, `${g.label} › ${t.name}`);
      }
    return out;
  };
  it("the groups, in their order: Reports to Other, with Lakehouses, Databases and SQL scripts", () => {
    expect(KINDS.map((k) => KIND_GROUPS[k])).toEqual(["Reports", "Semantic models", "Pipelines", "Notebooks", "Dataflows", "Lakehouses", "Databases", "SQL scripts", "Other Fabric items", "Other"]);
    expect(groupThings(listedThings(sorted.things)).map((g) => [g.label, g.things.map((t) => t.name)])).toEqual([
      ["Semantic models", ["Yard"]],
      ["Pipelines", ["pl_a"]],
      ["Notebooks", ["Tidy"]],
      ["Lakehouses", ["Bronze"]],
      ["Databases", ["Kiln", "Ledger", "Quarry"]],
      ["SQL scripts", ["Loose", "one-off", "q"]],
      ["Other", ["publish_config.json", "README.md"]],
    ]);
  });
  it("no file is listed twice, and every file is listed or found by its own name", () => {
    const h = homes();
    for (const [file, where] of h) expect(where, file).toHaveLength(1);
    const byName = new Set(sorted.files.map((f) => f.file));
    for (const p of REPO) expect(h.has(p) || byName.has(p), p).toBe(true);
  });
  it("a database's objects are inside it and nowhere else, of its kind, saying what and where", () => {
    const h = homes();
    expect(h.get("/ws/Kiln.Warehouse/fire/Tables/Batch.sql")).toEqual(["Databases › Kiln"]);
    expect(h.get("/ws/Ledger.SQLDatabase/acct/StoredProcedures/usp_Post.sql")).toEqual(["Databases › Ledger"]);
    expect(h.get("/db/ore/Tables/Seam.sql")).toEqual(["Databases › Quarry"]);
    expect(sorted.things.find((t) => t.name === "Batch")).toMatchObject({ kind: "database", itemKind: "database", detail: "Table in fire · Kiln warehouse" });
    expect(sorted.things.find((t) => t.name === "Seam")).toMatchObject({ kind: "database", detail: "Table in ore · Quarry SQL project" });
    // Each database says how many objects it holds; a group's count is its rows.
    const dbs = groupThings(listedThings(sorted.things)).find((g) => g.kind === "database")!;
    expect(dbs.things.map((t) => t.detail)).toEqual(["Warehouse · 4 objects", "SQL database · 2 objects", "SQL project · 2 objects"]);
  });
  it("a model's tables and an item's own things stay inside it", () => {
    const h = homes();
    expect(h.get("/ws/Yard.SemanticModel/definition/tables/Stack.tmdl")).toEqual(["Semantic models › Yard"]);
    expect(h.get("/ws/Bronze.Lakehouse/explore.ipynb")).toEqual(["Lakehouses › Bronze"]);
  });
  it("the kind filter of a search: Databases finds databases and the objects inside them; SQL scripts only loose SQL", () => {
    expect(searchThings(sorted.things, "seam", "database").map((x) => [x.name, x.detail])).toEqual([["Seam", "Table in ore · Quarry SQL project"]]);
    expect(searchThings(sorted.things, "kiln", "database").map((x) => x.name)).toContain("Kiln");
    expect(searchThings(sorted.things, "seam", "script")).toEqual([]);
    expect(searchThings(sorted.things, "loose", "script").map((x) => x.name)).toEqual(["Loose"]);
  });
});

describe("UC-2: one object type under Databases, in the search", () => {
  const db = "/lake/Gold.Warehouse";
  const things = thingsOf([`${db}/.platform`, `${db}/dbo/Tables/Store.sql`, `${db}/dbo/Views/StoreSales.sql`, `${db}/dbo/StoredProcedures/LoadStore.sql`, `${db}/dbo/Functions/StoreMargin.sql`, "/scripts/store_cleanup.sql"]);
  const names = (kind: Parameters<typeof searchThings>[2], type: Parameters<typeof searchThings>[4]) => searchThings(things, "store", kind, [], type).map((h) => h.name).sort();
  it("narrows Databases to that type only; all types shows what it shows today", () => {
    expect(names("database", "table")).toEqual(["Store"]);
    expect(names("database", "view")).toEqual(["StoreSales"]);
    expect(names("database", "procedure")).toEqual(["LoadStore"]);
    expect(names("database", "function")).toEqual(["StoreMargin"]);
    expect(names("database", null)).toEqual(searchThings(things, "store", "database").map((h) => h.name).sort());
    expect(names("database", null)).toEqual(["LoadStore", "Store", "StoreMargin", "StoreSales"]);
  });
  it("means nothing under another kind", () => {
    expect(names(null, "table")).toEqual(searchThings(things, "store").map((h) => h.name).sort());
    expect(names("script", "table")).toEqual(searchThings(things, "store", "script").map((h) => h.name).sort());
  });
});
