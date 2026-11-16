// RB-3: "Where is it?" offers the client's real things as you type. Pure: no I/O. From one client's names as By kind
// reads them (code.kinds, plan/code-kinds.ts), this builds what the box can offer, matches the word at the cursor,
// and writes a pick as plain words. Nothing here is kept: the list lives in the form's memory while it is open, and a
// pick is only text in the box ("dim.Customer (table, Gold warehouse)"). The second level (a report's pages, a model
// table's measures and columns) is read from one file when asked for, by the two parsers at the end.
//
// Offered: reports, semantic models and their tables, pipelines, notebooks, dataflows, lakehouses, databases and their
// tables, views, procedures and functions, and SQL scripts. Not offered: Other Fabric items, Other, files inside items
// that are no thing of their own, and a database's schemas, security objects, shared queries and project file.
import { groupThings, KIND_GROUPS, sqlTree, type Kind, type RepoSort, type RepoThings, type SqlType, type Thing, type SqlFolder } from "./code-kinds.ts";
import { ANSWER_MAX } from "./three-questions.ts";

/** Where the lookup is used: the Code log names it (actions/code-actions.ts, plan/code.ts). */
export const WHERE_FROM = ["new_form", "draft_editor"] as const;
export type WhereFrom = (typeof WHERE_FROM)[number];

/** The kinds offered, in By kind's order. */
export const WHERE_KINDS: readonly Kind[] = ["report", "model", "pipeline", "notebook", "dataflow", "lake", "database", "script"];
/** A database's objects offered (a SQL file in no object folder is a script). */
const WHERE_SQL: readonly SqlType[] = ["table", "view", "procedure", "function", "script"];
/** The list shows this many matches; one line says how many more. */
export const WHERE_SHOWN = 8;
/** A word is matched from this many characters (names that start with it). */
export const WHERE_MIN = 2;
/** From this many, a name that holds the word anywhere matches too (two letters inside names match nearly everything). */
export const WHERE_HOLDS = 4;

/** What a second level is: a report's pages, or a model table's measures and columns. */
export type WhereMore = "pages" | "fields";

/** One thing the box can offer. */
export type WhereEntry = {
  /** Unique in one client's list: the repo and the file (a model's table: its file). */
  id: string;
  kind: Kind;
  /** The name as it is in the repo; a SQL object with a schema as schema.name. */
  name: string;
  /** The name alone (a SQL object's without its schema), also matched from its start. */
  bare: string;
  /** What it is, in a few words, as the pick writes it: "table", "report", "data factory pipeline". */
  what: string;
  /** What it is in, as the pick writes it ("Gold warehouse", "Sales semantic model"), or null. */
  within: string | null;
  /** A thing inside another (a database's table, a model's table): after the things themselves when both match. */
  inside: boolean;
  /** The entry it is inside, for browsing. */
  parent: string | null;
  repoId: string;
  repoName: string;
  /** The file it is, for the second level only. Never written into the box. */
  file: string;
  /** Its second level, where the layout keeps it in one file. */
  more: WhereMore | null;
  sqlType?: SqlType;
  schema?: string;
};

