// RB-3b: the second level of "Where is it?", read on the server from only the files it needs (code.inner,
// actions/code-actions.ts) and returned as names. Pure: no I/O. Which files each listing opens, and how their text
// becomes names, from Microsoft's documentation as read on Nov 16:
//   - A report in the PBIR format (Power BI's default report format) keeps one definition/pages/<page>/page.json per
//     page ("displayName"; "visibility": "HiddenInViewMode" for a page hidden in view mode) and their order in
//     definition/pages/pages.json ("pageOrder", page names). Listing its pages opens pages.json and every page.json,
//     a few at a time, up to WHERE_PAGES_MAX pages; past that the level isn't offered.
//     https://learn.microsoft.com/power-bi/developer/projects/projects-report
//   - A legacy report (PBIR-Legacy) keeps every page in one report.json ("sections"): one file.
//   - A model kept as one file (model.bim, TMSL) holds its tables with their columns and measures (model.tables[]):
//     one file, within Code's text limit, gives the tables and, from the same read, each table's measures and columns.
//     https://learn.microsoft.com/power-bi/developer/projects/projects-dataset
//   - A TMDL model keeps a table's columns and measures in definition/tables/<table>.tmdl, but TMDL "doesn't force
//     object declaration in the same document": measures may be declared under a repeated "table <name>" in another
//     file (the documentation's example is one [measures].tmdl for all tables). Listing a table's measures and columns
//     opens its own file and the model's other .tmdl files that hold no object of their own, up to WHERE_PARTS_MAX.
//     https://learn.microsoft.com/analysis-services/tmdl/tmdl-overview#partial-declaration
// Nothing read here is kept, logged or sent to an AI: the names go to the box that asked, in its memory only.
import type { Thing } from "./code-kinds.ts";

/** A report's pages are listed up to this many (one file each in the PBIR format); past it the person types the page. */
export const WHERE_PAGES_MAX = 60;
/** Files are opened this many at a time for one listing. */
export const WHERE_INNER_AT_ONCE = 4;
/** A TMDL table's measures kept in other files: at most this many such files are opened. */
export const WHERE_PARTS_MAX = 8;

/** What a listing asks for: a report's pages, a TMDL table's measures and columns, or a one-file model's tables. */
export const WHERE_LISTS = ["pages", "fields", "tables"] as const;
export type WhereList = (typeof WHERE_LISTS)[number];

/** One page, with whether it is hidden in view mode. */
export type InnerPage = { name: string; hidden: boolean };
export type InnerField = { name: string; what: "measure" | "column" };
export type InnerTable = { name: string; fields: InnerField[] };

/** What code.inner returns: names only. */
export type InnerAnswer =
  | { list: "pages"; pages: InnerPage[]; /** Page files that couldn't be read (the others still list). */ unreadable: number }
  | { list: "fields"; fields: InnerField[]; /** Files that may hold more of its measures and weren't opened. */ partsSkipped: number; unreadable: number }
  | { list: "tables"; tables: InnerTable[] };

const lower = (s: string) => s.toLowerCase();
const inFolder = (folder: string, p: string) => lower(p).startsWith(`${lower(folder)}/`);
const PAGE_FILE = /^definition\/pages\/([^/]+)\/page\.json$/i;
const PAGES_FILE = /^definition\/pages\/pages\.json$/i;

/** Which files a report's pages are read from: its legacy report.json, or the PBIR pages (null when it has neither). */
export function reportFiles(t: Pick<Thing, "kind" | "folder" | "file">, paths: readonly string[]): { legacy: string } | { pagesFile: string | null; pages: { folder: string; file: string }[] } | null {
  if (t.kind !== "report") return null;
  const own = paths.filter((p) => inFolder(t.folder, p)).map((p) => ({ p, rel: p.slice(t.folder.length + 1) }));
  const legacy = own.find((f) => lower(f.rel) === "report.json");
  if (legacy) return { legacy: legacy.p };
  const pages = own.flatMap((f) => {
    const m = PAGE_FILE.exec(f.rel);
    return m ? [{ folder: m[1]!, file: f.p }] : [];
  });
  if (!pages.length) return null;
  return { pagesFile: own.find((f) => PAGES_FILE.test(f.rel))?.p ?? null, pages: pages.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0)) };
}

