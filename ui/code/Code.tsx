// RB-1: Code (#/code/<client>/<repo>/<path>), every client's repos, read only: a client's tree and a file colored by
// its language, with its path as breadcrumbs, its size, line numbers, a fixed-width font, sideways scroll or Wrap, Copy,
// Copy path, Copy DevOps link and Copy link. Loaded only when Code opens (ui/App.tsx), with the coloring library.
//
// RB-2: two more ways in, from file and folder names only (ui/code/Names.tsx): By kind (a client's things across its
// repos in groups) and Search names (across the clients a person may read, three at a time). The words typed never
// leave the browser and are never in the address. RB-4: the search can look Inside files instead: each client's DevOps
// code search says which files hold the words (the one search whose words go through FocusTime's server); its results
// are files, never lines, and a file opened from them has every match marked, found in the opened text itself.
//
// RB-6: Code is a tab, a page of its own (no Close; Esc stays here). Across its top one row: the client picker (inside
// a client), one search box, "Search code", and Read only. Its choices (where to look, how far, the kind, Search) open
// under it only once the box has focus or words; nothing is read until Enter or Search. Results take the whole area
// under the row; clearing the box, or Esc in it, goes back to exactly where browsing was (same client, tree and file:
// they stay in this page's memory). Browsing is a client and a tree: on the left only Files · By kind, the repo picker
// (Files, more than one repo), By kind's filter and the tree, with the line about the log at their foot; the file on
// the right. On a narrow window the list and the file are pages of their own, with Back.
//
// A file is always drawn as text: each colored piece is a text node in a span (ui/code/highlight.ts), never markup,
// so an .html or .svg file shows its source and nothing in it runs. Nothing of the code is kept in the browser's
// storage: folder lists, names, file text and the words typed live only in this page's memory while Code is open.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { call, ActionRefusal } from "../api.ts";
import { useNarrow } from "../PanelShell.tsx";
import { LANG_NAMES, languageOf, tooLargeToColor } from "./languages.ts";
import { colorize, plainLines, type Line } from "./highlight.ts";
import { formatJson, looksSquashed } from "./format.ts";
import { INSIDE_WORDS_MAX, SEARCH_CLIENTS_AT_ONCE, type CodeEntry, type CodeFileView, type CodeRepoView } from "../../plan/code.ts";
import { insideTerms, termRanges, type InsideAnswer, type Kind, type RepoThings, type SqlGrouping, type SqlType } from "../../plan/code-kinds.ts";
import { ByKind, InsideResults, NAMES_TEXT, newKindsMemo, SearchChoices, SearchResults, type InsideRun, type KindsMemo, type SearchRun } from "./Names.tsx";
import type { CodeAt } from "../nav.ts";
import "./code.css";
import { Icon } from "../icons.tsx";

export type { CodeAt };
type KindsState = "loading" | { repos: RepoThings[]; max: number } | Failure;
type Client = { clientKey: string; name: string; color: string | null; mine: boolean; locked: boolean };
type Failure = { message: string; code: string | null };
type Folder = { state: "loading" } | { state: "ok"; entries: CodeEntry[]; cut: boolean } | { state: "failed"; failure: Failure };
type FileState = { state: "loading" } | { state: "ok"; file: CodeFileView } | { state: "failed"; failure: Failure };

const TEXT = {
  name: "Code",
  readOnly: "Read only",
  pickClient: "Choose a client to look around its code, or search above.",
  yours: "Your clients",
  others: "Other clients",
  pickRepo: "Choose a repo on the left.",
  pickFile: "Choose a file in the tree, or search for one above.",
  noRepos: (c: string) => `${c}'s DevOps project has no repos.`,
  empty: "This repo is empty: nothing has been pushed to it yet.",
  disabled: "This repo is disabled in DevOps, so it can't be read.",
  cut: "This folder has more entries than FocusTime shows. Search code to reach the rest.",
  binary: (s: string) => `This is a binary file (${s}), so it isn't shown here.`,
  image: (s: string) => `This is an image (${s}). Images aren't shown here.`,
  tooLarge: (s: string) => `This file is ${s}. Files over 1 MB aren't shown here.`,
  lfs: "This file is a Git LFS pointer. It's shown as it is; the file it points to isn't read.",
  plainLarge: "Coloring is off for large files.",
  copied: "Copied",
  copyFailed: "Couldn't copy. Select the text and copy it instead.",
  matchOf: (n: number, all: number) => `${n} of ${all}`,
  noMarks: "DevOps found the words in this file, but none is marked here: it may match them in another way.",
  prevMatch: "Previous match",
  nextMatch: "Next match",
  back: "Back",
  error: "Something went wrong. Try again in a moment.",
} as const;

const failureOf = (e: unknown): Failure => (e instanceof ActionRefusal ? { message: e.message, code: e.code ?? null } : { message: e instanceof Error && e.message ? e.message : TEXT.error, code: null });
const colorVar = (c: string | null) => (c ? (c.startsWith("#") ? c : `var(--client-${c})`) : "var(--client-none)");
const parentsOf = (path: string): string[] => {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => `/${parts.slice(0, i + 1).join("/")}`);
};
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1) || "/";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <Icon name="closed" className={`ah-chev-svg${open ? " open" : ""}`} />
  );
}

function Swatch({ color }: { color: string | null }) {
  return <span className="cv-swatch" style={{ background: colorVar(color) }} aria-hidden="true" />;
}