/** A first letter in lower case when the words start as a plain word ("Table" → "table", "SQL script" stays). */
const plain = (s: string): string => (/^[A-Z][a-z]/.test(s) && !/^Synapse\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const first = (detail: string): string => detail.split(" · ")[0]!.replace(/ in [^ ]+$/, "");
/** "Sales" and "Semantic model" → "Sales semantic model". */
const words = (name: string, label: string): string => `${name} ${plain(label)}`;

/**
 * A legacy report keeps its pages in one report.json beside its definition.pbir (PBIR-Legacy). The newer PBIR layout
 * keeps one page.json per page under definition/pages (its definition/report.json holds no pages), so it isn't offered.
 */
const legacyReport = (t: Thing): boolean => t.kind === "report" && /\/report\.json$/i.test(t.file) && !/\/definition\/report\.json$/i.test(t.file) && t.detail.startsWith("Report");
/** A model table kept in its own TMDL file (definition/tables/<table>.tmdl). */
const tmdlTable = (file: string): boolean => /\/definition\/tables\/[^/]+\.tmdl$/i.test(file);

/** Whether a thing is offered: an offered kind, and of a database's objects only tables, views, procedures, functions and scripts. */
const offered = (t: Thing): boolean => WHERE_KINDS.includes(t.kind) && (!t.sqlType || WHERE_SQL.includes(t.sqlType));

/** RB-3: what code.kinds returns for the box: only the things it offers, and no file inside an item. */
export function whereOnly(r: RepoSort): RepoSort {
  const things = r.things.filter(offered);
  const kept = new Set(things.map((t) => t.file));
  return { things: things.map((t) => (t.inside ? { ...t, inside: t.inside.filter((i) => kept.has(i.file)) } : t)), files: [] };
}

/** Everything one client's names offer, in By kind's order, things before the things inside them. */
export function whereEntries(repos: readonly RepoThings[]): WhereEntry[] {
  const out: WhereEntry[] = [];
  for (const r of repos) {
    const id = (file: string) => `${r.repo.id}|${file}`;
    // The things inside an item, by their file: which entry they sit in.
    const parentOf = new Map<string, string>();
    for (const t of r.things) if (!t.item) for (const i of t.inside ?? []) parentOf.set(i.file, id(t.file));
    for (const t of r.things) {
      if (!offered(t)) continue;
      const inside = !!t.item;
      const label = first(t.detail);
      const named = t.schema ? `${t.schema}.${t.name}` : t.name;
      const e: WhereEntry = {
        id: id(t.file),
        kind: t.kind,
        name: named,
        bare: t.name,
        what: t.sqlType && t.sqlType !== "script" ? plain(label) : t.sqlType === "script" ? "SQL script" : plain(label),
        within: inside ? (t.dbName ?? t.item ?? null) : null,
        inside,
        parent: inside ? (parentOf.get(t.file) ?? null) : null,
        repoId: r.repo.id,
        repoName: r.repo.name,
        file: t.file,
        more: legacyReport(t) ? "pages" : null,
        ...(t.sqlType ? { sqlType: t.sqlType } : {}),
        ...(t.schema ? { schema: t.schema } : {}),
      };
      out.push(e);
      for (const tb of t.tables ?? [])
        out.push({ id: id(tb.file), kind: t.kind, name: tb.name, bare: tb.name, what: "table", within: words(t.name, label), inside: true, parent: e.id, repoId: r.repo.id, repoName: r.repo.name, file: tb.file, more: tmdlTable(tb.file) ? "fields" : null });
    }
  }
  return out;
}

/** The words a pick writes: "dim.Customer (table, Gold warehouse)", "Sales (report)". */
export const writtenOf = (e: Pick<WhereEntry, "name" | "what" | "within">): string => (e.within ? `${e.name} (${e.what}, ${e.within})` : `${e.name} (${e.what})`);

/** What a row says under its name: "Table · Gold warehouse". */
export const lineOf = (e: Pick<WhereEntry, "what" | "within">): string => {
  const w = e.what[0]!.toUpperCase() + e.what.slice(1);
  return e.within ? `${w} · ${e.within}` : w;
};

// ---------- the word at the cursor ----------

/** What ends a word: spaces and the punctuation that sits between names in a sentence. */
const EDGE = /[\s,;()"]/;

/** The word the cursor is in or at the end of: [start, end) and its text. */
export function wordAt(text: string, cursor: number): { start: number; end: number; word: string } {
  const c = Math.max(0, Math.min(cursor, text.length));
  let start = c;
  while (start > 0 && !EDGE.test(text[start - 1]!)) start--;
  let end = c;
  while (end < text.length && !EDGE.test(text[end]!)) end++;
  return { start, end, word: text.slice(start, c) };
}

/**
 * The box's text with a pick written in place of the word at the cursor (or at the cursor: from browsing, or with no
 * word there), and
 * where the cursor goes: right after the pick. A space keeps it apart from a word right before or after it. Null when
 * the answer would be longer than an answer may be.
 */
export function withPick(text: string, cursor: number, pick: string, replace = true, from?: number): { text: string; cursor: number } | null {
  const w = replace ? wordAt(text, cursor) : { start: cursor, end: cursor, word: "" };
  // `from`: where a phrase being typed starts ("load sa" is replaced whole by "Load sales (pipeline)").
  const [start, end] = w.word ? [from !== undefined && from < w.start ? from : w.start, w.end] : [cursor, cursor];
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) && !w.word ? " " : "";
  const tail = after && !/^[\s,;.)]/.test(after) ? " " : "";
  const next = `${before}${lead}${pick}${tail}${after}`;
  if (next.length > ANSWER_MAX) return null;
  return { text: next, cursor: before.length + lead.length + pick.length + tail.length };
}

