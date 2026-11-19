// RB-2: a repo's things by kind, from its file paths and nothing else. Pure: no I/O, and no file is ever opened to
// decide anything here. The rules are the tables below, built from the documentation as it stood on Nov 14 (the links
// are in docs/decisions/rb-2.md under RB-2); adding a kind or a type's label is one row. No client's, repo's or folder's
// name from a real client is in here.
//
// The rules, in order (a file belongs to the first that takes it):
//   1. A Fabric item or a Power BI project item: a folder holding the item's marker (.platform; the older pair
//      item.metadata.json and item.config.json; or a Power BI project's definition.pbir or definition.pbism). Its name
//      is the folder's name before the last dot and its type the part after it. Everything under it is the item's.
//   2. A data factory or Synapse workspace: the resource folders (pipeline, dataset, linkedService, ...) side by side
//      under one root, one thing per JSON file.
//   3. SQL: each .sql file, and a .sqlproj project file.
//   4. Notebooks not found above, by their file type.
//   5. Everything else is Other, with the language Code already knows for the file.
//
// RB-4: nothing the tree shows is missed. Inside an item's folder a file that rules 3 and 4 would name is a thing of
// its own (a warehouse's tables, views and procedures; a notebook file), listed under its own kind and inside its
// item; and every other file inside an item is kept by its path (`files`), so a search for a file's own name always
// finds that file. A folder above Tables, Views and the like is said to be a schema only where the path shows one:
// inside an item or under a SQL project.
//
// RB-5: a SQL object's type (table, view, stored procedure, function, ...) is a fact of its own beside its schema,
// from the folder it sits in, and so is the database it belongs to (a warehouse or SQL database item, or a SQL
// project's folder). sqlTree turns a database's objects into folders: schema then type, or type then schema. Still
// names and folders only.
//
// RB-6: one home per thing. A thing inside another (a database's objects, a model's tables, a notebook file inside an
// item) is listed only inside it: `things` still holds it, with `item` set, so a search finds it, and listedThings
// leaves it out of By kind's groups. A database is a group of its own (Databases: warehouses, SQL databases and SQL
// projects, each holding its objects), and a .sql file in no database is a SQL script.
import { languageOf, LANG_NAMES } from "./code-languages.ts";
import type { CodeRepoView } from "./code.ts";

export const KINDS = ["report", "model", "pipeline", "notebook", "dataflow", "lake", "database", "script", "fabric", "other"] as const;
export type Kind = (typeof KINDS)[number];
/** The groups, in the order they show. A group with nothing in it doesn't show. */
export const KIND_GROUPS: Readonly<Record<Kind, string>> = {
  report: "Reports",
  model: "Semantic models",
  pipeline: "Pipelines",
  notebook: "Notebooks",
  dataflow: "Dataflows",
  lake: "Lakehouses",
  database: "Databases",
  script: "SQL scripts",
  fabric: "Other Fabric items",
  other: "Other",
};

export type ThingTable = { name: string; file: string };
/** RB-4: something inside an item that is a thing of its own (a warehouse's table): what By kind opens the item to. */
export type ThingInside = { name: string; file: string; kind: Kind; detail: string; /** RB-5: a SQL object's type and schema. */ sqlType?: SqlType; schema?: string };
export type Thing = {
  kind: Kind;
  name: string;
  /** What it is in a few words: "Report", "Data factory pipeline", "Table in dbo", "YAML". */
  detail: string;
  /** The folder it lives in ("/" for the repo's top). */
  folder: string;
  /** The file to open. */
  file: string;
  /** A semantic model's tables, where the layout keeps one file per table. */
  tables?: ThingTable[];
  /** RB-4: the things inside an item (they are also things of their own, under their own kind). */
  inside?: ThingInside[];
  /** RB-4: for a thing inside an item, the item in words ("Sales warehouse"). RB-6: set means listed only inside it. */
  item?: string;
  /** RB-4: for a thing inside an item, the item's kind: the kind filter finds a warehouse's table under either. */
  itemKind?: Kind;
  /** RB-4: a SQL object's schema, where the path shows one: "dim.Store" finds it too. */
  schema?: string;
  /** RB-5: a SQL thing's type, from the folder it sits in ("script" for a SQL file in none of them). */
  sqlType?: SqlType;
  /** RB-5: the database a SQL thing belongs to: the folder of its warehouse or SQL database item, or of its SQL project. */
  db?: string;
  /** RB-5: that database in words ("Gold warehouse", "Warehouse SQL project"). */
  dbName?: string;
  /** RB-3b: only in code.kinds' answer to Where is it?: what the box may open it to (plan/where-inner.ts). */
  whereMore?: "pages" | "tables";
};
/** RB-4: a file inside an item that is no thing of its own: found only by its own name, under Files. */
export type RepoFile = { file: string; kind: Kind; detail: string; /** The item's folder: a folder inside it is found by name too. */ item: string };

/** One repo of a client as By kind and Search names get it: its things, or one line saying why there are none. */
export type RepoThings = { repo: CodeRepoView; things: Thing[]; /** RB-4: the files inside items that are no thing of their own. */ files: RepoFile[]; cut: boolean; problem: string | null; /** RB-7: the branch these names were read on, when it isn't the repo's opening branch (a result opens on it). */ branch?: string };

// ---------- 1. Fabric items ----------

