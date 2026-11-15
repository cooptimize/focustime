// RB-5: a database's SQL objects in folders, by schema then type or by type then schema, from paths alone. Every
// name here is invented.
import { describe, expect, it } from "vitest";
import { NO_SCHEMA, sortRepo, sqlDatabases, sqlTree, SQL_TYPES, type SqlGrouping, type Thing } from "./code-kinds.ts";

/** An invented warehouse item, a SQL project and loose SQL files. */
const REPO = [
  "/ws/Quarry.Warehouse/.platform",
  "/ws/Quarry.Warehouse/sqldw.sqlproj",
  "/ws/Quarry.Warehouse/ore/Tables/Seam.sql",
  "/ws/Quarry.Warehouse/ore/Tables/Bench.sql",
  "/ws/Quarry.Warehouse/ore/Views/vSeam.sql",
  "/ws/Quarry.Warehouse/ore/StoredProcedures/usp_Blast.sql",
  "/ws/Quarry.Warehouse/ore/Functions/fnGrade.sql",
  "/ws/Quarry.Warehouse/haul/Tables/Seam.sql",
  "/ws/Quarry.Warehouse/haul/Views/vTrips.sql",
  "/ws/Quarry.Warehouse/Assay/Tables/Sample.sql",
  "/ws/Quarry.Warehouse/assay/Views/vSample.sql",
  "/ws/Quarry.Warehouse/Security/haul.sql",
  "/ws/Quarry.Warehouse/Security/blasters.sql",
  "/ws/Quarry.Warehouse/.sharedqueries/Tonnage check.sql",
  "/ws/Quarry.Warehouse/AfterDeploy.sql",
  "/ws/Quarry.Warehouse/ore/notes.sql",
  "/db/Kiln.sqlproj",
  "/db/fire/Tables/Batch.sql",
  "/db/fire/Procedures/usp_Fire.sql",
  "/db/Security/fire.sql",
  "/scratch/Tables/Loose.sql",
  "/scratch/one-off.sql",
];
const sql = (paths: readonly string[] = REPO): Thing[] => sortRepo(paths).things.filter((t) => t.kind === "sql");
const inDb = (db: string) => sql().filter((t) => t.db === db);
const shape = (objects: Thing[], g: SqlGrouping) => sqlTree(objects, g).folders.map((f) => `${f.label} ${f.count}: ${f.folders.map((l) => `${l.label} ${l.count} [${l.objects.map((o) => o.name).join(", ")}]`).join("; ")}`);