// ---------- matching ----------

/**
 * The matches for one word, best first: a name that starts with it, then (from three characters) one that holds it;
 * the things themselves before the things inside them; then by name, then in By kind's order. Null when the word is
 * too short to match.
 */
/**
 * What typing one character right after a pick writes: a letter or digit gets a space before it, so the next word
 * doesn't run into the pick ("(pipeline) fails", not "(pipeline)fails"); a comma, a full stop or a space goes in as typed.
 */
export function afterPick(before: string, typed: string, at: number): { text: string; cursor: number } | null {
  if (typed.length !== before.length + 1 || at < 1) return null;
  const ch = typed[at - 1]!;
  if (typed.slice(0, at - 1) + typed.slice(at) !== before || !/[\p{L}\p{N}]/u.test(ch)) return null;
  return { text: `${typed.slice(0, at - 1)} ${typed.slice(at - 1)}`, cursor: at + 1 };
}

/** Names written the way people type them: "dim.Store" and "pl_customer_load" as "dim store" and "pl customer load". */
const spaced = (s: string) => s.toLowerCase().replace(/[._\-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The matches for what is typed before the cursor, trying the last three words and then the last two as one phrase
 * before the last word alone: "load sales" is the Load sales pipeline, "Sales report" the Sales report (a kind's word
 * last), "gold store" a Store in the Gold warehouse (where it is first), "dim store" dim.Store. A phrase is used only
 * when something matches it; `start` is where the words a pick replaces begin.
 */
export function suggestAt(entries: readonly WhereEntry[], text: string, cursor: number, max = WHERE_SHOWN): { shown: WhereEntry[]; total: number; start: number; typed: string } | null {
  const w = wordAt(text, cursor);
  if (w.word.trim().length < 1) return null;
  for (const k of [3, 2]) {
    // Words joined by single spaces only: a comma, a bracket or a new line ends a phrase.
    const m = new RegExp(`(?:^|[\\s,;()"])((?:[^\\s,;()"]+ ){${k - 1}}[^\\s,;()"]+)$`).exec(text.slice(0, w.start + w.word.length));
    if (!m) continue;
    const phrase = m[1]!;
    const words = spaced(phrase).split(" ");
    if (words.length !== k) continue;
    const last = words[k - 1]!;
    const rest = words.slice(0, -1).join(" ");
    const all = words.join(" ");
    const hits: { e: WhereEntry; rank: number }[] = [];
    for (const e of entries) {
      const n = spaced(e.name);
      const b = spaced(e.bare);
      const within = e.within ? spaced(e.within) : "";
      const kindWord = last.length >= 3 && spaced(e.what).split(" ").some((x) => x.startsWith(last));
      if (n.startsWith(all) || b.startsWith(all)) hits.push({ e, rank: 0 });
      else if (kindWord && (n === rest || b === rest)) hits.push({ e, rank: 1 });
      else if (kindWord && (n.startsWith(rest) || b.startsWith(rest))) hits.push({ e, rank: 2 });
      else if (within && within.startsWith(rest) && b.startsWith(last)) hits.push({ e, rank: 3 });
    }
    if (!hits.length) continue;
    const kind = (e: WhereEntry) => WHERE_KINDS.indexOf(e.kind);
    hits.sort((a, b) => a.rank - b.rank || Number(a.e.inside) - Number(b.e.inside) || a.e.name.localeCompare(b.e.name, "en", { sensitivity: "base" }) || kind(a.e) - kind(b.e) || (a.e.id < b.e.id ? -1 : 1));
    return { shown: hits.slice(0, max).map((h) => h.e), total: hits.length, start: w.start + w.word.length - phrase.length, typed: phrase };
  }
  const one = suggest(entries, w.word, max);
  return one && { ...one, start: w.start, typed: w.word };
}

export function suggest(entries: readonly WhereEntry[], word: string, max = WHERE_SHOWN): { shown: WhereEntry[]; total: number } | null {
  const w = word.trim().toLowerCase();
  if (w.length < WHERE_MIN) return null;
  const hits: { e: WhereEntry; rank: number }[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    const b = e.bare.toLowerCase();
    if (n.startsWith(w) || b.startsWith(w)) hits.push({ e, rank: 0 });
    else if (w.length >= WHERE_HOLDS && n.includes(w)) hits.push({ e, rank: 1 });
  }
  const kind = (e: WhereEntry) => WHERE_KINDS.indexOf(e.kind);
  hits.sort((a, b) => a.rank - b.rank || Number(a.e.inside) - Number(b.e.inside) || a.e.name.localeCompare(b.e.name, "en", { sensitivity: "base" }) || kind(a.e) - kind(b.e) || (a.e.id < b.e.id ? -1 : 1));
  return { shown: hits.slice(0, max).map((h) => h.e), total: hits.length };
}

// ---------- browsing by kind ----------

/** One row while browsing: a thing to pick (and maybe open), or a folder to open. */
export type BrowseRow = { type: "entry"; entry: WhereEntry; opens: boolean } | { type: "folder"; key: string; label: string; count: number };
/** One level while browsing: its rows, in groups with a heading where the level has them. */
export type BrowseLevel = { title: string | null; groups: { label: string | null; rows: BrowseRow[] }[] };

/** What a database's objects are, for its schema and type folders. */
const dbObjects = (entries: readonly WhereEntry[], db: string) => entries.filter((e) => e.parent === db).map((e) => ({ ...e, name: e.bare, file: e.id, entry: e }));

/** Whether an entry opens while browsing: a model to its tables, a database to its schemas, an item to what's inside. */
export const opensTo = (entries: readonly WhereEntry[], e: WhereEntry): boolean => e.more !== null || entries.some((x) => x.parent === e.id);

/**
 * A level of the browse list. The top: the things by kind, as Code's By kind lists them (each once; what is inside a
 * thing only inside it). `at` names a deeper level: an entry's id (a model's tables, an item's things, a database's
 * schemas), or a database's folder ("<db id>\u0000<folder key>": a schema, then its types).
 */
export function browseLevel(entries: readonly WhereEntry[], at: string | null): BrowseLevel {
  const parents = new Set(entries.map((e) => e.parent));
  const row = (e: WhereEntry): BrowseRow => ({ type: "entry", entry: e, opens: e.more !== null || parents.has(e.id) });
  if (at === null) return { title: null, groups: groupThings(entries.filter((e) => !e.inside)).map((g) => ({ label: g.label, rows: g.things.map(row) })) };
  const [id, folder] = at.split("\u0000") as [string, string | undefined];
  const owner = entries.find((e) => e.id === id);
  if (!owner) return { title: null, groups: [] };
  if (owner.kind === "database") {
    const tree = sqlTree(dbObjects(entries, id), "schema");
    if (folder === undefined) return { title: owner.name, groups: [{ label: null, rows: tree.folders.map((f) => ({ type: "folder", key: `${id}\u0000${f.key}`, label: f.label, count: f.count })) }] };
    const f = tree.folders.find((x) => x.key === folder.split("/")[0]) as SqlFolder<ReturnType<typeof dbObjects>[number]> | undefined;
    if (!f) return { title: owner.name, groups: [] };
    if (!folder.includes("/")) return { title: `${owner.name} › ${f.label}`, groups: [{ label: null, rows: f.folders.map((l) => ({ type: "folder", key: `${id}\u0000${l.key}`, label: l.label, count: l.count })) }] };
    const leaf = f.folders.find((l) => l.key === folder);
    return { title: `${owner.name} › ${f.label} › ${leaf?.label ?? ""}`, groups: [{ label: null, rows: (leaf?.objects ?? []).map((o) => row(o.entry)) }] };
  }
  return { title: owner.name, groups: [{ label: null, rows: entries.filter((e) => e.parent === id).map(row) }] };
}

/** The heading of a kind's group while browsing ("Reports"). */
export const groupLabel = (k: Kind): string => KIND_GROUPS[k];

// ---------- the second level, read from one file ----------

/** One page, measure or column, with the words a pick writes. */
export type WhereInner = { id: string; name: string; what: "page" | "measure" | "column"; written: string; line: string };

/**
 * A legacy report's pages from its report.json: each section's display name, in the file's order (by its ordinal
 * where every section has one). Null when the text isn't a report.json with sections.
 */
export function reportPages(text: string): string[] | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const sections = v && typeof v === "object" && !Array.isArray(v) ? (v as { sections?: unknown }).sections : undefined;
  if (!Array.isArray(sections)) return null;
  const pages = sections
    .map((s, i) => {
      const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
      const name = typeof o.displayName === "string" && o.displayName.trim() ? o.displayName.trim() : typeof o.name === "string" ? o.name : "";
      return { name, at: typeof o.ordinal === "number" ? o.ordinal : null, i };
    })
    .filter((p) => p.name);
  if (pages.every((p) => p.at !== null)) pages.sort((a, b) => a.at! - b.at! || a.i - b.i);
  return pages.map((p) => p.name);
}

/**
 * A model table's measures and columns from its TMDL file: each "measure" and "column" declared one level inside the
 * table, with its name unquoted ('Total Sales' → Total Sales). Null when the text declares no table.
 */
export function tmdlFields(text: string): { name: string; what: "measure" | "column" }[] | null {
  const lines = text.split(/\r?\n/);
  if (!lines.some((l) => /^(?:createOrReplace\s+|ref\s+)?table\s/.test(l))) return null;
  const out: { name: string; what: "measure" | "column" }[] = [];
  for (const l of lines) {
    const m = /^(?:\t| {4})(measure|column)\s+('(?:[^']|'')*'|[^\s='][^=]*?)\s*(?:=|$)/.exec(l);
    if (!m) continue;
    const raw = m[2]!.trim();
    const name = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
    if (name) out.push({ name, what: m[1] as "measure" | "column" });
  }
  return out;
}