/** A Fabric item type as the folder's suffix writes it: its group and its plain label. One row per type. */
const FABRIC_TYPES: readonly (readonly [type: string, kind: Kind, label: string])[] = [
  ["Report", "report", "Report"],
  ["PaginatedReport", "report", "Paginated report"],
  ["SemanticModel", "model", "Semantic model"],
  // A Power BI project's model folder before it was called a semantic model.
  ["Dataset", "model", "Semantic model"],
  ["DataPipeline", "pipeline", "Pipeline"],
  ["Notebook", "notebook", "Notebook"],
  ["Dataflow", "dataflow", "Dataflow"],
  ["Lakehouse", "lake", "Lakehouse"],
  ["Warehouse", "database", "Warehouse"],
  ["Dashboard", "fabric", "Dashboard"],
  ["Datamart", "fabric", "Datamart"],
  ["Eventhouse", "fabric", "Eventhouse"],
  ["Environment", "fabric", "Environment"],
  ["KQLDatabase", "fabric", "KQL database"],
  ["KQLQueryset", "fabric", "KQL queryset"],
  ["KQLDashboard", "fabric", "Real-Time Dashboard"],
  ["SparkJobDefinition", "fabric", "Spark job definition"],
  ["MLExperiment", "fabric", "Machine learning experiment"],
  ["MLModel", "fabric", "Machine learning model"],
  ["Eventstream", "fabric", "Eventstream"],
  ["MirroredDatabase", "fabric", "Mirrored database"],
  ["MirroredWarehouse", "fabric", "Mirrored warehouse"],
  ["MirroredAzureDatabricksCatalog", "fabric", "Mirrored Azure Databricks catalog"],
  ["Reflex", "fabric", "Activator"],
  ["GraphQLApi", "fabric", "GraphQL API"],
  ["MountedDataFactory", "fabric", "Mounted data factory"],
  ["SQLDatabase", "database", "SQL database"],
  ["CosmosDBDatabase", "fabric", "Cosmos database"],
  ["CopyJob", "fabric", "Copy job"],
  ["VariableLibrary", "fabric", "Variable library"],
  ["ApacheAirflowJob", "fabric", "Airflow job"],
  ["DataBuildToolJob", "fabric", "dbt job"],
  ["UserDataFunction", "fabric", "User data function"],
  ["DataAgent", "fabric", "Data agent"],
  ["OperationsAgent", "fabric", "Operations agent"],
  ["OrgApp", "fabric", "Org app"],
  ["Map", "fabric", "Map"],
  ["GraphModel", "fabric", "Graph model"],
  ["GraphQuerySet", "fabric", "Graph queryset"],
  ["Ontology", "fabric", "Ontology"],
  ["EventSchemaSet", "fabric", "Event schema set"],
  ["DigitalTwinBuilder", "fabric", "Digital twin builder"],
  ["AnomalyDetector", "fabric", "Anomaly detector"],
  ["DeploymentPlan", "fabric", "Deployment plan"],
];
const FABRIC_BY_TYPE = new Map(FABRIC_TYPES.map((r) => [r[0].toLowerCase(), r]));

/** The files that mark an item's folder: any one row's files, all present. */
const ITEM_MARKERS: readonly (readonly string[])[] = [[".platform"], ["item.metadata.json", "item.config.json"], ["definition.pbir"], ["definition.pbism"]];
/** A file inside an item that says its type when the folder's name doesn't (a folder renamed without ".Type"). */
const TYPE_BY_FILE: readonly (readonly [file: RegExp, type: string])[] = [
  [/^definition\.pbir$/, "Report"],
  [/^definition\.pbism$/, "SemanticModel"],
  [/^notebook-content\.[a-z]+$/, "Notebook"],
  [/^artifact\.content\.ipynb$/, "Notebook"],
  [/^pipeline-content\.json$/, "DataPipeline"],
];
/** The file an item opens on, most telling first (paths inside the item's folder); else its marker, else its first file. */
const OPEN_FIRST: readonly RegExp[] = [/^definition\/model\.tmdl$/, /^model\.bim$/, /^definition\/report\.json$/, /^report\.json$/, /^notebook-content\.[a-z]+$/, /^artifact\.content\.ipynb$/, /^pipeline-content\.json$/, /^definition\.pbir$/, /^definition\.pbism$/, /^\.platform$/, /^item\.metadata\.json$/];
/** One file per table: definition/tables/<table>.tmdl inside a semantic model. */
const TABLE_FILE = /^definition\/tables\/([^/]+)\.tmdl$/i;

// ---------- 2. Data factory and Synapse ----------

/** A resource folder under a factory's or workspace's root: one thing per JSON file in it. One row per folder. */
const FACTORY_FOLDERS: readonly (readonly [folder: string, kind: Kind, label: string, synapseOnly: boolean])[] = [
  ["pipeline", "pipeline", "pipeline", false],
  ["dataset", "other", "dataset", false],
  ["linkedService", "other", "linked service", false],
  ["trigger", "other", "trigger", false],
  ["dataflow", "dataflow", "data flow", false],
  ["integrationRuntime", "other", "integration runtime", false],
  ["credential", "other", "credential", false],
  ["notebook", "notebook", "notebook", true],
  ["sqlscript", "script", "SQL script", true],
  ["kqlscript", "other", "KQL script", true],
  ["sparkJobDefinition", "other", "Spark job definition", true],
];
const FACTORY_BY_FOLDER = new Map(FACTORY_FOLDERS.map((r) => [r[0].toLowerCase(), r]));
/** Files the documentation puts in the root folder; one of them beside a single resource folder is enough. */
const FACTORY_ROOT_FILES = ["publish_config.json", "arm-template-parameters-definition.json", "template-parameters-definition.json"];
const SYNAPSE_ROOT_FILE = "template-parameters-definition.json";

