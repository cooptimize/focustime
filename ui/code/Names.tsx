// RB-2: Code's two ways to find things by name. By kind lists one client's things across its repos in groups
// (reports, semantic models, pipelines, ...); Search names looks for a name across the clients a person may read.
// Both work from file and folder names only (plan/code-kinds.ts): no file is opened to sort or search. The words
// typed stay here in the browser: the server is asked only for a client's names, one client at a time. Nothing is
// kept in the browser's storage; the lists live in the panel's memory while it is open.
//
// RB-4: the search box has a switch, Names · Inside files. Inside files asks each client's DevOps code search which
// files hold the words (code.inside): for that search, and only that one, the words go through FocusTime's server to
// DevOps. Its results are files, never lines: no text of a file shows until a person opens it.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, type IconName } from "../icons.tsx";
import { groupThings, KIND_GROUPS, KINDS, listedThings, markMatches, searchThings, searchWords, shareCap, type SqlGrouping, type InsideAnswer, type InsideFile, type Kind, type NameHit, type RepoThings, type Thing, type ThingInside } from "../../plan/code-kinds.ts";
import { INSIDE_MAX, SEARCH_MAX } from "../../plan/code.ts";
import { SqlBar, sqlFolderKeys, sqlOpened, sqlPathTo, SqlTree, type SqlRow, type SqlTreeMemo } from "./SqlTree.tsx";

export type NamesFailure = { message: string; code: string | null };
export type NamesClient = { clientKey: string; name: string; color: string | null; locked: boolean };

export const NAMES_TEXT = {
  search: "Search names",
  searchNote: "Searches names only. Measures, columns and report pages live inside files: switch to Inside files for those.",
  names: "Names",
  inside: "Inside files",
  searchInside: "Search inside files",
  insideNote: "Each client's DevOps is asked which files hold the words. FocusTime reads no file to search it.",
  insideHelp: 'Plain words find files with all of them, as whole words. "A phrase in quotes", a * at the end of a word, and AND, OR and NOT in capitals work too.',
  insideStart: "Type what to look for, then press Enter or Search. A table or column name finds every file that uses it.",
  insideAsking: (done: number, all: number) => `Asked ${done} of ${all} client${all === 1 ? "" : "s"}`,
  insideResults: (n: number) => (n === 0 ? "No file holds those words." : `${n} file${n === 1 ? "" : "s"}`),
  insideNone: "No file holds those words.",
  insideNoneOfKind: "No file of that kind holds those words. Try All kinds.",
  insideNothingIn: (names: string[]) => `Nothing in ${list(names)}.`,
  insideMore: (shown: number, total: number) => `Showing the first ${shown} of ${total.toLocaleString()}. Narrow your search.`,
  insideMoreKind: (n: number, first: number, total: number) => `${n} of this kind in the first ${first} of ${total.toLocaleString()} files. Narrow your search.`,
  insideKindChanged: "Press Search again to look for this kind in the whole search.",
  insideNarrowed: (kind: string) => `DevOps was asked for ${kind} files only, by file type.`,
  insideNarrowedOther: "This search was narrowed to one kind. Press Search again to look for this one.",
  insideNotListed: (n: number) => `${n} more file${n === 1 ? " isn't" : "s aren't"} listed: DevOps found ${n === 1 ? "it" : "them"} on another branch.`,
  insideIndexing: "DevOps is still indexing this client's code, so some files may be missing.",
  insideScope: "Only each repo's default branch is searched. Forks aren't searched.",
  matches: (n: number | null) => (n === null || n === 0 ? "" : `${n} match${n === 1 ? "" : "es"}`),
  searchStart: "Type a name, then press Enter or Search. Folder names count too.",
  backToResults: "Back to results",
  thisClient: "This client",
  allClients: "All clients",
  allKinds: "All kinds",
  reading: (done: number, all: number) => `Read ${done} of ${all} client${all === 1 ? "" : "s"}`,
  results: (n: number) => (n === 0 ? "No name matches." : `${n} result${n === 1 ? "" : "s"}`),
  resultsNoneOfKind: "No name of that kind matches. Try All kinds.",
  narrow: `Showing the first ${SEARCH_MAX}. Narrow your search.`,
  leftOut: (names: string[]) => `Left out: ${list(names)}. Only ${names.length === 1 ? "its team" : "each one's team"} can read its code.`,
  noneToRead: "There is no client here whose code you can read.",
  kindsLoading: "Reading the file names…",
  kindsNote: "Sorted by file and folder names only. No file is opened to sort them.",
  kindsEmpty: "Nothing to list: this client's repos have no files.",
  kindsNone: "No name matches the filter.",
  filter: "Filter by name",
  pickThing: "Choose something in the list to open its file.",
  showAll: (n: number) => `Show all ${n.toLocaleString()}`,
  cut: (repo: string, max: number) => `${repo}: only the first ${max.toLocaleString()} file names were read.`,
  showInFiles: "Show in files",
  files: "Files",
  insideOf: (name: string, tables: boolean) => (tables ? `Tables of ${name}` : `Inside ${name}`),
  sqlOf: (name: string) => `SQL objects of ${name}`,
} as const;

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const KIND_ICON: Readonly<Record<Kind, IconName>> = { report: "report", model: "model", pipeline: "pipeline", notebook: "notebook", dataflow: "dataflow", lake: "lake", database: "sql", script: "sql-script", fabric: "fabric-item", other: "file" };
const colorVar = (c: string | null) => (c ? (c.startsWith("#") ? c : `var(--client-${c})`) : "var(--client-none)");