describe("a SQL object's type, schema and database are facts from its path (RB-5 A1)", () => {
  it("the type is the folder it sits in; a file in none of them is a script", () => {
    const facts = Object.fromEntries(sql().map((t) => [t.file, [t.sqlType, t.schema ?? null, t.dbName ?? null]]));
    expect(facts["/ws/Quarry.Warehouse/ore/Tables/Seam.sql"]).toEqual(["table", "ore", "Quarry warehouse"]);
    expect(facts["/ws/Quarry.Warehouse/ore/Views/vSeam.sql"]).toEqual(["view", "ore", "Quarry warehouse"]);
    expect(facts["/ws/Quarry.Warehouse/ore/StoredProcedures/usp_Blast.sql"]).toEqual(["procedure", "ore", "Quarry warehouse"]);
    expect(facts["/ws/Quarry.Warehouse/ore/Functions/fnGrade.sql"]).toEqual(["function", "ore", "Quarry warehouse"]);
    expect(facts["/ws/Quarry.Warehouse/AfterDeploy.sql"]).toEqual(["script", null, "Quarry warehouse"]);
    // A SQL file in a schema's folder but in no type's folder is still a script, with no schema said.
    expect(facts["/ws/Quarry.Warehouse/ore/notes.sql"]).toEqual(["script", null, "Quarry warehouse"]);
    expect(facts["/db/fire/Procedures/usp_Fire.sql"]).toEqual(["procedure", "fire", "Kiln SQL project"]);
    expect(facts["/db/Kiln.sqlproj"]).toEqual(["project", null, "Kiln SQL project"]);
    expect(facts["/ws/Quarry.Warehouse/sqldw.sqlproj"]).toEqual(["project", null, "Quarry warehouse"]);
    // Outside a database a folder above Tables isn't said to be a schema, and there is no database.
    expect(facts["/scratch/Tables/Loose.sql"]).toEqual(["table", null, null]);
    expect(facts["/scratch/one-off.sql"]).toEqual(["script", null, null]);
  });
  it("a schema's own definition is a Schema, not a script; other files in Security are security objects; shared queries are their own type", () => {
    const by = Object.fromEntries(sql().map((t) => [t.file, t]));
    expect(by["/ws/Quarry.Warehouse/Security/haul.sql"]).toMatchObject({ sqlType: "schema", schema: "haul", detail: "Schema · Quarry warehouse" });
    expect(by["/db/Security/fire.sql"]).toMatchObject({ sqlType: "schema", schema: "fire", detail: "Schema" });
    expect(by["/ws/Quarry.Warehouse/Security/blasters.sql"]).toMatchObject({ sqlType: "security", detail: "Security object · Quarry warehouse" });
    expect(by["/ws/Quarry.Warehouse/Security/blasters.sql"]!.schema).toBeUndefined();
    expect(by["/ws/Quarry.Warehouse/.sharedqueries/Tonnage check.sql"]).toMatchObject({ sqlType: "shared", detail: "Shared query · Quarry warehouse" });
    // A Security folder that isn't a database's own is only a folder.
    expect(sql(["/x/Security/haul.sql", "/x/haul/Tables/A.sql"]).map((t) => t.sqlType)).toEqual(["table", "script"]);
  });
  it("an item's things inside carry the same facts", () => {
    const quarry = sortRepo(REPO).things.find((t) => t.name === "Quarry" && t.kind === "lake")!;
    expect(quarry.inside!.find((x) => x.file.endsWith("/haul/Tables/Seam.sql"))).toMatchObject({ sqlType: "table", schema: "haul" });
    expect(quarry.inside!.every((x) => x.sqlType)).toBe(true);
  });
});