// ---------- 3. SQL ----------

/**
 * RB-5: a SQL object's types, in the order their folders show: the four the documentation names, then the others by
 * name, then Scripts for a SQL file that is none of them. One row per type: its id, its folder's label, one of it.
 */
const SQL_TYPE_ROWS = [
  ["table", "Tables", "Table"],
  ["view", "Views", "View"],
  ["procedure", "Stored procedures", "Stored procedure"],
  ["function", "Functions", "Function"],
  ["schema", "Schemas", "Schema"],
  ["security", "Security", "Security object"],
  ["shared", "Shared queries", "Shared query"],
  ["project", "SQL projects", "SQL project"],
  ["script", "Scripts", "SQL script"],
] as const;
export type SqlType = (typeof SQL_TYPE_ROWS)[number][0];
const SQL_FIRST: readonly SqlType[] = ["table", "view", "procedure", "function"];
const SQL_TYPE_LABEL = new Map<SqlType, string>(SQL_TYPE_ROWS.map((r) => [r[0], r[1]]));
const SQL_TYPE_ONE = new Map<SqlType, string>(SQL_TYPE_ROWS.map((r) => [r[0], r[2]]));
/** The types in the order their folders show: Tables, Views, Stored procedures, Functions, the others by name, Scripts. */
export const SQL_TYPES: readonly SqlType[] = [
  ...SQL_FIRST,
  ...SQL_TYPE_ROWS.map((r) => r[0]).filter((t) => !SQL_FIRST.includes(t) && t !== "script").sort((a, b) => SQL_TYPE_LABEL.get(a)!.localeCompare(SQL_TYPE_LABEL.get(b)!, "en", { sensitivity: "base" })),
  "script",
];
export const sqlTypeLabel = (t: SqlType): string => SQL_TYPE_LABEL.get(t)!;
/** UC-2: the object types a person can narrow Databases to, in By kind and in the search (one type, or all). */
export const SQL_PICK_TYPES: readonly SqlType[] = SQL_FIRST;
/** UC-2: whether a SQL object passes the type chosen under Databases (none chosen: every object does). */
export const sqlTypePasses = (t: { sqlType?: SqlType }, chosen: SqlType | null): boolean => !chosen || t.sqlType === chosen;

/**
 * The object folders of a database kept as a SQL project (a warehouse item, a SQL database item, a .sqlproj). The
 * documentation gives the layout as schema, then object type ("dbo/Tables/Table1.sql"), and names Tables, Views,
 * Functions and StoredProcedures; the other spellings are habits. The folder above is the schema.
 */
const SQL_OBJECT_FOLDERS: readonly (readonly [folder: RegExp, type: SqlType])[] = [
  [/^tables?$/i, "table"],
  [/^views?$/i, "view"],
  [/^(stored ?procedures?|procedures?|sprocs?)$/i, "procedure"],
  [/^functions?$/i, "function"],
];
/**
 * RB-5: folders of a database that hold no schema's objects. The documentation names the shared queries folder; it
 * names no folder for a schema's own definition or for roles and users, so Security is the folder the extract tool
 * writes them to (docs/open-questions/rb-5.md, RB-5). A file there named as one of the database's schemas is that Schema.
 */
const SQL_SECURITY_FOLDER = /^security$/i;
const SQL_SHARED_FOLDER = /^\.sharedqueries$/i;

// ---------- 4. Notebooks by file type ----------

const NOTEBOOK_EXT: Readonly<Record<string, string>> = { ipynb: "Jupyter notebook" };

// ---------- 5. Other ----------

/** A file type Code colors as something broader, said by its own name. One row per type. */
const OTHER_LABELS: Readonly<Record<string, string>> = { html: "HTML", htm: "HTML", svg: "SVG", csv: "CSV" };
/** What an Other file is: the language Code knows for it, else its type ("PNG file"), else "File". */
function otherLabel(name: string): string {
  const ext = extOf(name);
  if (OTHER_LABELS[ext]) return OTHER_LABELS[ext]!;
  const lang = languageOf(name);
  if (lang !== "plain") return LANG_NAMES[lang];
  return ext === "txt" ? LANG_NAMES.plain : ext ? `${ext.toUpperCase()} file` : "File";
}

// ---------- the rules ----------

const dirOf = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};
const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};
const stem = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};
/** Fabric writes a character a folder can't hold as its HTML number ("&#58;"); the name shows the character. */
const unescapeName = (s: string): string => s.replace(/&#(\d{1,7});/g, (m, n: string) => {
  const c = Number(n);
  return c >= 32 && c <= 0x10ffff && c !== 127 ? String.fromCodePoint(c) : m;
});
const byName = (a: Thing, b: Thing) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/** "Sales" and "Warehouse" → "Sales warehouse"; a label that starts with capitals keeps them ("Ledger SQL database"). */
const itemWords = (name: string, label: string): string => `${name} ${/^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label}`;

/** A repo sorted: its things, and the files inside items that are no thing of their own. */
export type RepoSort = { things: Thing[]; files: RepoFile[] };

/** A repo's things alone (see sortRepo). */
export const thingsOf = (paths: readonly string[]): Thing[] => sortRepo(paths).things;

/**
 * A repo's things, from its file paths ("/a/b.sql", as Find reads them). Every file is a thing's own file, a model's
 * table, or one of `files`. Things sorted by group, then name.
 */
export function sortRepo(paths: readonly string[]): RepoSort {
  const { things, files } = sortAll(paths);
  return { things, files };
}