// ---------- By kind ----------

type Row = Thing & { repoId: string; repoName: string };
/** What an item opens to: a model's tables, or (RB-4) the things inside it (a database's tables, views and procedures). */
const kidsOf = (t: Thing): ThingInside[] => [...(t.tables ?? []).map((tb) => ({ name: tb.name, file: tb.file, kind: t.kind, detail: "Table" })), ...(t.inside ?? [])];
/** A group shows this many rows until Show all. */
const GROUP_SHOWN = 50;

/**
 * RB-5: what By kind remembers while Code is open (Code keeps it, so it outlasts this list when a file opens on the
 * phone or the view changes): the groups folded, the items opened, and each SQL tree's folders.
 */
export type KindsMemo = { folded: ReadonlySet<Kind>; whole: ReadonlySet<Kind>; openModels: ReadonlySet<string>; sql: SqlTreeMemo };
export const newKindsMemo = (): KindsMemo => ({ folded: new Set(), whole: new Set(), openModels: new Set(), sql: { open: new Map(), whole: new Set() } });

/**
 * One client's things across its repos, in groups that fold, with a filter by name. RB-6: each thing is listed once:
 * what sits inside another (a database's objects, a model's tables) shows only when that one is opened, and the
 * Databases group has the one Group by switch for every database in it.
 */