/** A model kept as one model.bim (no TMDL tables): the file its tables are read from. */
export const bimFile = (t: Pick<Thing, "kind" | "file" | "tables">): string | null => (t.kind === "model" && !t.tables?.length && /\/model\.bim$/i.test(t.file) ? t.file : null);

/** The .tmdl files at a model's definition root that are its own fixed parts, never a table's measures. */
const TMDL_OWN = new Set(["model", "database", "relationships", "expressions", "datasources", "functions"]);
/**
 * The other files of a TMDL model where a table's measures may be declared apart from it: .tmdl files under its
 * definition folder that aren't a table's own file, the model's fixed parts, or a role's, culture's or perspective's.
 */
export function partFiles(model: Pick<Thing, "folder">, paths: readonly string[]): string[] {
  const root = `${model.folder}/definition/`;
  return paths
    .filter((p) => lower(p).startsWith(lower(root)) && /\.tmdl$/i.test(p))
    .filter((p) => {
      const rel = p.slice(root.length);
      const parts = rel.split("/");
      if (parts.length === 1) return !TMDL_OWN.has(lower(parts[0]!.replace(/\.tmdl$/i, "")));
      return !["tables", "roles", "cultures", "perspectives"].includes(lower(parts[0]!));
    })
    .sort();
}

/** What the box may open a thing to, for code.kinds' answer to the box (whereOnly): null when it isn't offered. */
export function whereMoreOf(t: Thing, paths: readonly string[]): "pages" | "tables" | null {
  const r = reportFiles(t, paths);
  if (r) return "legacy" in r || r.pages.length <= WHERE_PAGES_MAX ? "pages" : null;
  return bimFile(t) ? "tables" : null;
}

// ---------- parsers ----------

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return undefined;
  }
};

/**
 * A legacy report's pages from its report.json: each section's display name, in the file's order (by its ordinal
 * where every section has one), hidden where the section's config says "visibility": 1 (how Power BI Desktop writes a
 * hidden page; the documentation doesn't describe report.json). Null when the text isn't a report.json with sections.
 */
export function legacyPages(text: string): InnerPage[] | null {
  const sections = obj(parse(text))?.sections;
  if (!Array.isArray(sections)) return null;
  const pages = sections
    .map((s, i) => {
      const o = obj(s) ?? {};
      const name = typeof o.displayName === "string" && o.displayName.trim() ? o.displayName.trim() : typeof o.name === "string" ? o.name : "";
      const config = typeof o.config === "string" ? obj(parse(o.config)) : obj(o.config);
      return { name, hidden: config?.visibility === 1, at: typeof o.ordinal === "number" ? o.ordinal : null, i };
    })
    .filter((p) => p.name);
  if (pages.every((p) => p.at !== null)) pages.sort((a, b) => a.at! - b.at! || a.i - b.i);
  return pages.map((p) => ({ name: p.name, hidden: p.hidden }));
}

/** One PBIR page from its page.json: its name (for the order), display name and whether it is hidden. Null when unreadable. */
export function pbirPage(text: string): { id: string | null; name: string; hidden: boolean } | null {
  const o = obj(parse(text));
  if (!o) return null;
  const name = typeof o.displayName === "string" && o.displayName.trim() ? o.displayName.trim() : typeof o.name === "string" ? o.name : "";
  if (!name) return null;
  return { id: typeof o.name === "string" ? o.name : null, name, hidden: o.visibility === "HiddenInViewMode" };
}