const objectCount = (n: number) => `${n.toLocaleString("en-US")} object${n === 1 ? "" : "s"}`;
/** What an item opens to: its inner things, with the words before " · " (the item's own name isn't repeated inside it). */
const insideOf = (inner: readonly Thing[]): ThingInside[] => inner.map((t) => ({ name: t.name, file: t.file, kind: t.kind, detail: t.detail.split(" · ")[0]!, ...(t.sqlType ? { sqlType: t.sqlType } : {}), ...(t.schema ? { schema: t.schema } : {}) }));

/** RB-6: what By kind lists at the top of its groups: every thing that isn't inside another. */
export const listedThings = <T extends { item?: string }>(things: readonly T[]): T[] => things.filter((t) => !t.item);

function sortAll(paths: readonly string[]): RepoSort & { itemThings: Set<Thing>; projectThings: Set<Thing> } {
  const itemThings = new Set<Thing>();
  // Each folder's own files (lower case, to look a marker up) and the files that sit directly in it.
  const filesIn = new Map<string, Set<string>>();
  for (const p of paths) {
    const d = dirOf(p);
    let s = filesIn.get(d);
    if (!s) filesIn.set(d, (s = new Set()));
    s.add(baseOf(p).toLowerCase());
  }

  // 1. Item folders. The repo's top folder is never an item.
  const itemDirs = new Set<string>();
  for (const [d, names] of filesIn) if (d !== "/" && ITEM_MARKERS.some((m) => m.every((f) => names.has(f)))) itemDirs.add(d);
  const itemOfDir = new Map<string, string | null>();
  const itemFor = (dir: string): string | null => {
    const hit = itemOfDir.get(dir);
    if (hit !== undefined) return hit;
    const found = itemDirs.has(dir) ? dir : dir === "/" ? null : itemFor(dirOf(dir));
    itemOfDir.set(dir, found);
    return found;
  };

  // 2. Factory roots: a folder whose own folders include the resource folders, each holding JSON files.
  const resourceDirs = new Map<string, string[]>();
  for (const [d, names] of filesIn) {
    if (d === "/" || itemFor(d) || !FACTORY_BY_FOLDER.has(baseOf(d).toLowerCase())) continue;
    let json = false;
    for (const n of names) if (n.endsWith(".json")) (json = true);
    if (!json) continue;
    const root = dirOf(d);
    const list = resourceDirs.get(root);
    if (list) list.push(d);
    else resourceDirs.set(root, [d]);
  }
  const factoryDirs = new Map<string, { row: (typeof FACTORY_FOLDERS)[number]; synapse: boolean }>();
  for (const [root, dirs] of resourceDirs) {
    const rootFiles = filesIn.get(root);
    if (dirs.length < 2 && !FACTORY_ROOT_FILES.some((f) => rootFiles?.has(f))) continue;
    const rows = dirs.map((d) => FACTORY_BY_FOLDER.get(baseOf(d).toLowerCase())!);
    const synapse = rows.some((r) => r[3]) || !!rootFiles?.has(SYNAPSE_ROOT_FILE);
    dirs.forEach((d, i) => factoryDirs.set(d, { row: rows[i]!, synapse }));
  }

  // Folders holding a SQL project file: a folder between one of them and Tables, Views and the like is a schema.
  const projectDirs = new Set<string>();
  // The same test as the project's name below (a file named only ".sqlproj" is no project), so every project has one.
  for (const [d, names] of filesIn) for (const n of names) if (extOf(n) === "sqlproj") projectDirs.add(d);
  // RB-5: each project's name, from its project file (the first by name where a folder holds two).
  const projectNames = new Map<string, string>();
  for (const p of [...paths].sort()) if (extOf(baseOf(p)) === "sqlproj" && !projectNames.has(dirOf(p))) projectNames.set(dirOf(p), stem(baseOf(p)));
  const projectOf = (dir: string): string | null => (projectDirs.has(dir) ? dir : dir === "/" ? null : projectOf(dirOf(dir)));
  const underProject = (dir: string): boolean => projectOf(dir) !== null;
  /** RB-5: the database a folder is in: its item's folder, else its SQL project's. */
  const dbOf = (dir: string, item: string | null): string | null => item ?? projectOf(dir);
  // RB-5: each database's schemas, by the folders above its object folders (lower case), so a schema's own
  // definition in Security is known by its name.
  const schemasOf = new Map<string, Set<string>>();
  for (const d of filesIn.keys()) {
    if (!SQL_OBJECT_FOLDERS.some(([re]) => re.test(baseOf(d)))) continue;
    const above = dirOf(d);
    const db = dbOf(above, itemFor(above));
    if (!db || above === db || above === "/") continue;
    let set = schemasOf.get(db);
    if (!set) schemasOf.set(db, (set = new Set()));
    set.add(baseOf(above).toLowerCase());
  }
  /** Rules 3 and 4 for one file: a SQL object, script or project, or a notebook by its file type; else null. */
  const named = (p: string, item: string | null): Thing | null => {
    const dir = dirOf(p);
    const name = baseOf(p);
    const ext = extOf(name);
    if (ext === "sql") {
      const object = SQL_OBJECT_FOLDERS.find(([re]) => re.test(baseOf(dir)));
      if (!object) {
        // RB-5: inside a database, Security holds a schema's own definition (a file named as one of its schemas) and
        // its roles and users; the shared queries folder holds queries. Anything else is a script.
        const db = dbOf(dir, item);
        const inDb = db !== null && dirOf(dir) === db;
        const schema = inDb && SQL_SECURITY_FOLDER.test(baseOf(dir)) && schemasOf.get(db)?.has(stem(name).toLowerCase()) ? stem(name) : null;
        const sqlType: SqlType = schema ? "schema" : inDb && SQL_SECURITY_FOLDER.test(baseOf(dir)) ? "security" : inDb && SQL_SHARED_FOLDER.test(baseOf(dir)) ? "shared" : "script";
        return { kind: "script", name: stem(name), detail: SQL_TYPE_ONE.get(sqlType)!, folder: dir, file: p, sqlType, ...(schema ? { schema } : {}) };
      }
      // The schema, only where the path shows one (RB-4): the folder above, inside an item or under a SQL project and
      // not that item's or project's own folder. "/sql/Tables/x.sql" is a Table. A dot in the file's name says nothing
      // ("Orders.v2.sql").
      const above = dirOf(dir);
      const schema = above !== "/" && above !== item && !projectDirs.has(above) && (item || underProject(above)) ? baseOf(above) : null;
      const one = SQL_TYPE_ONE.get(object[1])!;
      return { kind: "script", name: stem(name), detail: schema ? `${one} in ${schema}` : one, folder: dir, file: p, sqlType: object[1], ...(schema ? { schema } : {}) };
    }
    if (ext === "sqlproj") return { kind: "script", name: stem(name), detail: "SQL project", folder: dir, file: p, sqlType: "project" };
    const notebook = NOTEBOOK_EXT[ext];
    return notebook ? { kind: "notebook", name: stem(name), detail: notebook, folder: dir, file: p } : null;
  };

  const items = new Map<string, string[]>();
  const out: Thing[] = [];
  /** RB-6: each SQL project's folder (outside an item) and the SQL things under it. */
  const projects = new Map<string, Thing[]>();
  const projectThings = new Set<Thing>();
  for (const p of paths) {
    const dir = dirOf(p);
    const item = itemFor(dir);
    if (item) {
      const list = items.get(item);
      if (list) list.push(p);
      else items.set(item, [p]);
      continue;
    }
    const name = baseOf(p);
    const factory = factoryDirs.get(dir);
    if (factory && extOf(name) === "json") {
      out.push({ kind: factory.row[1], name: stem(name), detail: `${factory.synapse ? "Synapse" : "Data factory"} ${factory.row[2]}`, folder: dir, file: p });
      continue;
    }
    const t = named(p, null);
    // RB-5: a SQL thing under a SQL project belongs to that database, named by its project file. RB-6: it is listed
    // inside the database, which is a thing of its own (below).
    const project = t?.sqlType ? projectOf(dir) : null;
    if (t && project) {
      const list = projects.get(project);
      if (list) list.push(t);
      else projects.set(project, [t]);
      continue;
    }
    out.push(t ?? { kind: "other", name, detail: otherLabel(name), folder: dir, file: p });
  }
  const rest: RepoFile[] = [];

  // RB-6: each SQL project outside an item is a database: it opens on its project file and holds its objects.
  for (const [dir, objects] of projects) {
    const name = projectNames.get(dir);
    const own = name === undefined ? undefined : [...objects].filter((t) => t.sqlType === "project" && t.name === name).sort((a, b) => (a.file < b.file ? -1 : 1))[0];
    // Never expected; if a project has no file of its own, its things are listed as they are rather than lost.
    if (name === undefined || !own) {
      out.push(...objects);
      continue;
    }
    const words = `${name} SQL project`;
    const file = own.file;
    const inner = objects.filter((t) => t.file !== file).map((t): Thing => ({ ...t, kind: "database", detail: `${t.detail} · ${words}`, item: words, itemKind: "database", db: dir, dbName: words }));
    inner.sort(byName);
    const db: Thing = { kind: "database", name, detail: `SQL project · ${objectCount(inner.length)}`, folder: dir, file, inside: insideOf(inner) };
    projectThings.add(db);
    out.push(db, ...inner);
  }

  for (const [dir, files] of items) {
    const folder = baseOf(dir);
    const inside = files.map((f) => f.slice(dir.length + 1));
    const dot = folder.lastIndexOf(".");
    let name = dot > 0 ? folder.slice(0, dot) : folder;
    let type = dot > 0 ? folder.slice(dot + 1) : "";
    if (!FABRIC_BY_TYPE.has(type.toLowerCase())) {
      // A folder renamed without its type, or with a dot of its own ("Sales v1.5"): a file inside may still say what
      // it is, and then the whole folder name is the name. Otherwise the part after the dot shows as it is written.
      for (const [re, t] of TYPE_BY_FILE) if (inside.some((f) => re.test(f.toLowerCase()))) { type = t; name = folder; break; }
    }
    name = unescapeName(name);
    const row = FABRIC_BY_TYPE.get(type.toLowerCase());
    const kind: Kind = row ? row[1] : "fabric";
    const label = row ? row[2] : type || "Fabric item";
    let open: string | undefined;
    for (const re of OPEN_FIRST) {
      const i = inside.findIndex((f) => re.test(f.toLowerCase()));
      if (i >= 0) { open = files[i]; break; }
    }
    const thing: Thing = { kind, name, detail: label, folder: dir, file: open ?? [...files].sort()[0]! };
    if (kind === "model") {
      const tables: ThingTable[] = [];
      inside.forEach((f, i) => {
        const m = TABLE_FILE.exec(f);
        if (m) tables.push({ name: unescapeName(m[1]!), file: files[i]! });
      });
      if (tables.length) {
        tables.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
        thing.tables = tables;
        thing.detail = `${label} · ${tables.length} table${tables.length === 1 ? "" : "s"}`;
      }
    }
    // RB-4: a file inside the item that would be a thing anywhere else is one here too (never the item's own
    // content file, like a notebook's notebook-content.sql), and every other file is kept by its path.
    const words = itemWords(name, label);
    const inner: Thing[] = [];
    const taken = new Set<string>([thing.file, ...(thing.tables ?? []).map((t) => t.file)]);
    inside.forEach((f, i) => {
      const p = files[i]!;
      if (taken.has(p)) return;
      const own = f.toLowerCase();
      const t = TYPE_BY_FILE.some(([re]) => re.test(own)) || OPEN_FIRST.some((re) => re.test(own)) ? null : named(p, dir);
      // RB-6: a database's objects are of its kind (Databases), so the kind filter finds them with it.
      if (t) inner.push({ ...t, ...(kind === "database" && t.sqlType ? { kind } : {}), detail: `${t.detail} · ${words}`, item: words, itemKind: kind, ...(t.sqlType ? { db: dir, dbName: words } : {}) });
      else rest.push({ file: p, kind, detail: `File in ${words}`, item: dir });
    });
    if (inner.length) {
      inner.sort(byName);
      thing.inside = insideOf(inner);
      if (!thing.tables) thing.detail = `${label} · ${kind === "database" ? objectCount(inner.length) : `${inner.length} inside`}`;
      out.push(...inner);
    }
    itemThings.add(thing);
    out.push(thing);
  }

  const order = new Map(KINDS.map((k, i) => [k, i]));
  rest.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { things: out.sort((a, b) => order.get(a.kind)! - order.get(b.kind)! || byName(a, b)), files: rest, itemThings, projectThings };
}