/** The client picker: a button that opens the list (mine first, then the rest); a locked client says why. */
function ClientList({ clients, current, onPick }: { clients: Client[]; current: string | null; onPick: (k: string) => void }) {
  const groups: [string, Client[]][] = [
    [TEXT.yours, clients.filter((c) => c.mine)],
    [TEXT.others, clients.filter((c) => !c.mine)],
  ];
  return (
    <div className="cv-clients" role="listbox" aria-label="Clients">
      {groups.map(([label, list]) =>
        list.length ? (
          <div key={label} role="group" aria-label={label} className="cv-client-group">
            <div className="cv-group-head" aria-hidden="true">
              {label}
            </div>
            {list.map((c) => (
              <button
                key={c.clientKey}
                type="button"
                role="option"
                aria-selected={c.clientKey === current}
                aria-disabled={c.locked || undefined}
                className={`cv-client-opt${c.locked ? " locked" : ""}`}
                data-code-client={c.clientKey}
                onClick={() => onPick(c.clientKey)}
              >
                <Swatch color={c.color} />
                <span className="cv-client-name">{c.name}</span>
                {c.locked && <span className="cv-locked">Only {c.name}'s team can open this</span>}
              </button>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

function ClientPicker({ clients, current, onPick }: { clients: Client[]; current: Client | null; onPick: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div
      className="cv-picker"
      ref={wrap}
      data-menu={open ? "" : undefined}
      onKeyDown={(e) => {
        // Esc closes the list first (the panel's own Esc waits for the next one).
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          wrap.current?.querySelector<HTMLElement>(".cv-picker-btn")?.focus();
        }
      }}
    >
      <button type="button" className="cv-picker-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Client: ${current?.name ?? "none"}. Change client`} onClick={() => setOpen((v) => !v)}>
        <Swatch color={current?.color ?? null} />
        <span>{current?.name ?? "Choose a client"}</span>
        <span className="cv-picker-caret" aria-hidden="true">
          <Icon name="open" />
        </span>
      </button>
      {open && (
        <div className="cv-picker-pop">
          <ClientList
            clients={clients}
            current={current?.clientKey ?? null}
            onPick={(k) => {
              setOpen(false);
              onPick(k);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** The tree: a real tree (arrows, Home, End, Enter), folders open in place with one request. */
function Tree({ root, folders, open, selected, onToggle, onFile }: { root: Folder | undefined; folders: Map<string, Folder>; open: Set<string>; selected: string | null; onToggle: (path: string) => void; onFile: (path: string) => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [focus, setFocus] = useState<string | null>(null);
  type Row = { e: CodeEntry; level: number; parent: string };
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (path: string, level: number) => {
      const f = path === "/" ? root : folders.get(path);
      if (!f || f.state !== "ok") return;
      for (const e of f.entries) {
        out.push({ e, level, parent: path });
        if (e.folder && open.has(e.path)) walk(e.path, level + 1);
      }
    };
    walk("/", 1);
    return out;
  }, [root, folders, open]);
  const current = focus && rows.some((r) => r.e.path === focus) ? focus : (selected && rows.some((r) => r.e.path === selected) ? selected : (rows[0]?.e.path ?? null));
  const move = (path: string | undefined) => {
    if (!path) return;
    setFocus(path);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus());
  };
  const onKey = (e: ReactKeyboardEvent, r: Row, i: number) => {
    const k = e.key;
    if (k === "ArrowDown") move(rows[i + 1]?.e.path);
    else if (k === "ArrowUp") move(rows[i - 1]?.e.path);
    else if (k === "Home") move(rows[0]?.e.path);
    else if (k === "End") move(rows[rows.length - 1]?.e.path);
    else if (k === "ArrowRight") {
      if (!r.e.folder) return;
      if (!open.has(r.e.path)) onToggle(r.e.path);
      else move(rows[i + 1]?.level === r.level + 1 ? rows[i + 1]!.e.path : undefined);
    } else if (k === "ArrowLeft") {
      if (r.e.folder && open.has(r.e.path)) onToggle(r.e.path);
      else if (r.parent !== "/") move(r.parent);
    } else if (k === "Enter" || k === " ") {
      if (r.e.folder) onToggle(r.e.path);
      else onFile(r.e.path);
    } else return;
    e.preventDefault();
  };
  const children = (r: Row): ReactNode => {
    const f = folders.get(r.e.path);
    if (!f) return null;
    if (f.state === "loading") return <li role="none" className="cv-tree-note" style={{ paddingInlineStart: `calc(${r.level} * 14px + 28px)` }}>Loading…</li>;
    if (f.state === "failed") return <li role="none" className="cv-tree-note problem" style={{ paddingInlineStart: `calc(${r.level} * 14px + 28px)` }}>{f.failure.message}</li>;
    if (f.cut) return <li role="none" className="cv-tree-note" style={{ paddingInlineStart: `calc(${r.level} * 14px + 28px)` }}>{TEXT.cut}</li>;
    return null;
  };
  return (
    <ul className="cv-tree" role="tree" aria-label="Files" ref={ref}>
      {rows.map((r, i) => {
        const isOpen = r.e.folder && open.has(r.e.path);
        return [
          <li
            key={r.e.path}
            role="treeitem"
            aria-level={r.level}
            aria-expanded={r.e.folder ? isOpen : undefined}
            aria-selected={!r.e.folder && r.e.path === selected}
            tabIndex={r.e.path === current ? 0 : -1}
            data-path={r.e.path}
            data-folder={r.e.folder ? "" : undefined}
            className={`cv-tree-row${!r.e.folder && r.e.path === selected ? " selected" : ""}`}
            style={{ paddingInlineStart: `calc(${r.level - 1} * 14px)` }}
            onKeyDown={(e) => onKey(e, r, i)}
            onFocus={() => setFocus(r.e.path)}
            onClick={() => (setFocus(r.e.path), r.e.folder ? onToggle(r.e.path) : onFile(r.e.path))}
          >
            {r.e.folder ? (
              <span className="ah-chev cv-chev" aria-hidden="true">
                <Chevron open={isOpen} />
              </span>
            ) : (
              <span className="ah-chev-space" aria-hidden="true" />
            )}
            <Icon name={r.e.folder ? "folder" : "file"} className="cv-kind" />
            <span className={r.e.folder ? "cv-folder" : "cv-file"}>{r.e.name}</span>
          </li>,
          isOpen ? <li key={`${r.e.path}\u0000note`} role="none" className="cv-tree-gap">{children(r)}</li> : null,
        ];
      })}
    </ul>
  );
}

/** RB-4: the matches of a search's words in a file's lines: per line, where they are and the first one's number. */
type Marks = { byLine: Map<number, { ranges: [number, number][]; first: number }>; count: number };
function marksOf(lines: Line[], terms: readonly { text: string; prefix?: boolean }[]): Marks {
  const byLine = new Map<number, { ranges: [number, number][]; first: number }>();
  let count = 0;
  // Whole words first, as code search matches; if the file has none, anywhere in a word, so something is marked.
  for (const anywhere of [false, true]) {
    if (!terms.length || count) break;
    lines.forEach((l, i) => {
      const ranges = termRanges(l.map((s) => s.text).join(""), terms, anywhere);
      if (ranges.length) (byLine.set(i, { ranges, first: count }), (count += ranges.length));
    });
  }
  return { byLine, count };
}

/** One line's colored pieces with the matches marked: each piece is still a text node, cut where a match starts or ends. */
function markedLine(l: Line, m: { ranges: [number, number][]; first: number }, current: number): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  l.forEach((s, j) => {
    const end = at + s.text.length;
    const cls = s.kinds ? s.kinds.map((k) => `tk-${k}`).join(" ") : undefined;
    let from = at;
    const push = (to: number, hit: number | null) => {
      if (to <= from) return;
      const text = s.text.slice(from - at, to - at);
      const piece = cls ? <span className={cls}>{text}</span> : text;
      out.push(hit === null ? <span key={`${j}-${from}`}>{piece}</span> : <mark key={`${j}-${from}`} className={`cv-mark${hit === current ? " on" : ""}`} data-code-mark={hit}>{piece}</mark>);
      from = to;
    };
    m.ranges.forEach(([a, b], n) => {
      if (b <= from || a >= end) return;
      push(Math.max(a, from), null);
      push(Math.min(b, end), m.first + n);
    });
    push(end, null);
    at = end;
  });
  return out;
}

function Lines({ lines, wrap, marks, current }: { lines: Line[]; wrap: boolean; marks?: Marks; current?: number }) {
  return (
    <div className={`cv-code${wrap ? " wrap" : ""}`} role="region" aria-label="File contents" tabIndex={0}>
      <code className="cv-lines">
        {lines.map((l, i) => {
          const m = marks?.byLine.get(i);
          return (
            <span key={i} className="cv-line">
              <span className="cv-ln" data-n={i + 1} aria-hidden="true" />
              <span className="cv-lt">{!l.length ? <br /> : m ? markedLine(l, m, current ?? -1) : l.map((s, j) => (s.kinds ? <span key={j} className={s.kinds.map((k) => `tk-${k}`).join(" ")}>{s.text}</span> : s.text))}</span>
            </span>
          );
        })}
      </code>
    </div>
  );
}

function FileView({ file, repo, onFolder, clientName, phone, words }: { file: CodeFileView; repo: CodeRepoView; onFolder: (path: string) => void; clientName: string; phone: boolean; /** RB-4: the words of the search inside files this file was opened from, to mark. */ words?: string | null }) {
  // A phone wraps by default: sideways scrolling a narrow box is the harder way to read.
  const [wrap, setWrap] = useState(phone);
  const [formatOn, setFormatOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => (setFormatOn(false), setToast(null)), [file.path]);
  const name = baseName(file.path);
  const text = file.text;
  const lang = languageOf(name, text);
  const squashed = !!text && lang === "json" && looksSquashed(text);
  const formatted = useMemo(() => (squashed && formatOn && text ? formatJson(text) : null), [squashed, formatOn, text]);
  const shown = formatted?.ok ? formatted.text : text;
  const large = !!shown && tooLargeToColor(shown);
  const lines = useMemo(() => (shown === null ? [] : large ? plainLines(shown) : colorize(shown, lang)), [shown, large, lang]);
  // RB-4: the matches are found here, in the text that was opened, never taken from the search's answer.
  const marks = useMemo(() => (words ? marksOf(lines, insideTerms(words)) : null), [lines, words]);
  const [hit, setHit] = useState(0);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => setHit(0), [file.path, words, formatOn]);
  useEffect(() => {
    if (marks?.count) view.current?.querySelector(`[data-code-mark="${hit}"]`)?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [marks, hit]);
  const step = (by: number) => marks?.count && setHit((h) => (h + by + marks.count) % marks.count);
  const say = (ok: boolean) => {
    setToast(ok ? TEXT.copied : TEXT.copyFailed);
    setTimeout(() => setToast(null), 2000);
  };
  const parts = file.path.split("/").filter(Boolean);
  return (
    <div className="cv-file-view" data-code-file={file.path} data-lang={lang} ref={view}>
      <div className="cv-file-head">
        <nav className="cv-crumbs" aria-label="Path">
          <button type="button" className="cv-crumb" onClick={() => onFolder("/")}>
            {repo.name}
          </button>
          {parts.map((p, i) => {
            const at = `/${parts.slice(0, i + 1).join("/")}`;
            const last = i === parts.length - 1;
            return (
              <span key={at} className="cv-crumb-part">
                <span className="cv-crumb-sep" aria-hidden="true">/</span>
                {last ? (
                  <span className="cv-crumb-file" aria-current="page">{p}</span>
                ) : (
                  <button type="button" className="cv-crumb" onClick={() => onFolder(at)}>
                    {p}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <div className="cv-file-meta">
          <span>{file.sizeText}</span>
          {text !== null && <span>{LANG_NAMES[lang]}</span>}
          {text !== null && <span>{lines.length.toLocaleString()} line{lines.length === 1 ? "" : "s"}</span>}
        </div>
        <div className="cv-file-actions">
          {text !== null && (
            <button type="button" className="mini" data-code-copy="file" onClick={() => void copy(formatOn && formatted?.ok ? formatted.text : text).then(say)}>
              {formatOn && formatted?.ok ? "Copy formatted" : "Copy"}
            </button>
          )}
          <button type="button" className="mini" data-code-copy="path" onClick={() => void copy(file.path).then(say)}>
            Copy path
          </button>
          {file.devopsUrl && (
            <button type="button" className="mini" data-code-copy="devops" onClick={() => void copy(file.devopsUrl!).then(say)}>
              Copy DevOps link
            </button>
          )}
          <button type="button" className="mini" data-code-copy="link" onClick={() => void copy(`${location.origin}${location.pathname}${location.hash}`).then(say)}>
            Copy link
          </button>
          {text !== null && (
            // RS-1: No wrap | Wrap, the two sides of one switch. It is the same checkbox (a switch named Wrap, on or off)
            // for the keyboard and a screen reader; the two words are what a pointer presses.
            <label className="cv-switch cv-wrap-switch">
              <input type="checkbox" role="switch" className="sr-only" aria-label="Wrap" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
              <span aria-hidden="true" className={wrap ? undefined : "on"} onClick={(e) => (e.preventDefault(), setWrap(false))}>No wrap</span>
              <span aria-hidden="true" className={wrap ? "on" : undefined} onClick={(e) => (e.preventDefault(), setWrap(true))}>Wrap</span>
            </label>
          )}
          {squashed && (
            <label className="cv-switch">
              <input type="checkbox" role="switch" checked={formatOn} onChange={(e) => setFormatOn(e.target.checked)} data-code-format="" /> Format
            </label>
          )}
          {toast && <span className="cv-toast" role="status">{toast}</span>}
        </div>
      </div>
      {formatted && !formatted.ok && <p className="cv-note problem">{formatted.reason}</p>}
      {file.kind === "lfs" && <p className="cv-note">{TEXT.lfs}</p>}
      {large && <p className="cv-note" data-code-plain="">{TEXT.plainLarge}</p>}
      {marks && text !== null && (
        marks.count ? (
          <div className="cv-stepper" role="group" aria-label="Matches" data-code-stepper="">
            <span role="status" data-code-match-at="">{TEXT.matchOf(hit + 1, marks.count)}</span>
            <button type="button" className="icon-btn" aria-label={TEXT.prevMatch} title={TEXT.prevMatch} onClick={() => step(-1)}>
              <Icon name="arrow-up" />
            </button>
            <button type="button" className="icon-btn" aria-label={TEXT.nextMatch} title={TEXT.nextMatch} data-code-next-match="" onClick={() => step(1)}>
              <Icon name="arrow-down" />
            </button>
          </div>
        ) : (
          <p className="cv-note" data-code-no-marks="">{TEXT.noMarks}</p>
        )
      )}
      {text === null ? (
        <p className="cv-state" data-code-state={file.kind}>
          {file.kind === "binary" ? TEXT.binary(file.sizeText) : file.kind === "image" ? TEXT.image(file.sizeText) : TEXT.tooLarge(file.sizeText)}
        </p>
      ) : (
        <Lines lines={lines} wrap={wrap} {...(marks?.count ? { marks, current: hit } : {})} />
      )}
      <span className="sr-only">{`${clientName}: ${file.path}`}</span>
    </div>
  );
}

/** The view a place shows: Files when the address names none. */
const viewOf = (at: CodeAt) => at.view ?? "files";
const isSearch = (at: CodeAt) => at.view === "search" || at.view === "inside";

export default function Code({ at, onGo, sqlGroup = "schema", onSqlGroup }: { at: CodeAt; onGo: (next: CodeAt, opts?: { replace?: boolean }) => void; /** RB-5: how By kind groups SQL objects (the person's saved choice) and how to change it. */ sqlGroup?: SqlGrouping; onSqlGroup?: (g: SqlGrouping) => void }) {
  const narrow = useNarrow();
  const [clients, setClients] = useState<Client[] | Failure | null>(null);
  const [logLine, setLogLine] = useState<string>("FocusTime admins can see who opened, listed or searched which client's code, and when. Never the words.");
  const [repos, setRepos] = useState<Map<string, CodeRepoView[] | Failure | "loading">>(new Map());
  const [folders, setFolders] = useState<Map<string, Folder>>(new Map());
  const [open, setOpen] = useState<Map<string, Set<string>>>(new Map());
  const [files, setFiles] = useState<Map<string, FileState>>(new Map());
  const asked = useRef(new Set<string>());
  // RB-2: a client's things by kind (once per client while Code is open), and the search: its words, where it looks,
  // the kind, and the run under way. All of it lives here only; none of it is stored or put in the address.
  const [kinds, setKinds] = useState<Map<string, KindsState>>(new Map());
  // RB-5: what By kind has open, per client, kept here so it outlasts the list while Code is open.
  const [kindsMemo, setKindsMemo] = useState<Map<string, KindsMemo>>(new Map());
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  // UC-2: one object type under Databases, or all: By kind's and the search's one choice, for this visit only.
  const [sqlType, setSqlType] = useState<SqlType | null>(null);
  const [scopeAll, setScopeAll] = useState(false);
  const [run, setRun] = useState<SearchRun | null>(null);
  const runId = useRef(0);
  /** The file on screen was opened from a search's results: Back to results shows, and the narrow window's Back goes there. */
  const [fromRun, setFromRun] = useState<false | "search" | "inside">(false);
  const fromRunRef = useRef<false | "search" | "inside">(false);
  fromRunRef.current = fromRun;
  const view = viewOf(at);
  const searching = isSearch(at);
  // RB-4: the search inside files under way, and whether the search is set to it (the address says so on a results page).
  const [inRun, setInRun] = useState<InsideRun | null>(null);
  const [insideMode, setInsideMode] = useState(view === "inside");
  useEffect(() => {
    if (searching) setInsideMode(view === "inside");
  }, [view, searching]);
  /** The words to mark in the file on screen: those of the search inside files it was opened from. */
  const [markAt, setMarkAt] = useState<{ key: string; words: string } | null>(null);
  // RB-6: the search box's choices show while it (or a choice) has focus, or it has words; Esc hides them.
  const [focused, setFocused] = useState(false);
  const [hushed, setHushed] = useState(false);
  const choicesOpen = (focused && !hushed) || (q !== "" && searching);
  // Leaving the results (a result opened, Back, an address) closes the choices until the box is used again.
  useEffect(() => {
    if (!searching) setHushed(true);
  }, [searching]);
  // RB-6: where browsing was before a search, to go back to when the box is cleared (same client, tree and file).
  // A file opened from the results isn't browsing: Back to results returns to them, and leaving the search still goes
  // back to where browsing was before it.
  const browseAt = useRef<CodeAt | null>(searching ? null : at);
  const openingResult = useRef(false);
  /** The one repo opening on its own: not the person browsing elsewhere, so words being typed stay (RB-3b, CI). */
  const autoOpening = useRef(false);
  useEffect(() => {
    if (searching) return;
    if (openingResult.current) openingResult.current = false;
    else if (autoOpening.current) {
      autoOpening.current = false;
      browseAt.current = at;
    } else if (!fromRunRef.current) {
      // Browsing somewhere else (not a result): the search's words go with the search.
      browseAt.current = at;
      setQ("");
    }
  }, [at, searching]);

  useEffect(() => {
    let live = true;
    call<{ clients: Client[]; logLine: string }>("code.clients", {}).then(
      (r) => live && (setClients(r.clients), setLogLine(r.logLine)),
      (e) => live && setClients(failureOf(e)),
    );
    return () => void (live = false);
  }, []);

  const list = Array.isArray(clients) ? clients : [];
  const client = at.clientKey ? (list.find((c) => c.clientKey === at.clientKey) ?? null) : null;
  const repoList = at.clientKey ? repos.get(at.clientKey) : undefined;
  const repo = Array.isArray(repoList) && at.repoId ? (repoList.find((r) => r.id === at.repoId) ?? null) : null;
  const rk = (path: string) => `${at.clientKey}\u0000${at.repoId}\u0000${path}`;

  // The client's repos (once per client while Code is open); one repo opens on its own.
  useEffect(() => {
    const k = at.clientKey;
    if (!k || !client || client.locked || searching || asked.current.has(`repos\u0000${k}`)) return;
    asked.current.add(`repos\u0000${k}`);
    setRepos((m) => new Map(m).set(k, "loading"));
    call<{ repos: CodeRepoView[] }>("code.repos", { clientKey: k }).then(
      (r) => setRepos((m) => new Map(m).set(k, r.repos)),
      (e) => setRepos((m) => new Map(m).set(k, failureOf(e))),
    );
  }, [at.clientKey, client, searching]);
  useEffect(() => {
    if (view === "files" && at.clientKey && !at.repoId && Array.isArray(repoList) && repoList.length === 1) {
      autoOpening.current = true;
      onGo({ clientKey: at.clientKey, repoId: repoList[0]!.id, path: null }, { replace: true });
    }
  }, [view, at.clientKey, at.repoId, repoList, onGo]);

  const loadFolder = useCallback(
    (path: string) => {
      if (!at.clientKey || !at.repoId) return;
      const key = `${at.clientKey}\u0000${at.repoId}\u0000${path}`;
      if (asked.current.has(`folder\u0000${key}`)) return;
      asked.current.add(`folder\u0000${key}`);
      setFolders((m) => new Map(m).set(key, { state: "loading" }));
      call<{ entries: CodeEntry[]; cut: boolean }>("code.folder", { clientKey: at.clientKey, repoId: at.repoId, path }).then(
        (r) => setFolders((m) => new Map(m).set(key, { state: "ok", entries: r.entries, cut: r.cut })),
        (e) => (asked.current.delete(`folder\u0000${key}`), setFolders((m) => new Map(m).set(key, { state: "failed", failure: failureOf(e) }))),
      );
    },
    [at.clientKey, at.repoId],
  );
  const repoKey = `${at.clientKey}\u0000${at.repoId}`;
  const openSet = open.get(repoKey) ?? new Set<string>();
  const setOpenFor = (f: (s: Set<string>) => Set<string>) => setOpen((m) => new Map(m).set(repoKey, f(new Set(m.get(repoKey) ?? []))));

  // The top folder, and a file's folders, open with the repo.
  useEffect(() => {
    // Only Files reads folders (By kind opens a file without the tree, so no repo is logged as opened).
    if (!repo || repo.state !== "ok" || view !== "files") return;
    loadFolder("/");
    if (at.path) {
      const ps = parentsOf(at.path);
      for (const p of ps) loadFolder(p);
      setOpenFor((s) => (ps.forEach((p) => s.add(p)), s));
    }
  }, [repo, at.path, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // RB-2: By kind reads the client's file names once, when the view first opens on it.
  useEffect(() => {
    const k = at.clientKey;
    if (view !== "kinds" || !k || !client || client.locked || asked.current.has(`kinds\u0000${k}`)) return;
    asked.current.add(`kinds\u0000${k}`);
    setKinds((m) => new Map(m).set(k, "loading"));
    call<{ repos: RepoThings[]; max: number }>("code.kinds", { clientKey: k }).then(
      (r) => setKinds((m) => new Map(m).set(k, { repos: r.repos, max: r.max })),
      (e) => (asked.current.delete(`kinds\u0000${k}`), setKinds((m) => new Map(m).set(k, failureOf(e)))),
    );
  }, [view, at.clientKey, client]);

  // RB-2: inside another client the search starts on This client again. A results page (the command menu's "Code:
  // search names" lands on one) puts the caret in the box once the clients are known.
  useEffect(() => setScopeAll(false), [at.clientKey]);
  const loaded = clients !== null;
  useEffect(() => {
    if (!searching || !loaded) return;
    // After a menu that opened Code has given focus back; never taken from something on Code (a result the arrows
    // reached after a search run from the box).
    const t = setTimeout(() => !document.activeElement?.closest("[data-code-page]") && document.querySelector<HTMLElement>("[data-code-search]")?.focus(), 60);
    return () => clearTimeout(t);
  }, [view, at.clientKey, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  /** RB-2: Search. Reads the names of the clients I may read, a few at a time; each fills in as it arrives. */
  const search = () => {
    const all = !at.clientKey || scopeAll;
    const inScope = list.filter((c) => all || c.clientKey === at.clientKey);
    const targets = inScope.filter((c) => !c.locked);
    const id = ++runId.current;
    setHushed(false);
    if (insideMode) {
      // RB-4: Inside files. Each client's DevOps is asked once, a few at a time; the words go only in these requests.
      const words = q.trim();
      setInRun({ q: words, kind, scope: all ? null : at.clientKey, targets, leftOut: inScope.filter((c) => c.locked), results: new Map(targets.map((c) => [c.clientKey, "waiting" as const])) });
      const put = (k: string, v: InsideAnswer | Failure) => runId.current === id && setInRun((r) => (r ? { ...r, results: new Map(r.results).set(k, v) } : r));
      let next = 0;
      const worker = async () => {
        for (let n = next++; n < targets.length && runId.current === id; n = next++) {
          const k = targets[n]!.clientKey;
          await call<InsideAnswer>("code.inside", { clientKey: k, words, ...(kind ? { kind } : {}) }).then(
            (r) => put(k, r),
            (e) => put(k, failureOf(e)),
          );
        }
      };
      for (let i = 0; i < SEARCH_CLIENTS_AT_ONCE; i++) void worker();
      onGo({ clientKey: all ? null : at.clientKey, repoId: null, path: null, view: "inside" });
      return;
    }
    setRun({ q, scope: all ? null : at.clientKey, targets, leftOut: inScope.filter((c) => c.locked), results: new Map(targets.map((c) => [c.clientKey, "waiting" as const])) });
    const put = (k: string, v: RepoThings[] | Failure) => runId.current === id && setRun((r) => (r ? { ...r, results: new Map(r.results).set(k, v) } : r));
    let next = 0;
    const worker = async () => {
      for (let n = next++; n < targets.length && runId.current === id; n = next++) {
        const k = targets[n]!.clientKey;
        await call<{ repos: RepoThings[] }>("code.search", { clientKey: k }).then(
          (r) => put(k, r.repos),
          (e) => put(k, failureOf(e)),
        );
      }
    };
    for (let i = 0; i < SEARCH_CLIENTS_AT_ONCE; i++) void worker();
    onGo({ clientKey: all ? null : at.clientKey, repoId: null, path: null, view: "search" });
  };
  /** RB-6: the box cleared, or Esc in it: the choices close and the page goes back to where browsing was. */
  const leaveSearch = () => {
    setQ("");
    setHushed(true);
    // A results page opened by its address has no browsing to go back to: it stays, so a key in the box reads nothing.
    if (searching && browseAt.current) onGo(browseAt.current);
  };
  const kindsState = at.clientKey ? kinds.get(at.clientKey) : undefined;
  // A file opened from the results keeps its way back until the person goes somewhere else in Code.
  useEffect(() => {
    if (view !== "files" || !at.path) setFromRun(false);
  }, [view, at.path, at.clientKey]);
  const backRun = fromRun === "inside" ? inRun : fromRun === "search" ? run : null;
  // Back on a results page (Back to results, the browser's Back): the box shows that search's words again.
  useEffect(() => {
    if (!searching) return;
    const shown = view === "inside" ? inRun : run;
    if (shown && shown.scope === (at.clientKey ?? null)) setQ((cur) => cur || shown.q);
  }, [searching, view, at.clientKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toResults = () => backRun && fromRun && onGo({ clientKey: backRun.scope, repoId: null, path: null, view: fromRun });

  // The file in the address.
  useEffect(() => {
    if (!repo || repo.state !== "ok" || !at.path) return;
    const key = rk(at.path);
    if (asked.current.has(`file\u0000${key}`)) return;
    asked.current.add(`file\u0000${key}`);
    setFiles((m) => new Map(m).set(key, { state: "loading" }));
    call<{ file: CodeFileView }>("code.file", { clientKey: at.clientKey, repoId: at.repoId, path: at.path }).then(
      (r) => setFiles((m) => new Map(m).set(key, { state: "ok", file: r.file })),
      (e) => (asked.current.delete(`file\u0000${key}`), setFiles((m) => new Map(m).set(key, { state: "failed", failure: failureOf(e) }))),
    );
  }, [repo, at.path]); // eslint-disable-line react-hooks/exhaustive-deps
  // A result from another client, or a file opened by its address, reads that client's repos first.
  useEffect(() => {
    const k = at.clientKey;
    if (!k || !at.repoId || !client || client.locked || asked.current.has(`repos\u0000${k}`)) return;
    asked.current.add(`repos\u0000${k}`);
    setRepos((m) => new Map(m).set(k, "loading"));
    call<{ repos: CodeRepoView[] }>("code.repos", { clientKey: k }).then(
      (r) => setRepos((m) => new Map(m).set(k, r.repos)),
      (e) => setRepos((m) => new Map(m).set(k, failureOf(e))),
    );
  }, [at.clientKey, at.repoId, client]);

  const toggle = (path: string) => {
    const isOpen = openSet.has(path);
    if (!isOpen) loadFolder(path);
    setOpenFor((s) => (isOpen ? s.delete(path) : s.add(path), s));
  };
  const openFolder = (path: string) => {
    // A breadcrumb: that folder and its parents open in the tree, which takes focus there.
    const ps = path === "/" ? [] : [...parentsOf(path), path];
    for (const p of ps) loadFolder(p);
    setOpenFor((s) => (ps.forEach((p) => s.add(p)), s));
    if (narrow) onGo({ clientKey: at.clientKey, repoId: at.repoId, path: null });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(path === "/" ? ".cv-tree [role=treeitem]" : `.cv-tree [data-path="${CSS.escape(path)}"]`)?.focus());
  };
  const openFile = (path: string) => onGo({ clientKey: at.clientKey, repoId: at.repoId, path });
  const fileState = at.path ? files.get(rk(at.path)) : undefined;

  const failedClients = clients && !Array.isArray(clients) ? clients : null;
  const logFoot = <p className="cv-log-line" data-code-log-line="">{logLine}</p>;

  // ---- the search row: the client picker (inside a client), the box, Read only; its choices under it ----
  const top = (
    <div
      className="cv-head"
      onFocus={(e) => (e.target as HTMLElement).closest("[data-code-searcharea]") && (setFocused(true), setHushed(false))}
      onBlur={(e) => !(e.relatedTarget as HTMLElement | null)?.closest?.("[data-code-searcharea]") && setFocused(false)}
    >
      <div className="cv-top">
        {client && <ClientPicker clients={list} current={client} onPick={(k) => onGo({ clientKey: k, repoId: null, path: null })} />}
        <div className="cv-search-box" role="search" aria-label="Search code" data-code-searcharea="">
          <Icon name="search" className="cv-search-icon" />
          <input
            type="search"
            className="cv-find-input cv-search-input"
            data-code-search=""
            form="cv-search-form"
            placeholder="Search code"
            aria-label="Search code"
            aria-expanded={choicesOpen}
            aria-controls="cv-search-form"
            aria-describedby="cv-search-note"
            value={q}
            maxLength={INSIDE_WORDS_MAX}
            autoComplete="off"
            disabled={!Array.isArray(clients)}
            onClick={() => setHushed(false)}
            onChange={(e) => {
              setHushed(false);
              if (!e.target.value) leaveSearch();
              else setQ(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && searching) (e.preventDefault(), document.querySelector<HTMLElement>("[data-code-hit]")?.focus());
              else if (e.key === "Escape" && (q || choicesOpen || searching)) (e.preventDefault(), e.stopPropagation(), leaveSearch());
            }}
          />
        </div>
        <span className="cv-ro">{TEXT.readOnly}</span>
      </div>
      <SearchChoices
        floating={!searching}
        open={choicesOpen}
        q={q}
        kind={kind}
        onKind={setKind}
        sqlType={sqlType}
        {...(narrow ? {} : { onSqlType: setSqlType })}
        scopeAll={!at.clientKey || scopeAll}
        onScope={setScopeAll}
        canScope={!!at.clientKey}
        disabled={!Array.isArray(clients)}
        onSearch={search}
        inside={insideMode}
        onInside={(v) => (setInsideMode(v), searching && onGo({ clientKey: at.clientKey, repoId: null, path: null, view: v ? "inside" : "search" }, { replace: true }))}
      />
    </div>
  );

  // ---- the left side: Files · By kind, the repo, the filter or the tree, and the log line at the foot ----
  const left =
    client && !client.locked ? (
      <div className="cv-side" data-code-side="">
        <div className="cv-side-scroll">
          {Array.isArray(repoList) && repoList.length > 0 && (
            <div className="seg cv-views" role="group" aria-label="View">
              <button type="button" className={`seg-btn${view === "files" ? " on" : ""}`} aria-pressed={view === "files"} data-code-view="files" onClick={() => onGo({ clientKey: at.clientKey, repoId: at.repoId, path: at.path })}>
                Files
              </button>
              <button type="button" className={`seg-btn${view === "kinds" ? " on" : ""}`} aria-pressed={view === "kinds"} data-code-view="kinds" onClick={() => onGo({ clientKey: at.clientKey, repoId: null, path: null, view: "kinds" })}>
                By kind
              </button>
            </div>
          )}
          {view === "kinds" &&
            (kindsState === undefined || kindsState === "loading" ? (
              <p className="cv-note" role="status">{NAMES_TEXT.kindsLoading}</p>
            ) : "message" in kindsState ? (
              <p className="cv-note problem" role="alert" data-code-state={kindsState.code ?? "error"}>{kindsState.message}</p>
            ) : (
              <ByKind id={at.clientKey!} narrow={narrow} sqlType={narrow ? null : sqlType} {...(narrow ? {} : { onSqlType: setSqlType })} sqlGroup={sqlGroup} onSqlGroup={(g) => onSqlGroup?.(g)} memo={kindsMemo.get(at.clientKey!) ?? newKindsMemo()} onMemo={(change) => setKindsMemo((m) => new Map(m).set(at.clientKey!, change(m.get(at.clientKey!) ?? newKindsMemo())))} repos={kindsState.repos} max={kindsState.max} selected={{ repoId: at.repoId, path: at.path }} onOpen={(repoId, file) => onGo({ clientKey: at.clientKey, repoId, path: file, view: "kinds" })} />
            ))}
          {view === "files" && Array.isArray(repoList) && repoList.length > 1 && (
            <label className="cv-repo">
              <span className="sr-only">Repo</span>
              <select aria-label="Repo" value={at.repoId ?? ""} onChange={(e) => onGo({ clientKey: at.clientKey, repoId: e.target.value || null, path: null })}>
                <option value="">Choose a repo</option>
                {repoList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.state === "empty" ? " (empty)" : r.state === "disabled" ? " (disabled)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view === "files" && repo && repo.state === "ok" && (
            <>
              <Tree root={folders.get(rk("/"))} folders={new Map([...folders].filter(([k]) => k.startsWith(`${repoKey}\u0000`)).map(([k, v]) => [k.slice(repoKey.length + 1), v]))} open={openSet} selected={at.path} onToggle={toggle} onFile={openFile} />
              {folders.get(rk("/"))?.state === "loading" && <p className="cv-note" role="status">Loading…</p>}
              {(() => {
                const f = folders.get(rk("/"));
                return f?.state === "failed" ? <p className="cv-note problem" role="alert">{f.failure.message}</p> : null;
              })()}
            </>
          )}
        </div>
        {logFoot}
      </div>
    ) : null;

  // ---- the right side ----
  let body: ReactNode;
  if (failedClients) body = <p className="cv-note problem" role="alert">{failedClients.message}</p>;
  else if (clients === null) body = <p className="cv-note" role="status">Loading…</p>;
  else if (!client) body = <p className="cv-state" data-code-state="no_client">That client isn't in FocusTime.</p>;
  else if (client.locked)
    body = (
      <div className="cv-state">
        <p className="cv-state-text" data-code-state="team_only">Only {client.name}'s team can open this.</p>
        <p className="cv-next">A FocusTime admin set it that way. If you need something from it, ask someone on {client.name}'s team.</p>
      </div>
    );
  else if (view === "kinds" && !at.path) body = <p className="cv-empty">{NAMES_TEXT.pickThing}</p>;
  else if (repoList === undefined || repoList === "loading") body = <p className="cv-note" role="status">Loading…</p>;
  else if (!Array.isArray(repoList))
    body = (
      <div className="cv-state">
        <p className="cv-state-text" data-code-state={repoList.code ?? "error"}>{repoList.message}</p>
        {repoList.code === "needs_code_read" && <p className="cv-next">A FocusTime admin can ask for Code (read) to be added. Its work items show as before.</p>}
      </div>
    );
  else if (!repoList.length) body = <p className="cv-state">{TEXT.noRepos(client.name)}</p>;
  else if (!at.repoId) body = <p className="cv-empty">{TEXT.pickRepo}</p>;
  else if (!repo) body = <p className="cv-state" data-code-state="no_repo">That repo isn't one of {client.name}'s.</p>;
  else if (repo.state === "empty") body = <p className="cv-state" data-code-state="empty">{TEXT.empty}</p>;
  else if (repo.state === "disabled") body = <p className="cv-state" data-code-state="disabled">{TEXT.disabled}</p>;
  else if (!at.path) body = <p className="cv-empty">{TEXT.pickFile}</p>;
  else if (!fileState || fileState.state === "loading") body = <p className="cv-note" role="status">Loading…</p>;
  else if (fileState.state === "failed") body = <p className="cv-state" data-code-state={fileState.failure.code ?? "error"}>{fileState.failure.message}</p>;
  else
    body = (
      <>
        {fromRun && backRun && view === "files" && !narrow && (
          <p className="cv-lives">
            <button type="button" className="mini" data-code-back-to-results="" onClick={toResults}>
              {NAMES_TEXT.backToResults}
            </button>
          </p>
        )}
        {view === "kinds" && (
          <p className="cv-lives" data-code-lives="">
            <span>
              In {repo.name}, {at.path!.slice(0, at.path!.lastIndexOf("/")) || "/"}
            </span>
            <button type="button" className="mini" data-code-show-in-files="" onClick={() => onGo({ clientKey: at.clientKey, repoId: at.repoId, path: at.path })}>
              {NAMES_TEXT.showInFiles}
            </button>
          </p>
        )}
        <FileView file={fileState.file} repo={repo} clientName={client.name} words={fromRun === "inside" && markAt?.key === rk(at.path!) ? markAt.words : null} onFolder={view === "kinds" ? (path) => (onGo({ clientKey: at.clientKey, repoId: at.repoId, path: at.path }), openFolder(path)) : openFolder} phone={narrow} />
      </>
    );

  // ---- what shows under the search row ----
  let main: ReactNode;
  if (searching)
    main = (
      <div className="cv-results-page" data-code-results-page="">
        <div className="cv-results-scroll">
          {view === "inside" ? (
            inRun && inRun.scope === (at.clientKey ?? null) ? (
              <InsideResults
                run={inRun}
                kind={kind}
                onOpen={(clientKey, repoId, file) => {
                  // The file opens through code.file, logged as a file open before its text is returned, as any file is.
                  setMarkAt({ key: `${clientKey}\u0000${repoId}\u0000${file}`, words: inRun.q });
                  openingResult.current = true;
                  onGo({ clientKey, repoId, path: file });
                  setTimeout(() => setFromRun("inside"), 0);
                }}
              />
            ) : (
              <p className="cv-empty">{NAMES_TEXT.insideStart}</p>
            )
          ) : /* A search shows only where it was made: one client's results never sit under another client's name. */
          run && run.scope === (at.clientKey ?? null) ? (
            <SearchResults run={run} kind={kind} sqlType={narrow ? null : sqlType} onOpen={(clientKey, repoId, file) => ((openingResult.current = true), onGo({ clientKey, repoId, path: file }), setTimeout(() => setFromRun("search"), 0))} />
          ) : (
            <p className="cv-empty">{NAMES_TEXT.searchStart}</p>
          )}
        </div>
        {logFoot}
      </div>
    );
  else if (failedClients || clients === null || !at.clientKey)
    main = (
      <div className="cv-start">
        <div className="cv-start-scroll">
          {failedClients ? (
            <p className="cv-note problem" role="alert">{failedClients.message}</p>
          ) : clients === null ? (
            <p className="cv-note" role="status">Loading…</p>
          ) : (
            <>
              <p className="cv-lead">{TEXT.pickClient}</p>
              <ClientList clients={list} current={null} onPick={(k) => onGo({ clientKey: k, repoId: null, path: null })} />
            </>
          )}
        </div>
        {logFoot}
      </div>
    );
  else if (narrow)
    // A narrow window: the list (Files or By kind) is one page, the file another with Back.
    main = at.path ? (
      <div className="cv-file-page">
        <button type="button" className="cv-back quiet" data-code-back="" onClick={fromRun && backRun && view === "files" ? toResults : () => onGo({ clientKey: at.clientKey, repoId: view === "kinds" ? null : at.repoId, path: null, ...(view === "kinds" ? { view } : {}) })}>
          <Icon name="back" /> {fromRun && backRun && view === "files" ? NAMES_TEXT.backToResults : view === "kinds" ? "By kind" : (repo?.name ?? TEXT.back)}
        </button>
        <div className="cv-body">{body}</div>
        {logFoot}
      </div>
    ) : (
      left ?? (
        <div className="cv-file-page">
          <div className="cv-body">{body}</div>
          {logFoot}
        </div>
      )
    );
  else
    main = (
      <div className={`cv-browse${view === "kinds" ? " kinds" : ""}${left ? "" : " solo"}`}>
        {left}
        <section className="cv-body" aria-label={at.path ? baseName(at.path) : "File"}>
          {body}
        </section>
        {!left && logFoot}
      </div>
    );

  return (
    <main className={`code-page${narrow ? " narrow" : ""}`} aria-label={TEXT.name} data-code-page="">
      <h1 className="sr-only" data-code-title={client?.clientKey ?? ""}>
        {client ? `${TEXT.name}: ${client.name}` : TEXT.name}
      </h1>
      {top}
      {main}
    </main>
  );
}