/** pages.json's page order (page names), or null. */
export function pbirOrder(text: string | null): string[] | null {
  if (text === null) return null;
  const order = obj(parse(text))?.pageOrder;
  return Array.isArray(order) ? order.filter((x): x is string => typeof x === "string") : null;
}

/**
 * A PBIR report's pages in the report's own order: pages.json's pageOrder (by page name or folder), then any page it
 * doesn't name, by folder. `pages` holds each page file's folder and its text (null when it couldn't be read).
 */
export function pbirPages(pagesJson: string | null, pages: readonly { folder: string; text: string | null }[]): { pages: InnerPage[]; unreadable: number } {
  const order = pbirOrder(pagesJson) ?? [];
  const read = pages.map((p) => ({ folder: p.folder, page: p.text === null ? null : pbirPage(p.text) }));
  const rank = (r: (typeof read)[number]) => {
    const i = order.findIndex((o) => o === r.page?.id || o === r.folder);
    return i < 0 ? order.length : i;
  };
  const ok = read.filter((r) => r.page).sort((a, b) => rank(a) - rank(b) || (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  return { pages: ok.map((r) => ({ name: r.page!.name, hidden: r.page!.hidden })), unreadable: read.length - ok.length };
}

/** A model.bim's tables with their measures and columns (measures first), in the file's order. Null when it isn't one. */
export function bimTables(text: string): InnerTable[] | null {
  const v = obj(parse(text));
  const tables = obj(v?.model)?.tables;
  if (!Array.isArray(tables)) return null;
  const names = (list: unknown, what: "measure" | "column"): InnerField[] =>
    Array.isArray(list)
      ? list.flatMap((x) => {
          const o = obj(x);
          // A column the model makes for itself (a row number) has no name a person would type.
          return o && typeof o.name === "string" && o.name.trim() && o.type !== "rowNumber" ? [{ name: o.name.trim(), what }] : [];
        })
      : [];
  return tables.flatMap((t) => {
    const o = obj(t);
    if (!o || typeof o.name !== "string" || !o.name.trim()) return [];
    return [{ name: o.name.trim(), fields: [...names(o.measures, "measure"), ...names(o.columns, "column")] }];
  });
}

/** A TMDL name as written ('Total Sales' or Sales) without its quotes. */
const unquote = (raw: string) => {
  const r = raw.trim();
  return r.startsWith("'") && r.endsWith("'") && r.length > 1 ? r.slice(1, -1).replace(/''/g, "'") : r;
};
const TABLE_LINE = /^(?:createOrReplace\s+)?table\s+('(?:[^']|'')*'|\S.*?)\s*$/;
const FIELD_LINE = /^(?:\t| {4})(measure|column)\s+('(?:[^']|'')*'|[^\s='][^=]*?)\s*(?:=|$)/;

/**
 * The measures and columns declared under "table <name>" in one TMDL file (a table's own file, or another file that
 * declares some of its measures). `table` null: under every table the file declares (a table's own file). Null when
 * the file declares no table at all.
 */
export function tmdlTableFields(text: string, table: string | null): InnerField[] | null {
  const lines = text.split(/\r?\n/);
  let seen = false;
  let inTable = false;
  const out: InnerField[] = [];
  for (const l of lines) {
    if (/^\S/.test(l)) {
      const m = TABLE_LINE.exec(l);
      inTable = !!m && (table === null || lower(unquote(m[1]!)) === lower(table));
      if (m) seen = true;
      continue;
    }
    if (!inTable) continue;
    const f = FIELD_LINE.exec(l);
    if (!f) continue;
    const name = unquote(f[2]!);
    if (name) out.push({ name, what: f[1] as "measure" | "column" });
  }
  return seen ? out : null;
}

/** The name a TMDL table's own file declares (its first "table" line), or null. */
export function tmdlTableName(text: string): string | null {
  for (const l of text.split(/\r?\n/)) {
    const m = TABLE_LINE.exec(l);
    if (m) return unquote(m[1]!);
  }
  return null;
}