describe("sqlTree (RB-5 A2)", () => {
  const quarry = inDb("/ws/Quarry.Warehouse");
  it("by schema: schemas by name ignoring case, No schema last; inside each, types in order with Scripts last", () => {
    expect(shape(quarry, "schema")).toEqual([
      "Assay 2: Tables 1 [Sample]; Views 1 [vSample]",
      "haul 3: Tables 1 [Seam]; Views 1 [vTrips]; Schemas 1 [haul]",
      "ore 5: Tables 2 [Bench, Seam]; Views 1 [vSeam]; Stored procedures 1 [usp_Blast]; Functions 1 [fnGrade]",
      `${NO_SCHEMA} 5: Security 1 [blasters]; Shared queries 1 [Tonnage check]; SQL projects 1 [sqldw]; Scripts 2 [AfterDeploy, notes]`,
    ]);
  });
  it("by type: Tables, Views, Stored procedures, Functions, the others by name, Scripts; inside each, schemas by name", () => {
    expect(shape(quarry, "type")).toEqual([
      "Tables 4: Assay 1 [Sample]; haul 1 [Seam]; ore 2 [Bench, Seam]",
      "Views 3: Assay 1 [vSample]; haul 1 [vTrips]; ore 1 [vSeam]",
      "Stored procedures 1: ore 1 [usp_Blast]",
      "Functions 1: ore 1 [fnGrade]",
      "Schemas 1: haul 1 [haul]",
      `Security 1: ${NO_SCHEMA} 1 [blasters]`,
      `Shared queries 1: ${NO_SCHEMA} 1 [Tonnage check]`,
      `SQL projects 1: ${NO_SCHEMA} 1 [sqldw]`,
      `Scripts 2: ${NO_SCHEMA} 2 [AfterDeploy, notes]`,
    ]);
    expect(SQL_TYPES).toEqual(["table", "view", "procedure", "function", "schema", "security", "shared", "project", "script"]);
  });
  it("counts add up at each level and every object is in exactly one folder, in both groupings", () => {
    for (const g of ["schema", "type"] as const) {
      const tree = sqlTree(quarry, g);
      expect(tree.count).toBe(quarry.length);
      expect(tree.folders.reduce((n, f) => n + f.count, 0)).toBe(quarry.length);
      for (const f of tree.folders) expect(f.folders.reduce((n, l) => n + l.count, 0)).toBe(f.count);
      for (const f of tree.folders) for (const l of f.folders) expect(l.objects.length).toBe(l.count);
      const files = tree.folders.flatMap((f) => f.folders.flatMap((l) => l.objects.map((o) => o.file)));
      expect(files.sort()).toEqual(quarry.map((t) => t.file).sort());
      // No empty folder at either level.
      expect(tree.folders.every((f) => f.count > 0 && f.folders.every((l) => l.count > 0))).toBe(true);
    }
  });
  it("two objects with one name in different schemas sit in their own schemas, and side by side under their type", () => {
    const seams = (g: SqlGrouping) => sqlTree(quarry, g).folders.flatMap((f) => f.folders.flatMap((l) => l.objects.filter((o) => o.name === "Seam").map(() => `${f.label} › ${l.label}`)));
    expect(seams("schema")).toEqual(["haul › Tables", "ore › Tables"]);
    expect(seams("type")).toEqual(["Tables › haul", "Tables › ore"]);
  });
  it("a schema spelled with other capitals is one folder", () => {
    expect(sqlTree(quarry, "schema").folders.filter((f) => f.label.toLowerCase() === "assay").map((f) => [f.label, f.count])).toEqual([["Assay", 2]]);
  });
  it("review 2: a schema's folder is spelled as a folder spells it, not as its definition file is named", () => {
    const things = sql(["/w/Pit.Warehouse/.platform", "/w/Pit.Warehouse/Shaft/Tables/A.sql", "/w/Pit.Warehouse/shaft/Views/B.sql", "/w/Pit.Warehouse/Security/SHAFT.sql"]);
    expect(sqlTree(things, "schema").folders.map((f) => [f.label, f.count])).toEqual([["Shaft", 3]]);
  });
  it("a SQL thing with no type is a script; nothing in gives nothing out", () => {
    expect(shape([{ kind: "sql", name: "q", detail: "Synapse SQL script", folder: "/s/sqlscript", file: "/s/sqlscript/q.json" }], "schema")).toEqual([`${NO_SCHEMA} 1: Scripts 1 [q]`]);
    expect(sqlTree([], "schema")).toEqual({ count: 0, folders: [] });
    expect(sqlTree([], "type")).toEqual({ count: 0, folders: [] });
  });
});

describe("a client's databases (RB-5, test 5)", () => {
  const rows = (paths: readonly string[], repoId = "r1", repoName = "one") => sql(paths).map((t) => ({ ...t, repoId, repoName }));
  it("two databases come first, by name, each with its own objects; the rest are loose", () => {
    const { databases, loose } = sqlDatabases(rows(REPO), false);
    expect(databases.map((d) => [d.label, d.objects.length])).toEqual([["Kiln SQL project", 4], ["Quarry warehouse", 15]]);
    expect(loose.map((t) => t.name).sort()).toEqual(["Loose", "one-off"]);
    expect(databases.reduce((n, d) => n + d.objects.length, 0) + loose.length).toBe(sql().length);
  });
  it("one database is one: the grouping starts at the top", () => {
    const one = REPO.filter((p) => p.startsWith("/ws/"));
    expect(sqlDatabases(rows(one), false).databases.map((d) => d.label)).toEqual(["Quarry warehouse"]);
  });
  it("with more than one repo the repo is named, and the same folder in two repos is two databases", () => {
    const one = REPO.filter((p) => p.startsWith("/db/"));
    const { databases } = sqlDatabases([...rows(one, "r1", "kiln-a"), ...rows(one, "r2", "kiln-b")], true);
    expect(databases.map((d) => d.label)).toEqual(["Kiln SQL project · kiln-a", "Kiln SQL project · kiln-b"]);
  });
});
