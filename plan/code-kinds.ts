// RB-2: a repo's things by kind, from its file paths and nothing else. Pure: no I/O, and no file is ever opened to
// decide anything here. The rules are the tables below, built from the documentation as it stood on Nov 14 (the links
// are in docs/decisions.md under RB-2); adding a kind or a type's label is one row. No client's, repo's or folder's
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
// inside an item, under a SQL project, or in a two-part file name (dbo.Orders.sql).
import { languageOf, LANG_NAMES } from "./code-languages.ts";
import type { CodeRepoView } from "./code.ts";

export const KINDS = ["report", "model", "pipeline", "notebook", "dataflow", "lake", "sql", "fabric", "other"] as const;
export type Kind = (typeof KINDS)[number];
/** The groups, in the order they show. A group with nothing in it doesn't show. */
export const KIND_GROUPS: Readonly<Record<Kind, string>> = {
  report: "Reports",
  model: "Semantic models",
  pipeline: "Pipelines",
  notebook: "Notebooks",
  dataflow: "Dataflows",
  lake: "Lakehouses and warehouses",
  sql: "SQL",
  fabric: "Other Fabric items",
  other: "Other",
};

export type ThingTable = { name: string; file: string };
/** RB-4: something inside an item that is a thing of its own (a warehouse's table): what By kind opens the item to. */
export type ThingInside = { name: string; file: string; kind: Kind; detail: string };
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
  /** RB-4: for a thing inside an item, the item in words ("Sales warehouse"). */
  item?: string;
};
/** RB-4: a file inside an item that is no thing of its own: found only by its own name, under Files. */
export type RepoFile = { file: string; kind: Kind; detail: string };

/** One repo of a client as By kind and Search names get it: its things, or one line saying why there are none. */
export type RepoThings = { repo: CodeRepoView; things: Thing[]; /** RB-4: the files inside items that are no thing of their own. */ files: RepoFile[]; cut: boolean; problem: string | null };

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
  ["Warehouse", "lake", "Warehouse"],
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
  ["SQLDatabase", "fabric", "SQL database"],
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
  ["sqlscript", "sql", "SQL script", true],
  ["kqlscript", "other", "KQL script", true],
  ["sparkJobDefinition", "other", "Spark job definition", true],
];
const FACTORY_BY_FOLDER = new Map(FACTORY_FOLDERS.map((r) => [r[0].toLowerCase(), r]));
/** Files the documentation puts in the root folder; one of them beside a single resource folder is enough. */
const FACTORY_ROOT_FILES = ["publish_config.json", "arm-template-parameters-definition.json", "template-parameters-definition.json"];
const SYNAPSE_ROOT_FILE = "template-parameters-definition.json";

// ---------- 3. SQL ----------

/** The usual object folders of a SQL project (a habit, not a rule of the format): the folder above is the schema. */
const SQL_OBJECT_FOLDERS: readonly (readonly [folder: RegExp, label: string])[] = [
  [/^tables?$/i, "Table"],
  [/^views?$/i, "View"],
  [/^(stored ?procedures?|procedures?|sprocs?)$/i, "Stored procedure"],
  [/^functions?$/i, "Function"],
];

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