export function ByKind({ id, repos, max, selected, onOpen, sqlGroup, onSqlGroup, memo, onMemo }: { /** The client's key: this list's own name for what it remembers. */ id: string; repos: RepoThings[]; max: number; selected: { repoId: string | null; path: string | null }; onOpen: (repoId: string, file: string) => void; /** RB-5: SQL objects by schema then type, or by type then schema (the person's own choice). */ sqlGroup: SqlGrouping; onSqlGroup: (g: SqlGrouping) => void; memo: KindsMemo; onMemo: (change: (m: KindsMemo) => KindsMemo) => void }) {
  const [filter, setFilter] = useState("");
  const { folded, whole, openModels } = memo;
  const setFolded = (f: (s: ReadonlySet<Kind>) => ReadonlySet<Kind>) => onMemo((m) => ({ ...m, folded: f(m.folded) }));
  const setWhole = (f: (s: ReadonlySet<Kind>) => ReadonlySet<Kind>) => onMemo((m) => ({ ...m, whole: f(m.whole) }));
  const setOpenModels = (f: (s: ReadonlySet<string>) => ReadonlySet<string>) => onMemo((m) => ({ ...m, openModels: f(m.openModels) }));
  const onSqlMemo = (change: (s: SqlTreeMemo) => SqlTreeMemo) => onMemo((m) => ({ ...m, sql: change(m.sql) }));
  const many = repos.length > 1;
  // RB-6: only what isn't inside another thing is a row of a group.
  const rows = useMemo(() => repos.flatMap((r) => listedThings(r.things).map((t): Row => ({ ...t, repoId: r.repo.id, repoName: r.repo.name }))), [repos]);
  const words = searchWords(filter);
  // RB-5 (review 1): a SQL object is found by its schema too, the way a warehouse person types it ("dim", "stg.Store").
  const named = (t: { name: string; schema?: string }) => (t.schema ? `${t.name} ${t.schema}.${t.name}` : t.name).toLowerCase();
  const tableHit = (tb: { name: string; schema?: string }) => words.length > 0 && words.every((w) => named(tb).includes(w));
  const shown = useMemo(
    () => (words.length ? rows.filter((t) => words.every((w) => named(t).includes(w)) || kidsOf(t).some((tb) => tableHit(tb))) : rows),
    [rows, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groups = groupThings(shown);
  const keyOf = (t: Row) => `${t.repoId}\u0000${t.folder}\u0000${t.file}`;
  const treeId = (t: Row) => `${id}-${t.repoId}-${t.folder}`;
  const sqlKidsOf = (t: Row, kids: readonly ThingInside[]) => kids.filter((tb) => tb.sqlType).map((tb): SqlRow => ({ ...tb, repoId: t.repoId }));
  // Changing the switch keeps the file on the right and opens the new tree to it.
  const wasGroup = useRef(sqlGroup);
  useEffect(() => {
    if (wasGroup.current === sqlGroup) return;
    wasGroup.current = sqlGroup;
    if (!selected.path) return;
    const paths = rows.filter((t) => t.repoId === selected.repoId && t.inside?.some((x) => x.file === selected.path)).map((t) => sqlPathTo(treeId(t), sqlKidsOf(t, t.inside!), sqlGroup, selected));
    onMemo((m) => ({ ...m, sql: paths.reduce(sqlOpened, m.sql) }));
  }, [sqlGroup]); // eslint-disable-line react-hooks/exhaustive-deps
  /** RB-6: Expand all and Collapse all, for every database: the rows open (or close) and every folder in their trees. */
  const allDatabases = (open: boolean) => {
    const dbs = rows.filter((t) => t.kind === "database" && sqlKidsOf(t, kidsOf(t)).length);
    onMemo((m) => {
      const models = new Set(m.openModels);
      const folders = new Map(m.sql.open);
      for (const t of dbs) {
        if (open) models.add(keyOf(t));
        else models.delete(keyOf(t));
        for (const k of sqlFolderKeys(treeId(t), sqlKidsOf(t, kidsOf(t)), sqlGroup)) folders.set(k, open);
      }
      return { ...m, openModels: models, sql: { ...m.sql, open: folders } };
    });
  };
  const flip = <T,>(s: ReadonlySet<T>, v: T) => {
    const n = new Set(s);
    if (!n.delete(v)) n.add(v);
    return n;
  };
  const notes = repos.flatMap((r) => (r.problem ? [`${r.repo.name}: ${r.problem}`] : r.cut ? [NAMES_TEXT.cut(r.repo.name, max)] : []));
  return (
    <div className="cv-kinds" data-code-kinds="">
      <input type="search" className="cv-find-input" placeholder={NAMES_TEXT.filter} aria-label={NAMES_TEXT.filter} value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Escape" && filter && (e.preventDefault(), e.stopPropagation(), setFilter(""))} />
      {notes.map((n) => (
        <p key={n} className="cv-note problem" data-code-kinds-note="">
          {n}
        </p>
      ))}
      {!rows.length && !notes.length && <p className="cv-note">{NAMES_TEXT.kindsEmpty}</p>}
      {rows.length > 0 && !shown.length && <p className="cv-note" role="status">{NAMES_TEXT.kindsNone}</p>}
      {groups.map((g) => {
        const open = !folded.has(g.kind) || words.length > 0;
        const things = whole.has(g.kind) ? g.things : g.things.slice(0, GROUP_SHOWN);
        return (
          <section key={g.kind} className="cv-kind-group" data-code-kind={g.kind} aria-label={`${g.label}, ${g.things.length}`}>
            <button type="button" className="cv-kind-head" aria-expanded={open} onClick={() => setFolded((s) => flip(s, g.kind))}>
              <Icon name="closed" className={`ah-chev-svg${open ? " open" : ""}`} />
              <span className="cv-kind-label">{g.label}</span>
              <span className="cv-kind-count">{g.things.length.toLocaleString()}</span>
            </button>
            {open && g.kind === "database" && <SqlBar grouping={sqlGroup} onGrouping={onSqlGroup} onAll={allDatabases} disabled={words.length > 0} />}
            {open && (
              <ul className="cv-things">
                {things.map((t) => {
                  const key = keyOf(t);
                  // While filtering, an item shows the tables or things inside that match (all of them when opened by hand).
                  const kids = kidsOf(t);
                  const hits = kids.filter((tb) => tableHit(tb));
                  // RB-5: a database's tree is always narrowed by the filter, so its folders show what matches.
                  const isDb = kids.some((tb) => tb.sqlType);
                  const tables = hits.length && (isDb || !openModels.has(key)) ? hits : kids;
                  // RB-5: the SQL objects inside (a warehouse's, a SQL database's, a SQL project's) are a tree; anything else inside stays a row.
                  const sqlKids = sqlKidsOf(t, tables);
                  const otherKids = tables.filter((tb) => !tb.sqlType);
                  const kidsLabel = NAMES_TEXT.insideOf(t.name, !!t.tables);
                  const tablesOpen = openModels.has(key) || hits.length > 0;
                  const on = selected.repoId === t.repoId && selected.path === t.file;
                  return (
                    <li key={key} className="cv-thing">
                      <div className={`cv-thing-row${on ? " selected" : ""}`}>
                        {tables.length ? (
                          <button type="button" className="cv-thing-caret" aria-expanded={tablesOpen} aria-label={kidsLabel} title={kidsLabel} onClick={() => setOpenModels((s) => flip(s, key))}>
                            <Icon name="closed" className={`ah-chev-svg${tablesOpen ? " open" : ""}`} />
                          </button>
                        ) : (
                          <span className="cv-thing-caret-space" aria-hidden="true" />
                        )}
                        <button type="button" className="cv-thing-btn" aria-current={on ? "true" : undefined} data-code-thing={t.name} data-code-listed={`${t.repoId}:${t.file}`} title={`${t.name}: ${t.detail}${many ? `, in ${t.repoName}` : ""}`} onClick={() => onOpen(t.repoId, t.file)}>
                          <Icon name={KIND_ICON[t.kind]} className="cv-kind" />
                          <span className="cv-thing-name">{t.name}</span>
                          <span className="cv-thing-detail">
                            {t.detail}
                            {many ? ` · ${t.repoName}` : ""}
                          </span>
                        </button>
                      </div>
                      {tablesOpen && sqlKids.length > 0 && (
                        <div className="cv-sql-in-item">
                          <SqlTree id={treeId(t)} label={NAMES_TEXT.sqlOf(t.name)} attr="data-code-table" grouping={sqlGroup} selected={selected} onOpen={onOpen} memo={memo.sql} onMemo={onSqlMemo} filtering={tables !== kids} objects={sqlKids} />
                        </div>
                      )}
                      {tablesOpen && otherKids.length > 0 && (
                        <ul className="cv-tables" aria-label={kidsLabel}>
                          {otherKids.map((tb) => {
                            const tbOn = selected.repoId === t.repoId && selected.path === tb.file;
                            return (
                              <li key={tb.file}>
                                <button type="button" className={`cv-thing-btn cv-table-btn${tbOn ? " selected" : ""}`} aria-current={tbOn ? "true" : undefined} data-code-table={tb.name} data-code-listed={`${t.repoId}:${tb.file}`} onClick={() => onOpen(t.repoId, tb.file)}>
                                  <Icon name={tb.detail.startsWith("Table") ? "table" : KIND_ICON[tb.kind]} className="cv-kind" />
                                  <span className="cv-thing-name">{tb.name}</span>
                                  <span className="cv-thing-detail">{tb.detail}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {g.things.length > things.length && (
                  <li>
                    <button type="button" className="mini cv-show-all" onClick={() => setWhole((s) => flip(s, g.kind))}>
                      {NAMES_TEXT.showAll(g.things.length)}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
      <p className="cv-note cv-kinds-note">{NAMES_TEXT.kindsNote}</p>
    </div>
  );
}

// ---------- Search names ----------

/**
 * RB-6: the search box's choices, under the one "Search code" box at the top of every Code screen: Names or Inside files,
 * This client or All clients (only inside a client), the kind, Search, and one line saying what the search does. The
 * box itself sits in the row above and belongs to this form, so Enter runs it. Nothing is read until Enter or Search.
 */
export function SearchChoices({ floating = false, open, q, kind, onKind, scopeAll, onScope, canScope, disabled, onSearch, inside, onInside }: { /** RB-6: over the page (while browsing) rather than pushing it down (on a results page). */ floating?: boolean; open: boolean; q: string; kind: Kind | null; onKind: (k: Kind | null) => void; scopeAll: boolean; onScope: (all: boolean) => void; canScope: boolean; disabled: boolean; onSearch: () => void; inside: boolean; onInside: (inside: boolean) => void }) {
  const ready = inside ? q.trim().length > 0 : searchWords(q).length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled && ready) onSearch();
  };
  // A click on a choice keeps the caret in the box, so the choices stay open and typing goes on.
  const keep = (e: { target: EventTarget; preventDefault: () => void }) => (e.target as HTMLElement).closest("button") && e.preventDefault();
  return (
    <form id="cv-search-form" className={`cv-search${floating ? " floating" : ""}`} aria-label="Search choices" data-code-searcharea="" data-code-choices="" hidden={!open} onSubmit={submit} onMouseDown={keep}>
      <div className="cv-search-row">
        <div className="seg" role="group" aria-label="What to search">
          <button type="button" className={`seg-btn${inside ? "" : " on"}`} aria-pressed={!inside} data-code-mode="names" onClick={() => onInside(false)}>
            {NAMES_TEXT.names}
          </button>
          <button type="button" className={`seg-btn${inside ? " on" : ""}`} aria-pressed={inside} data-code-mode="inside" onClick={() => onInside(true)}>
            {NAMES_TEXT.inside}
          </button>
        </div>
        {canScope && (
          <div className="seg" role="group" aria-label="Where to search">
            <button type="button" className={`seg-btn${scopeAll ? "" : " on"}`} aria-pressed={!scopeAll} data-code-scope="client" onClick={() => onScope(false)}>
              {NAMES_TEXT.thisClient}
            </button>
            <button type="button" className={`seg-btn${scopeAll ? " on" : ""}`} aria-pressed={scopeAll} data-code-scope="all" onClick={() => onScope(true)}>
              {NAMES_TEXT.allClients}
            </button>
          </div>
        )}
        <select className="cv-search-kind" aria-label="Kind" value={kind ?? ""} onChange={(e) => onKind((e.target.value || null) as Kind | null)}>
          <option value="">{NAMES_TEXT.allKinds}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_GROUPS[k]}
            </option>
          ))}
        </select>
        <button type="submit" className="mini primary cv-search-go" disabled={disabled || !ready}>
          Search
        </button>
      </div>
      <p id="cv-search-note" className="cv-search-note" data-code-search-note="">
        {inside ? NAMES_TEXT.insideNote : NAMES_TEXT.searchNote}
      </p>
    </form>
  );
}

export type SearchRun = {
  q: string;
  /** Where it looked: one client's key, or null for every client. Shown only at that place. */
  scope: string | null;
  /** The clients asked, in the order they show. */
  targets: NamesClient[];
  /** Clients not read because only their team may read their code. */
  leftOut: NamesClient[];
  results: ReadonlyMap<string, "waiting" | RepoThings[] | NamesFailure>;
};

type Hit = NameHit & { repoId: string; repoName: string };

/** Results by client, then by kind. Up, Down and Enter move through them; at most SEARCH_MAX show. */
export function SearchResults({ run, kind, onOpen }: { run: SearchRun; kind: Kind | null; onOpen: (clientKey: string, repoId: string, file: string) => void }) {
  const done = run.targets.filter((c) => run.results.get(c.clientKey) !== "waiting").length;
  const byClient = useMemo(() => {
    const found = run.targets.map((c) => {
      const r = run.results.get(c.clientKey);
      return Array.isArray(r) ? r.flatMap((repo) => searchThings(repo.things, run.q, kind, repo.files ?? []).map((h): Hit => ({ ...h, repoId: repo.repo.id, repoName: repo.repo.name }))) : [];
    });
    // Over the limit, clients take what is left in order; each still says how many it has.
    const shown = shareCap(found.map((f) => f.length), SEARCH_MAX);
    const out = run.targets.map((c, i) => {
      const r = run.results.get(c.clientKey);
      if (!Array.isArray(r)) return { client: c, state: r ?? "waiting", hits: [] as Hit[], count: 0, many: false };
      const problems = r.flatMap((repo) => (repo.problem ? [`${repo.repo.name}: ${repo.problem}`] : []));
      return { client: c, state: "ok" as const, hits: found[i]!.slice(0, shown[i]), count: found[i]!.length, many: r.length > 1, problems };
    });
    return { out, total: found.reduce((n, f) => n + f.length, 0) };
  }, [run, kind]);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-code-hit]")];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? all[i + 1] : i <= 0 ? document.querySelector<HTMLElement>("[data-code-search]") : all[i - 1];
    if (next) (e.preventDefault(), next.focus());
  };
  const reading = done < run.targets.length;
  return (
    <div className="cv-results" data-code-results="" onKeyDown={onKey}>
      <p className="cv-note cv-results-status" role="status" data-code-progress="">
        {!run.targets.length ? NAMES_TEXT.noneToRead : reading ? `${NAMES_TEXT.reading(done, run.targets.length)}…` : byClient.total === 0 && kind ? NAMES_TEXT.resultsNoneOfKind : NAMES_TEXT.results(byClient.total)}
        {!reading && byClient.total > SEARCH_MAX ? ` ${NAMES_TEXT.narrow}` : ""}
      </p>
      {run.leftOut.length > 0 && (
        <p className="cv-note" data-code-left-out="">
          {NAMES_TEXT.leftOut(run.leftOut.map((c) => c.name))}
        </p>
      )}
      {byClient.out.map((g) => {
        if (g.state === "waiting") return null;
        const failed = g.state !== "ok" ? g.state : null;
        if (!failed && !g.count && !g.problems?.length) return null;
        return (
          <section key={g.client.clientKey} className="cv-result-client" data-code-result-client={g.client.clientKey} aria-label={g.client.name}>
            <h3 className="cv-result-head">
              <span className="cv-swatch" style={{ background: colorVar(g.client.color) }} aria-hidden="true" />
              {g.client.name}
              {!failed && <span className="cv-kind-count">{g.hits.length < g.count ? `${g.hits.length} of ${g.count} shown` : g.count}</span>}
            </h3>
            {failed && <p className="cv-note problem" data-code-result-failed="">{failed.message}</p>}
            {g.problems?.map((p) => (
              <p key={p} className="cv-note problem">
                {p}
              </p>
            ))}
            {/* RB-4: the named things by kind, then any other file found by its own name, under Files. */}
            {[...groupThings(g.hits.filter((h) => !h.asFile)).map((k) => ({ key: k.kind as string, label: k.label, things: k.things })), ...(g.hits.some((h) => h.asFile) ? [{ key: "files", label: NAMES_TEXT.files, things: g.hits.filter((h) => h.asFile) }] : [])].map((k) => (
              <div key={k.key} className="cv-result-kind" data-code-result-kind={k.key}>
                <div className="cv-group-head">{k.label}</div>
                <ul className="cv-things">
                  {k.things.map((h) => (
                    <li key={`${h.repoId}\u0000${h.file}`}>
                      <button type="button" className="cv-hit" data-code-hit={h.name} onClick={() => onOpen(g.client.clientKey, h.repoId, h.file)}>
                        <Icon name={h.asFile ? "file" : h.table || h.detail.startsWith("Table") ? "table" : KIND_ICON[h.kind]} className="cv-kind" />
                        <span className="cv-thing-name">{h.name}</span>
                        <span className="cv-thing-detail">
                          {h.detail}
                          {g.many ? ` · ${h.repoName}` : ""}
                        </span>
                        <span className="cv-hit-where">
                          {markMatches(h.file, run.q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Search inside files (RB-4) ----------

export type InsideRun = {
  /** The words as they were searched: only to mark them in a file opened from the results. Never stored. */
  q: string;
  /** The kind the search was made with (DevOps may have narrowed to it). */
  kind: Kind | null;
  scope: string | null;
  targets: NamesClient[];
  leftOut: NamesClient[];
  results: ReadonlyMap<string, "waiting" | InsideAnswer | NamesFailure>;
};

/** Files by client, then repo. Each row is a file: its name, what it is, how many matches, its path. Never a line of it. */
export function InsideResults({ run, kind, onOpen }: { run: InsideRun; kind: Kind | null; onOpen: (clientKey: string, repoId: string, file: string) => void }) {
  const done = run.targets.filter((c) => run.results.get(c.clientKey) !== "waiting").length;
  const asking = done < run.targets.length;
  const groups = run.targets.map((c) => {
    const r = run.results.get(c.clientKey) ?? "waiting";
    if (r === "waiting") return { client: c, state: "waiting" as const };
    if ("message" in r) return { client: c, state: "failed" as const, failure: r };
    // A file inside an item passes its own kind's filter and its item's.
    const files = kind ? r.files.filter((f) => f.kind === kind || f.itemKind === kind) : r.files;
    const byRepo = new Map<string, { name: string; files: InsideFile[] }>();
    for (const f of files) {
      const g = byRepo.get(f.repoId);
      if (g) g.files.push(f);
      else byRepo.set(f.repoId, { name: f.repoName, files: [f] });
    }
    return { client: c, state: "ok" as const, answer: r, files, repos: [...byRepo.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "en", { sensitivity: "base" })) };
  });
  const total = groups.reduce((n, g) => n + (g.state === "ok" ? g.files.length : 0), 0);
  const answered = groups.filter((g) => g.state === "ok").length;
  const nothingIn = groups.flatMap((g) => (g.state === "ok" && !g.files.length && !g.answer.indexing && !g.answer.more && !g.answer.narrowed && !g.answer.notListed ? [g.client.name] : []));
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-code-hit]")];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? all[i + 1] : i <= 0 ? document.querySelector<HTMLElement>("[data-code-search]") : all[i - 1];
    if (next) (e.preventDefault(), next.focus());
  };
  return (
    <div className="cv-results" data-code-inside-results="" onKeyDown={onKey}>
      <p className="cv-note cv-results-status" role="status" data-code-progress="">
        {/* "No file holds those words" is said only when at least one client answered; a client that couldn't says so below. */}
        {!run.targets.length ? NAMES_TEXT.noneToRead : asking ? `${NAMES_TEXT.insideAsking(done, run.targets.length)}…` : answered ? (total === 0 && kind ? NAMES_TEXT.insideNoneOfKind : NAMES_TEXT.insideResults(total)) : ""}
        {!asking && answered > 0 && answered < run.targets.length ? `${total === 0 ? "" : "."} ${answered} of ${run.targets.length} clients could be searched.` : ""}
      </p>
      {run.leftOut.length > 0 && (
        <p className="cv-note" data-code-left-out="">
          {NAMES_TEXT.leftOut(run.leftOut.map((c) => c.name))}
        </p>
      )}
      {/* The clients that answered with nothing are named, so "nothing" is never read into a client that wasn't asked. */}
      {!asking && total > 0 && nothingIn.length > 0 && (
        <p className="cv-note" data-code-nothing-in="">
          {NAMES_TEXT.insideNothingIn(nothingIn)}
        </p>
      )}
      {groups.map((g) => {
        if (g.state === "waiting") return null;
        // A client that answered with nothing shows no group when another has results; alone, the status line says it.
        if (g.state === "ok" && !g.files.length && !g.answer.indexing && !g.answer.more && !g.answer.narrowed && !g.answer.notListed) return null;
        return (
          <section key={g.client.clientKey} className="cv-result-client" data-code-result-client={g.client.clientKey} aria-label={g.client.name}>
            <h3 className="cv-result-head">
              <span className="cv-swatch" style={{ background: colorVar(g.client.color) }} aria-hidden="true" />
              {g.client.name}
              {g.state === "ok" && <span className="cv-kind-count">{g.files.length}</span>}
            </h3>
            {g.state === "failed" && <p className="cv-note problem" data-code-result-failed={g.failure.code ?? "error"}>{g.failure.message}</p>}
            {g.state === "ok" && g.answer.indexing && <p className="cv-note problem" data-code-indexing="">{NAMES_TEXT.insideIndexing}</p>}
            {g.state === "ok" && g.answer.more && (
              <p className="cv-note" data-code-more="">
                {kind && !g.answer.narrowed ? NAMES_TEXT.insideMoreKind(g.files.length, Math.min(g.answer.files.length, INSIDE_MAX), g.answer.total) : NAMES_TEXT.insideMore(Math.min(g.answer.files.length, INSIDE_MAX), g.answer.total)}
                {kind !== run.kind && !g.answer.narrowed ? ` ${NAMES_TEXT.insideKindChanged}` : ""}
              </p>
            )}
            {/* A search DevOps narrowed to one kind's file type holds only that kind: say so, and under another kind say to search again. */}
            {g.state === "ok" && g.answer.narrowed && (
              <p className="cv-note" data-code-narrowed="">
                {kind === run.kind && run.kind ? NAMES_TEXT.insideNarrowed(KIND_GROUPS[run.kind]) : NAMES_TEXT.insideNarrowedOther}
              </p>
            )}
            {g.state === "ok" && g.answer.notListed > 0 && <p className="cv-note" data-code-not-listed="">{NAMES_TEXT.insideNotListed(g.answer.notListed)}</p>}
            {g.state === "ok" &&
              g.repos.map(([repoId, repo]) => (
                <div key={repoId} className="cv-result-kind" data-code-result-repo={repo.name}>
                  <div className="cv-group-head">{repo.name}</div>
                  <ul className="cv-things">
                    {repo.files.map((f) => {
                      const name = f.path.slice(f.path.lastIndexOf("/") + 1);
                      return (
                        <li key={f.path}>
                          <button type="button" className="cv-hit cv-inside-hit" data-code-hit={name} onClick={() => onOpen(g.client.clientKey, f.repoId, f.path)}>
                            <Icon name={f.detail.startsWith("Table") ? "table" : f.detail.startsWith("File") ? "file" : KIND_ICON[f.kind]} className="cv-kind" />
                            <span className="cv-thing-name">{name}</span>
                            <span className="cv-thing-detail">{f.detail}</span>
                            <span className="cv-hit-count" data-code-matches="">{NAMES_TEXT.matches(f.matches)}</span>
                            <span className="cv-hit-where" title={f.path}>{f.path}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
          </section>
        );
      })}
      {!asking && run.targets.length > 0 && <p className="cv-note cv-inside-scope" data-code-inside-scope="">{NAMES_TEXT.insideScope}</p>}
    </div>
  );
}
