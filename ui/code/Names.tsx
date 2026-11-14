// RB-2: Code's two ways to find things by name. By kind lists one client's things across its repos in groups
// (reports, semantic models, pipelines, ...); Search names looks for a name across the clients a person may read.
// Both work from file and folder names only (plan/code-kinds.ts): no file is opened to sort or search. The words
// typed stay here in the browser: the server is asked only for a client's names, one client at a time. Nothing is
// kept in the browser's storage; the lists live in the panel's memory while it is open.
import { useMemo, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, type IconName } from "../icons.tsx";
import { groupThings, KIND_GROUPS, KINDS, markMatches, searchThings, searchWords, shareCap, type Kind, type NameHit, type RepoThings, type Thing, type ThingInside } from "../../plan/code-kinds.ts";
import { SEARCH_MAX } from "../../plan/code.ts";

export type NamesFailure = { message: string; code: string | null };
export type NamesClient = { clientKey: string; name: string; color: string | null; locked: boolean };

export const NAMES_TEXT = {
  search: "Search names",
  searchNote: "Searches names only. Measures, columns and report pages live inside files and aren't searched.",
  searchStart: "Type a name, then press Enter or Search. Folder names count too.",
  backToResults: "Back to results",
  thisClient: "This client",
  allClients: "All clients",
  allKinds: "All kinds",
  reading: (done: number, all: number) => `Read ${done} of ${all} client${all === 1 ? "" : "s"}`,
  results: (n: number) => (n === 0 ? "No name matches." : `${n} result${n === 1 ? "" : "s"}`),
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
} as const;

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const KIND_ICON: Readonly<Record<Kind, IconName>> = { report: "report", model: "model", pipeline: "pipeline", notebook: "notebook", dataflow: "dataflow", lake: "lake", sql: "sql", fabric: "fabric-item", other: "file" };
const colorVar = (c: string | null) => (c ? (c.startsWith("#") ? c : `var(--client-${c})`) : "var(--client-none)");

// ---------- By kind ----------

type Row = Thing & { repoId: string; repoName: string };
/** What an item opens to: a model's tables, or (RB-4) the things inside it (a warehouse's tables, views and procedures). */
const kidsOf = (t: Thing): ThingInside[] => (t.tables ? t.tables.map((tb) => ({ name: tb.name, file: tb.file, kind: t.kind, detail: "Table" })) : (t.inside ?? []));
/** A group shows this many rows until Show all. */
const GROUP_SHOWN = 50;

/** One client's things across its repos, in groups that fold, with a filter by name. */
export function ByKind({ repos, max, selected, onOpen }: { repos: RepoThings[]; max: number; selected: { repoId: string | null; path: string | null }; onOpen: (repoId: string, file: string) => void }) {
  const [filter, setFilter] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<Kind>>(new Set());
  const [whole, setWhole] = useState<ReadonlySet<Kind>>(new Set());
  const [openModels, setOpenModels] = useState<ReadonlySet<string>>(new Set());
  const many = repos.length > 1;
  const rows = useMemo(() => repos.flatMap((r) => r.things.map((t): Row => ({ ...t, repoId: r.repo.id, repoName: r.repo.name }))), [repos]);
  const words = searchWords(filter);
  const tableHit = (name: string) => words.length > 0 && words.every((w) => name.toLowerCase().includes(w));
  const shown = useMemo(
    () => (words.length ? rows.filter((t) => words.every((w) => t.name.toLowerCase().includes(w)) || kidsOf(t).some((tb) => tableHit(tb.name))) : rows),
    [rows, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groups = groupThings(shown);
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
            {open && (
              <ul className="cv-things">
                {things.map((t) => {
                  const key = `${t.repoId}\u0000${t.folder}\u0000${t.file}`;
                  // While filtering, an item shows the tables or things inside that match (all of them when opened by hand).
                  const kids = kidsOf(t);
                  const hits = kids.filter((tb) => tableHit(tb.name));
                  const tables = hits.length && !openModels.has(key) ? hits : kids;
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
                        <button type="button" className="cv-thing-btn" aria-current={on ? "true" : undefined} data-code-thing={t.name} title={`${t.name}: ${t.detail}${many ? `, in ${t.repoName}` : ""}`} onClick={() => onOpen(t.repoId, t.file)}>
                          <Icon name={KIND_ICON[t.kind]} className="cv-kind" />
                          <span className="cv-thing-name">{t.name}</span>
                          <span className="cv-thing-detail">
                            {t.detail}
                            {many ? ` · ${t.repoName}` : ""}
                          </span>
                        </button>
                      </div>
                      {tablesOpen && (
                        <ul className="cv-tables" aria-label={kidsLabel}>
                          {tables.map((tb) => {
                            const tbOn = selected.repoId === t.repoId && selected.path === tb.file;
                            return (
                              <li key={tb.file}>
                                <button type="button" className={`cv-thing-btn cv-table-btn${tbOn ? " selected" : ""}`} aria-current={tbOn ? "true" : undefined} data-code-table={tb.name} onClick={() => onOpen(t.repoId, tb.file)}>
                                  <Icon name={t.tables || tb.detail.startsWith("Table") ? "table" : KIND_ICON[tb.kind]} className="cv-kind" />
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

/** The box: the words, where to look, a kind, and Search. Nothing is read until Enter or Search. */
export function SearchBox({ q, onQ, kind, onKind, scopeAll, onScope, canScope, disabled, onSearch, onDown }: { q: string; onQ: (v: string) => void; kind: Kind | null; onKind: (k: Kind | null) => void; scopeAll: boolean; onScope: (all: boolean) => void; canScope: boolean; disabled: boolean; onSearch: () => void; onDown: () => void }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled && searchWords(q).length) onSearch();
  };
  return (
    <form className="cv-search" role="search" aria-label={NAMES_TEXT.search} onSubmit={submit}>
      <div className="cv-search-row">
        <input
          type="search"
          className="cv-find-input cv-search-input"
          data-code-search=""
          placeholder={NAMES_TEXT.search}
          aria-label={NAMES_TEXT.search}
          aria-describedby="cv-search-note"
          value={q}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => onQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), onDown());
            else if (e.key === "Escape" && q) (e.preventDefault(), e.stopPropagation(), onQ(""));
          }}
        />
        <button type="submit" className="mini cv-search-go" disabled={disabled || !searchWords(q).length}>
          Search
        </button>
      </div>
      <div className="cv-search-row">
        {canScope && (
          <div className="seg" role="group" aria-label="Where to search">
            <button type="button" className={`seg-btn${scopeAll ? "" : " on"}`} aria-pressed={!scopeAll} onClick={() => onScope(false)}>
              {NAMES_TEXT.thisClient}
            </button>
            <button type="button" className={`seg-btn${scopeAll ? " on" : ""}`} aria-pressed={scopeAll} onClick={() => onScope(true)}>
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
      </div>
      <p id="cv-search-note" className="cv-search-note">
        {NAMES_TEXT.searchNote}
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
        {!run.targets.length ? NAMES_TEXT.noneToRead : reading ? `${NAMES_TEXT.reading(done, run.targets.length)}…` : NAMES_TEXT.results(byClient.total)}
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