function sortAll(paths: readonly string[]): RepoSort & { itemThings: Set<Thing> } {
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
  for (const [d, names] of filesIn) for (const n of names) if (n.endsWith(".sqlproj")) projectDirs.add(d);
  const underProject = (dir: string): boolean => projectDirs.has(dir) || (dir !== "/" && underProject(dirOf(dir)));
  /** Rules 3 and 4 for one file: a SQL object, script or project, or a notebook by its file type; else null. */
  const named = (p: string, item: string | null): Thing | null => {
    const dir = dirOf(p);
    const name = baseOf(p);
    const ext = extOf(name);
    if (ext === "sql") {
      const object = SQL_OBJECT_FOLDERS.find(([re]) => re.test(baseOf(dir)));
      if (!object) return { kind: "sql", name: stem(name), detail: "SQL script", folder: dir, file: p };
      // The schema, only where the path shows one (RB-4): the folder above, inside an item or under a SQL project and
      // not that item's or project's own folder; else the first part of a two-part name. "/sql/Tables/x.sql" is a Table.
      const above = dirOf(dir);
      const two = /^([A-Za-z_][\w ]*)\.[^.]+$/.exec(stem(name));
      const schema = above !== "/" && above !== item && !projectDirs.has(above) && (item || underProject(above)) ? baseOf(above) : two ? two[1]! : null;
      return { kind: "sql", name: stem(name), detail: schema ? `${object[1]} in ${schema}` : object[1], folder: dir, file: p };
    }
    if (ext === "sqlproj") return { kind: "sql", name: stem(name), detail: "SQL project", folder: dir, file: p };
    const notebook = NOTEBOOK_EXT[ext];
    return notebook ? { kind: "notebook", name: stem(name), detail: notebook, folder: dir, file: p } : null;
  };

  const items = new Map<string, string[]>();
  const out: Thing[] = [];
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
    out.push(named(p, null) ?? { kind: "other", name, detail: otherLabel(name), folder: dir, file: p });
  }
  const rest: RepoFile[] = [];

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
      if (t) inner.push({ ...t, detail: `${t.detail} · ${words}`, item: words });
      else rest.push({ file: p, kind, detail: `File in ${words}` });
    });
    if (inner.length) {
      inner.sort(byName);
      thing.inside = inner.map((t) => ({ name: t.name, file: t.file, kind: t.kind, detail: t.detail.split(" · ")[0]! }));
      if (!thing.tables) thing.detail = `${label} · ${inner.length} inside`;
      out.push(...inner);
    }
    itemThings.add(thing);
    out.push(thing);
  }

  const order = new Map(KINDS.map((k, i) => [k, i]));
  rest.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { things: out.sort((a, b) => order.get(a.kind)! - order.get(b.kind)! || byName(a, b)), files: rest, itemThings };
}

/**
 * RB-4: what each file of a repo is, for a list of files (Search inside files): its kind and a few words, by the same
 * rules. An item's own file is "File in <item>"; a model's table "Table in <model>"; anything else what the thing is.
 */
export function fileLabels(paths: readonly string[]): Map<string, { kind: Kind; detail: string }> {
  const sorted = sortAll(paths);
  const m = new Map<string, { kind: Kind; detail: string }>();
  for (const f of sorted.files) m.set(f.file, { kind: f.kind, detail: f.detail });
  for (const t of sorted.things) {
    m.set(t.file, { kind: t.kind, detail: sorted.itemThings.has(t) ? `File in ${itemWords(t.name, t.detail.split(" · ")[0]!)}` : t.detail });
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

// ---------- searching names ----------

/** The words of a search: lower case, split on spaces, at most 8. */
export const searchWords = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);

/** One search result: a thing, one table of a semantic model, or (RB-4) a file found by its own name. */
export type NameHit = { kind: Kind; name: string; detail: string; file: string; table: boolean; /** Listed under Files, after the named things. */ asFile: boolean };

/**
 * Things whose name, file name or folder names hold every word, in any order, ignoring case. A model's table is a
 * result of its own when its own name matches (its model's folder doesn't make every table a match). Results whose
 * name matches come before those found only by a folder's name. RB-4: last, any other file whose own name matches
 * (`files`, the files inside items), so nothing the tree shows is missed. Names only: nothing here ever sees a
 * file's content.
 */
export function searchThings(things: readonly Thing[], q: string, kind: Kind | null = null, files: readonly RepoFile[] = []): NameHit[] {
  const words = searchWords(q);
  if (!words.length) return [];
  const has = (text: string) => {
    const t = text.toLowerCase();
    return words.every((w) => t.includes(w));
  };
  const byName: NameHit[] = [];
  const byFolder: NameHit[] = [];
  for (const t of things) {
    if (kind && t.kind !== kind) continue;
    if (has(`${t.name} ${t.file}`)) (has(`${t.name} ${baseOf(t.file)}`) ? byName : byFolder).push({ kind: t.kind, name: t.name, detail: t.item ? t.detail : t.detail.split(" · ")[0]!, file: t.file, table: false, asFile: false });
    for (const tb of t.tables ?? []) if (has(`${tb.name} ${baseOf(tb.file)}`)) byName.push({ kind: t.kind, name: tb.name, detail: `Table in ${t.name}`, file: tb.file, table: true, asFile: false });
  }
  const byFile: NameHit[] = [];
  for (const f of files) if ((!kind || f.kind === kind) && has(baseOf(f.file))) byFile.push({ kind: f.kind, name: baseOf(f.file), detail: f.detail, file: f.file, table: false, asFile: true });
  return [...byName, ...byFolder, ...byFile];
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