/**
 * RB-4: what each file of a repo is, for a list of files (Search inside files): its kind and a few words, by the same
 * rules. An item's own file is "File in <item>"; a model's table "Table in <model>"; anything else what the thing is.
 */
export function fileLabels(paths: readonly string[]): Map<string, { kind: Kind; detail: string; itemKind?: Kind }> {
  const sorted = sortAll(paths);
  const m = new Map<string, { kind: Kind; detail: string; itemKind?: Kind }>();
  for (const f of sorted.files) m.set(f.file, { kind: f.kind, detail: f.detail });
  for (const t of sorted.things) {
    m.set(t.file, { kind: t.kind, detail: sorted.itemThings.has(t) ? `File in ${itemWords(t.name, t.detail.split(" · ")[0]!)}` : sorted.projectThings.has(t) ? "SQL project" : t.detail, ...(t.itemKind ? { itemKind: t.itemKind } : {}) });
    for (const tb of t.tables ?? []) m.set(tb.file, { kind: t.kind, detail: `Table in ${t.name}` });
  }
  return m;
}

/** Things by group, in the groups' order; empty groups left out. */
export function groupThings<T extends { kind: Kind }>(things: readonly T[]): { kind: Kind; label: string; things: T[] }[] {
  const by = new Map<Kind, T[]>();
  for (const t of things) {
    const l = by.get(t.kind);
    if (l) l.push(t);
    else by.set(t.kind, [t]);
  }
  return KINDS.filter((k) => by.has(k)).map((k) => ({ kind: k, label: KIND_GROUPS[k], things: by.get(k)! }));
}