/** A report's pages as picks: "Margin by region (page, Sales report)". */
export const pagesOf = (report: WhereEntry, pages: readonly string[]): WhereInner[] =>
  pages.map((p, i) => ({ id: `${report.id}#page${i}`, name: p, what: "page", written: `${p} (page, ${report.name} ${report.what})`, line: `Page of ${report.name}` }));

/** A table's measures and columns as picks: "Total Sales (measure, Sales table, Sales semantic model)". Measures first. */
export const fieldsOf = (table: WhereEntry, fields: readonly { name: string; what: "measure" | "column" }[]): WhereInner[] =>
  [...fields.filter((f) => f.what === "measure"), ...fields.filter((f) => f.what === "column")].map((f, i) => ({
    id: `${table.id}#${f.what}${i}`,
    name: f.name,
    what: f.what,
    written: `${f.name} (${f.what}, ${table.name} table${table.within ? `, ${table.within}` : ""})`,
    line: `${f.what === "measure" ? "Measure" : "Column"} · ${table.name} table`,
  }));

/** The second level's matches for a word, in its own order (empty word: all of them). */
export const innerMatches = (inner: readonly WhereInner[], word: string): WhereInner[] => {
  const w = word.trim().toLowerCase();
  if (!w) return [...inner];
  const starts = inner.filter((x) => x.name.toLowerCase().startsWith(w));
  return [...starts, ...inner.filter((x) => !starts.includes(x) && x.name.toLowerCase().includes(w))];
};