// ---------- RB-5: a database's SQL objects in folders ----------

export const SQL_GROUPINGS = ["schema", "type"] as const;
/** Schema: schema folders, each holding type folders. Type: type folders, each holding schema folders. */
export type SqlGrouping = (typeof SQL_GROUPINGS)[number];
export const NO_SCHEMA = "No schema";
/** What sqlTree needs of a SQL object: its name, its file, and the two facts its path gave. */
export type SqlObject = { name: string; file: string; sqlType?: SqlType; schema?: string };
/** The second level: a folder of objects, by name. */
export type SqlLeaf<T> = { key: string; label: string; count: number; objects: T[] };
/** The first level: a folder of folders. Its count is its objects in all of them. */
export type SqlFolder<T> = { key: string; label: string; count: number; folders: SqlLeaf<T>[] };
export type SqlTree<T> = { count: number; folders: SqlFolder<T>[] };

/**
 * A database's SQL objects as a two-level tree: by schema then type, or by type then schema. Types in SQL_TYPES'
 * order (a SQL thing with no type is a script), schemas by name ignoring case, "No schema" after them. Every object
 * is in exactly one folder, an empty folder never shows, and each count is the objects under it. From the facts the
 * paths gave: nothing here opens a file.
 */
export function sqlTree<T extends SqlObject>(objects: readonly T[], grouping: SqlGrouping): SqlTree<T> {
  const cmp = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
  const schemaKey = (o: T) => (o.schema ? `s:${o.schema.toLowerCase()}` : "s:");
  const typeKey = (o: T) => `t:${o.sqlType ?? "script"}`;
  // A schema spelled two ways ("Dim", "dim") is one folder, under the spelling that sorts first: a folder's
  // spelling before the name of a schema's own definition file.
  const spelled = new Map<string, string>();
  for (const own of [false, true])
    for (const o of objects) {
      if (!o.schema || (o.sqlType === "schema") !== own) continue;
      const k = schemaKey(o);
      if (own ? !spelled.has(k) : !spelled.has(k) || cmp(o.schema, spelled.get(k)!) < 0) spelled.set(k, o.schema);
    }
  const label = (key: string) => (key === "s:" ? NO_SCHEMA : key.startsWith("s:") ? spelled.get(key)! : sqlTypeLabel(key.slice(2) as SqlType));
  const order = (keys: string[]) =>
    keys.sort((a, b) => (a.startsWith("t:") ? SQL_TYPES.indexOf(a.slice(2) as SqlType) - SQL_TYPES.indexOf(b.slice(2) as SqlType) : a === "s:" ? 1 : b === "s:" ? -1 : cmp(label(a), label(b))));
  const [outer, inner] = grouping === "schema" ? [schemaKey, typeKey] : [typeKey, schemaKey];
  const by = new Map<string, Map<string, T[]>>();
  for (const o of objects) {
    let m = by.get(outer(o));
    if (!m) by.set(outer(o), (m = new Map()));
    const l = m.get(inner(o));
    if (l) l.push(o);
    else m.set(inner(o), [o]);
  }
  const folders = order([...by.keys()]).map((k): SqlFolder<T> => {
    const m = by.get(k)!;
    const leaves = order([...m.keys()]).map((k2): SqlLeaf<T> => {
      const list = [...m.get(k2)!].sort((a, b) => cmp(a.name, b.name) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
      return { key: `${k}/${k2}`, label: label(k2), count: list.length, objects: list };
    });
    return { key: k, label: label(k), count: leaves.reduce((n, f) => n + f.count, 0), folders: leaves };
  });
  return { count: folders.reduce((n, f) => n + f.count, 0), folders };
}

/** RB-4: one file a search inside files found: where it is, what it is by its name, and how many matches DevOps counted. */
export type InsideFile = { repoId: string; repoName: string; path: string; kind: Kind; detail: string; matches: number | null; /** For a file inside an item, the item's kind. */ itemKind?: Kind; /** RB-7: the branch it was found on, when it isn't the repo's opening branch (the result opens on it). */ branch?: string };
/** RB-7: a repo whose branch on screen DevOps doesn't search: its results are the default branch's. */
export type InsideNotSearched = { repoId: string; repoName: string; branch: string; shown: string };
/** RB-4: one client's answer to a search inside files. */
export type InsideAnswer = { files: InsideFile[]; /** How many files DevOps counted in all. */ total: number; /** DevOps has more files than the ones here. */ more: boolean; /** DevOps is still indexing: results may be missing. */ indexing: boolean; /** DevOps was asked to narrow to the kind's file type. */ narrowed: boolean; /** Files DevOps found that aren't on their repo's branch (RB-7; its default branch before), or in a repo that isn't read: not listed. */ notListed: number; /** RB-7: the repos shown from their default branch because DevOps doesn't search the branch on screen. */ notSearched?: InsideNotSearched[] };

/**
 * RB-4: a kind DevOps's code search can narrow by itself, by file type (its documented "ext:" filter). Only where the
 * type says the kind well enough; the other kinds are narrowed in FocusTime after the answer. One row per kind.
 */
// RB-6: SQL scripts and Databases (whose objects are .sql files) narrow by .sql, as RB-4's one SQL kind did.
export const KIND_EXT: Readonly<Partial<Record<Kind, string>>> = { database: "sql", script: "sql" };

/**
 * RB-4: the plain words of a search inside files, to mark in a file once it is opened: phrases in quotes and words
 * (a * at the end of a word matches the start of a word), without the operators (AND, OR, NOT, NEAR, BEFORE, AFTER),
 * the term a NOT rules out, and filters like ext:sql. Lower case, at most 12.
 */
export function insideTerms(q: string): { text: string; prefix: boolean }[] {
  const out: { text: string; prefix: boolean }[] = [];
  // After NOT: the next term is ruled out, or the whole bracket when one opens right after it.
  let not = false;
  let depth = 0;
  let notDepth: number | null = null;
  // A filter with its value (ext:sql, path:"a b"), a phrase in quotes, a bracket, a word, or a quote left open.
  for (const m of q.matchAll(/[A-Za-z]+:(?:"[^"]*"|\S+)|"((?:[^"\\]|\\.)*)"|[()]|[^\s()"]+|"/g)) {
    const phrase = m[1];
    const raw = m[0];
    if (raw === "(") {
      depth++;
      if (not) (notDepth = depth), (not = false);
      continue;
    }
    if (raw === ")") {
      if (notDepth === depth) notDepth = null;
      depth = Math.max(0, depth - 1);
      continue;
    }
    const skip = not || notDepth !== null;
    not = false;
    if (phrase === undefined) {
      if (raw === "NOT") { not = true; continue; }
      if (raw === '"' || ["AND", "OR", "NEAR", "BEFORE", "AFTER"].includes(raw)) continue;
      // A filter (ext:sql, path:"a b", file:x*) narrows where to look; it isn't a word in the file.
      if (/^[A-Za-z]+:/.test(raw)) continue;
    }
    if (skip) continue;
    const prefix = phrase === undefined && raw.endsWith("*");
    const text = (phrase !== undefined ? phrase.replace(/\\(.)/g, "$1") : raw.replace(/[*?]+$/, "")).toLowerCase();
    if (text && !/[*?]/.test(phrase === undefined ? text : "") && !out.some((t) => t.text === text)) out.push({ text, prefix });
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * RB-4: where the terms are in one line of an opened file, ignoring case: [start, end) pairs, merged, in order. A
 * term is whole words, as code search matches them ("id" isn't in "valid"); one with a * at its end may start a longer
 * word. `anywhere` drops the word edges, for a file where nothing matched as whole words.
 */
export function termRanges(line: string, terms: readonly { text: string; prefix?: boolean }[], anywhere = false): [number, number][] {
  const lower = line.toLowerCase();
  if (lower.length !== line.length) return [];
  const found: [number, number][] = [];
  for (const t of terms) {
    // A term is its words in a row with anything but a letter, a digit or an underscore between them, so "dbo.Orders"
    // is found in "[dbo].[Orders]" and a phrase across its punctuation.
    const parts = t.text.split(/[^a-z0-9_]+/).filter(Boolean);
    if (!parts.length) continue;
    const body = parts.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9_]+");
    const re = new RegExp(anywhere ? body : `(?<![a-z0-9_])${body}${t.prefix ? "[a-z0-9_]*" : "(?![a-z0-9_])"}`, "g");
    for (let m = re.exec(lower); m; m = re.exec(lower)) {
      found.push([m.index, m.index + m[0].length]);
      if (!m[0].length) re.lastIndex++;
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of found) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// ---------- searching names ----------

/** The words of a search: lower case, split on spaces, at most 8. */
export const searchWords = (q: string): string[] => q.toLowerCase().split(/\s+/).map((w) => w.replace(/\*+$/, "")).filter(Boolean).slice(0, 8);

/** One search result: a thing, one table of a semantic model, or (RB-4) a file found by its own name. */
export type NameHit = { kind: Kind; name: string; detail: string; file: string; table: boolean; /** Listed under Files, after the named things. */ asFile: boolean };

/**
 * Things whose name, file name or folder names hold every word, in any order, ignoring case. A model's table is a
 * result of its own when its own name matches (its model's folder doesn't make every table a match). Results whose
 * name matches come before those found only by a folder's name. RB-4: last, any other file whose own name matches
 * (`files`, the files inside items), so nothing the tree shows is missed. Names only: nothing here ever sees a
 * file's content.
 */
export function searchThings(things: readonly Thing[], q: string, kind: Kind | null = null, files: readonly RepoFile[] = [], /** UC-2: with Databases as the kind, one object type only. */ sqlType: SqlType | null = null): NameHit[] {
  // UC-2: a type under Databases narrows to that type's objects: no model tables, no other files.
  const typed = kind === "database" && sqlType ? sqlType : null;
  const words = searchWords(q);
  if (!words.length) return [];
  const has = (text: string) => {
    const t = text.toLowerCase();
    return words.every((w) => t.includes(w));
  };
  const byName: NameHit[] = [];
  const byFolder: NameHit[] = [];
  // A path typed with its slashes is looked for in the whole path; else a table or a file inside an item is found by
  // the folders inside its item, never by the item's own folder (which would make everything in it a match).
  const slashy = words.some((w) => w.includes("/"));
  for (const t of things) {
    // A thing inside an item passes its own kind's filter and its item's (RB-6: a warehouse's table is found under
    // Databases, its item's group and its own).
    if (kind && t.kind !== kind && t.itemKind !== kind) continue;
    if (typed && t.sqlType !== typed) continue;
    // A SQL object is found as schema.name too ("dim.Store", "[dim].[Store]").
    const alias = t.schema ? ` ${t.schema}.${t.name} [${t.schema}].[${t.name}]` : "";
    if (has(`${t.name} ${t.file}${alias}`)) (has(`${t.name} ${baseOf(t.file)}${alias}`) ? byName : byFolder).push({ kind: t.kind, name: t.name, detail: t.item ? t.detail : t.detail.split(" · ")[0]!, file: t.file, table: false, asFile: false });
    for (const tb of typed ? [] : (t.tables ?? [])) {
      const hit = has(`${tb.name} ${baseOf(tb.file)}`) ? byName : has(`${tb.name} ${slashy ? tb.file : tb.file.slice(t.folder.length)}`) ? byFolder : null;
      hit?.push({ kind: t.kind, name: tb.name, detail: `Table in ${t.name}`, file: tb.file, table: true, asFile: false });
    }
  }
  const byFile: NameHit[] = [];
  const byFileFolder: NameHit[] = [];
  for (const f of typed ? [] : files) {
    if (kind && f.kind !== kind) continue;
    const hit = has(baseOf(f.file)) ? byFile : has(slashy ? f.file : f.file.slice(f.item.length)) ? byFileFolder : null;
    hit?.push({ kind: f.kind, name: baseOf(f.file), detail: f.detail, file: f.file, table: false, asFile: true });
  }
  return [...byName, ...byFolder, ...byFile, ...byFileFolder];
}

/**
 * How many results each client shows when all of them together are over the limit: in order, each as many as are
 * left. A client with matches and none shown still says how many it has.
 */
export function shareCap(counts: readonly number[], max: number): number[] {
  let left = max;
  return counts.map((n) => {
    const take = Math.min(n, left);
    left -= take;
    return take;
  });
}

/** A path cut into pieces, the parts a word matched marked. */
export function markMatches(text: string, q: string): { text: string; hit: boolean }[] {
  const words = searchWords(q);
  const lower = text.toLowerCase();
  // A few letters change length in lower case; then nothing is marked (the result still shows).
  if (lower.length !== text.length) return text ? [{ text, hit: false }] : [];
  const on = new Array<boolean>(text.length).fill(false);
  for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) on.fill(true, i, i + w.length);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; ) {
    let j = i;
    while (j < text.length && on[j] === on[i]) j++;
    out.push({ text: text.slice(i, j), hit: on[i]! });
    i = j;
  }
  return out;
}