// ---------- the words ----------

/** RB-3: every word the lookup shows, here and nowhere else (docs/design/wording.md, "Where is it?"). */
export const WHERE_TEXT = {
  browse: (client: string) => `Browse ${client}'s code`,
  listName: (client: string) => `Names in ${client}'s code`,
  chooseClient: "Choose a client first",
  chooseClientLine: "Choose a client first, then you can choose from its code.",
  reading: (client: string) => `Reading ${client}'s code…`,
  slow: (client: string) => `Still reading ${client}'s code. Type as usual; names show when they're in.`,
  more: (n: number) => `${n.toLocaleString("en-US")} more. Keep typing to narrow it.`,
  count: (n: number) => (n === 1 ? "1 name matches. Press Down to choose it." : `${n.toLocaleString("en-US")} names match. Press Down to choose one.`),
  browsing: (n: number) => `${n.toLocaleString("en-US")} in the list.`,
  added: (name: string) => `Added ${name}.`,
  noRoom: "There's no room for that in this answer.",
  back: "Back",
  open: { pages: "Pages", fields: "Measures and columns", list: "Open" } as const,
  innerReading: "Reading the file…",
  innerTooLarge: "This file is too large to list. Type the name.",
  innerNone: { pages: "This report has no pages to list.", fields: "This table has no measures or columns to list." } as const,
  innerFailed: "This file couldn't be read. Type the name.",
  innerNotLogged: "This file wasn't read because FocusTime couldn't record that you opened it.",
  tryAgain: "Try again",
  // The quiet line under the box when nothing can be offered, by reason (Code's own rule decides who may read).
  teamOnly: (client: string) => `Only ${client}'s team can read its code, so no names are offered. Type the name.`,
  notCooptimizer: "Code is for Cooptimizers, so no names are offered. Type the name.",
  cantRead: (client: string) => `FocusTime can't read ${client}'s code yet, so no names are offered. Type the name.`,
  noDevops: (client: string) => `${client} has no DevOps set up, so there are no names to offer. Type the name.`,
  noRepos: (client: string) => `${client} has no code in DevOps yet, so there are no names to offer. Type the name.`,
  nothingOffered: (client: string) => `${client}'s code has no reports, models, tables or pipelines to offer. Type the name.`,
  failed: (client: string) => `${client}'s code couldn't be read just now. Type the name, or try again.`,
  someRepos: (repos: string) => `Names from ${repos} couldn't be read.`,
  notHere: "Code isn't available here. Type the name.",
} as const;

/** The quiet line for a names read that was refused or failed, by the reason the server gave, and whether to offer Try again. */
export function whereRefusal(code: string | null | undefined, client: string): { line: string; retry: boolean } {
  switch (code) {
    case "team_only":
      return { line: WHERE_TEXT.teamOnly(client), retry: false };
    case "guest":
    case "domain":
    case "automation":
    case "signed_out":
      return { line: WHERE_TEXT.notCooptimizer, retry: false };
    case "needs_code_read":
    case "no_token":
      return { line: WHERE_TEXT.cantRead(client), retry: false };
    case "no_devops":
      return { line: WHERE_TEXT.noDevops(client), retry: false };
    case "not_here":
    case "no_client":
      return { line: WHERE_TEXT.notHere, retry: false };
    default:
      // busy, unreachable, error, not_logged, unknown, a lost connection
      return { line: WHERE_TEXT.failed(client), retry: true };
  }
}
