// RB-1: Code (#/code/<client>/<repo>/<path>), every client's repos, read only. On ST-1's panel shell like the Technical
// docs: the client's name and color at the top the whole time, the left side a client picker (mine first, then the
// rest A to Z; a client set to its team only is greyed for everyone else, with no repo names), a repo select when the
// client has more than one, Find a file and the tree; the right side the file with its path as breadcrumbs, its size,
// line numbers, a fixed-width font, sideways scroll or Wrap, Copy, Copy path, Copy DevOps link and Copy link. On a phone
// the client and repo, then the tree as a list, then the file. Loaded only when Code opens (ui/App.tsx), with the
// coloring library.
//
// A file is always drawn as text: each colored piece is a text node in a span (ui/code/highlight.ts), never markup,
// so an .html or .svg file shows its source and nothing in it runs. Nothing of the code is kept in the browser's
// storage: folder lists, names and file text live only in this panel's memory while it is open.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { call, ActionRefusal } from "../api.ts";
import { PanelShell, useNarrow } from "../PanelShell.tsx";
import { LANG_NAMES, languageOf, tooLargeToColor } from "./languages.ts";
import { colorize, plainLines, type Line } from "./highlight.ts";
import { formatJson, looksSquashed } from "./format.ts";
import type { CodeEntry, CodeFileView, CodeRepoView } from "../../plan/code.ts";
import "./code.css";

export type CodeAt = { clientKey: string | null; repoId: string | null; path: string | null };
type Client = { clientKey: string; name: string; color: string | null; mine: boolean; locked: boolean };
type Failure = { message: string; code: string | null };
type Folder = { state: "loading" } | { state: "ok"; entries: CodeEntry[]; cut: boolean } | { state: "failed"; failure: Failure };
type FileState = { state: "loading" } | { state: "ok"; file: CodeFileView } | { state: "failed"; failure: Failure };

const TEXT = {
  name: "Code",
  readOnly: "Read only",
  pickClient: "Choose a client to read its code.",
  yours: "Your clients",
  others: "Other clients",
  pickRepo: "Choose a repo.",
  pickFile: "Choose a file in the tree, or find one by name.",
  noRepos: (c: string) => `${c}'s DevOps project has no repos.`,
  empty: "This repo is empty: nothing has been pushed to it yet.",
  disabled: "This repo is disabled in DevOps, so it can't be read.",
  cut: "This folder has more entries than FocusTime shows. Find a file by name to reach the rest.",
  find: "Find a file",
  findLoading: "Loading the file names…",
  findCut: (n: number) => `Only the first ${n.toLocaleString()} file names are searched.`,
  findNone: "No file name matches.",
  findCount: (n: number) => `${n} match${n === 1 ? "" : "es"}`,
  binary: (s: string) => `This is a binary file (${s}), so it isn't shown here.`,
  image: (s: string) => `This is an image (${s}). Images aren't shown here.`,
  tooLarge: (s: string) => `This file is ${s}. Files over 1 MB aren't shown here.`,
  lfs: "This file is a Git LFS pointer. It's shown as it is; the file it points to isn't read.",
  plainLarge: "Coloring is off for large files.",
  copied: "Copied",
  copyFailed: "Couldn't copy. Select the text and copy it instead.",
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
    <svg className={`ah-chev-svg${open ? " open" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
          ▾
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
            <span className={r.e.folder ? "cv-folder" : "cv-file"}>{r.e.name}</span>
          </li>,
          isOpen ? <li key={`${r.e.path}\u0000note`} role="none" className="cv-tree-gap">{children(r)}</li> : null,
        ];
      })}
    </ul>
  );
}

/** Find a file: filters the repo's file names (loaded on first use); Up, Down and Enter. */
function Find({ load, names, cut, max, onOpen }: { load: () => void; names: string[] | "loading" | Failure | null; cut: boolean; max: number; onOpen: (path: string) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(() => (Array.isArray(names) && words.length ? names.filter((n) => words.every((w) => n.toLowerCase().includes(w))).slice(0, 50) : []), [names, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setSel(0), [q]);
  const go = (p: string | undefined) => {
    if (!p) return;
    setQ("");
    onOpen(p);
  };
  return (
    <div className="cv-find">
      <input
        type="search"
        className="cv-find-input"
        placeholder={TEXT.find}
        aria-label={TEXT.find}
        aria-controls="cv-find-list"
        aria-activedescendant={hits[sel] ? `cv-hit-${sel}` : undefined}
        value={q}
        onFocus={load}
        onChange={(e) => (load(), setQ(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, hits.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
          else if (e.key === "Enter") (e.preventDefault(), go(hits[sel]));
          else if (e.key === "Escape" && q) (e.preventDefault(), setQ(""));
        }}
      />
      {words.length > 0 && (
        <div className="cv-find-results">
          {names === "loading" || names === null ? (
            <p className="cv-note" role="status">{TEXT.findLoading}</p>
          ) : !Array.isArray(names) ? (
            <p className="cv-note problem" role="status">{names.message}</p>
          ) : (
            <>
              <p className="cv-note" role="status">{hits.length ? TEXT.findCount(hits.length) : TEXT.findNone}</p>
              <ul id="cv-find-list" role="listbox" aria-label="Matching files" className="cv-find-list">
                {hits.map((h, i) => (
                  <li key={h} id={`cv-hit-${i}`} role="option" aria-selected={i === sel} className={i === sel ? "on" : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}>
                    <span className="cv-hit-name">{baseName(h)}</span>
                    <span className="cv-hit-path">{h}</span>
                  </li>
                ))}
              </ul>
              {cut && <p className="cv-note">{TEXT.findCut(max)}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Lines({ lines, wrap }: { lines: Line[]; wrap: boolean }) {
  return (
    <div className={`cv-code${wrap ? " wrap" : ""}`} role="region" aria-label="File contents" tabIndex={0}>
      <code className="cv-lines">
        {lines.map((l, i) => (
          <span key={i} className="cv-line">
            <span className="cv-ln" data-n={i + 1} aria-hidden="true" />
            <span className="cv-lt">{l.length ? l.map((s, j) => (s.kinds ? <span key={j} className={s.kinds.map((k) => `tk-${k}`).join(" ")}>{s.text}</span> : s.text)) : <br />}</span>
          </span>
        ))}
      </code>
    </div>
  );
}

function FileView({ file, repo, onFolder, clientName }: { file: CodeFileView; repo: CodeRepoView; onFolder: (path: string) => void; clientName: string }) {
  const [wrap, setWrap] = useState(false);
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
  const say = (ok: boolean) => {
    setToast(ok ? TEXT.copied : TEXT.copyFailed);
    setTimeout(() => setToast(null), 2000);
  };
  const parts = file.path.split("/").filter(Boolean);
  return (
    <div className="cv-file-view" data-code-file={file.path} data-lang={lang}>
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
            <label className="cv-switch">
              <input type="checkbox" role="switch" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap
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
      {text === null ? (
        <p className="cv-state" data-code-state={file.kind}>
          {file.kind === "binary" ? TEXT.binary(file.sizeText) : file.kind === "image" ? TEXT.image(file.sizeText) : TEXT.tooLarge(file.sizeText)}
        </p>
      ) : (
        <Lines lines={lines} wrap={wrap} />
      )}
      <span className="sr-only">{`${clientName}: ${file.path}`}</span>
    </div>
  );
}

export default function Code({ at, onGo, onClose }: { at: CodeAt; onGo: (next: CodeAt, opts?: { replace?: boolean }) => void; onClose: () => void }) {
  const phone = useNarrow();
  const [clients, setClients] = useState<Client[] | Failure | null>(null);
  const [logLine, setLogLine] = useState<string>("Opening a file is logged for FocusTime admins: who, which file and when.");
  const [repos, setRepos] = useState<Map<string, CodeRepoView[] | Failure | "loading">>(new Map());
  const [folders, setFolders] = useState<Map<string, Folder>>(new Map());
  const [open, setOpen] = useState<Map<string, Set<string>>>(new Map());
  const [files, setFiles] = useState<Map<string, FileState>>(new Map());
  const [names, setNames] = useState<Map<string, { list: string[] | "loading" | Failure; cut: boolean; max: number }>>(new Map());
  const asked = useRef(new Set<string>());

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

  // The client's repos (once per client while the panel is open); one repo opens on its own.
  useEffect(() => {
    const k = at.clientKey;
    if (!k || !client || client.locked || asked.current.has(`repos\u0000${k}`)) return;
    asked.current.add(`repos\u0000${k}`);
    setRepos((m) => new Map(m).set(k, "loading"));
    call<{ repos: CodeRepoView[] }>("code.repos", { clientKey: k }).then(
      (r) => setRepos((m) => new Map(m).set(k, r.repos)),
      (e) => setRepos((m) => new Map(m).set(k, failureOf(e))),
    );
  }, [at.clientKey, client]);
  useEffect(() => {
    if (at.clientKey && !at.repoId && Array.isArray(repoList) && repoList.length === 1) onGo({ clientKey: at.clientKey, repoId: repoList[0]!.id, path: null }, { replace: true });
  }, [at.clientKey, at.repoId, repoList, onGo]);

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
    if (!repo || repo.state !== "ok") return;
    loadFolder("/");
    if (at.path) {
      const ps = parentsOf(at.path);
      for (const p of ps) loadFolder(p);
      setOpenFor((s) => (ps.forEach((p) => s.add(p)), s));
    }
  }, [repo, at.path]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const loadNames = () => {
    if (!at.clientKey || !at.repoId || names.has(repoKey)) return;
    setNames((m) => new Map(m).set(repoKey, { list: "loading", cut: false, max: 0 }));
    call<{ paths: string[]; cut: boolean; max: number }>("code.find", { clientKey: at.clientKey, repoId: at.repoId }).then(
      (r) => setNames((m) => new Map(m).set(repoKey, { list: r.paths, cut: r.cut, max: r.max })),
      (e) => setNames((m) => new Map(m).set(repoKey, { list: failureOf(e), cut: false, max: 0 })),
    );
  };

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
    if (phone) onGo({ clientKey: at.clientKey, repoId: at.repoId, path: null });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(path === "/" ? ".cv-tree [role=treeitem]" : `.cv-tree [data-path="${CSS.escape(path)}"]`)?.focus());
  };
  const openFile = (path: string) => onGo({ clientKey: at.clientKey, repoId: at.repoId, path });

  const fileState = at.path ? files.get(rk(at.path)) : undefined;
  const nameState = names.get(repoKey);

  // ---- the left side ----
  const failedClients = clients && !Array.isArray(clients) ? clients : null;
  const left = (
    <div className="cv-side" data-code-side="">
      {failedClients ? (
        <p className="cv-note problem" role="alert">{failedClients.message}</p>
      ) : clients === null ? (
        <p className="cv-note" role="status">Loading…</p>
      ) : (
        <>
          <ClientPicker clients={list} current={client} onPick={(k) => onGo({ clientKey: k, repoId: null, path: null })} />
          {client && !client.locked && Array.isArray(repoList) && repoList.length > 1 && (
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
          {repo && repo.state === "ok" && (
            <>
              <Find load={loadNames} names={nameState?.list ?? null} cut={nameState?.cut ?? false} max={nameState?.max ?? 0} onOpen={openFile} />
              <Tree root={folders.get(rk("/"))} folders={new Map([...folders].filter(([k]) => k.startsWith(`${repoKey}\u0000`)).map(([k, v]) => [k.slice(repoKey.length + 1), v]))} open={openSet} selected={at.path} onToggle={toggle} onFile={openFile} />
              {folders.get(rk("/"))?.state === "loading" && <p className="cv-note" role="status">Loading…</p>}
              {(() => {
                const f = folders.get(rk("/"));
                return f?.state === "failed" ? <p className="cv-note problem" role="alert">{f.failure.message}</p> : null;
              })()}
            </>
          )}
          <p className="cv-log-line" data-code-log-line="">{logLine}</p>
        </>
      )}
    </div>
  );

  // ---- the right side ----
  let body: ReactNode;
  if (failedClients) body = null;
  else if (clients === null) body = <p className="cv-note" role="status">Loading…</p>;
  else if (!at.clientKey) body = (
    <div className="cv-start">
      <p className="cv-lead">{TEXT.pickClient}</p>
      <ClientList clients={list} current={null} onPick={(k) => onGo({ clientKey: k, repoId: null, path: null })} />
    </div>
  );
  else if (!client) body = <p className="cv-state" data-code-state="no_client">That client isn't in FocusTime.</p>;
  else if (client.locked) body = <p className="cv-state" data-code-state="team_only">Only {client.name}'s team can open this.</p>;
  else if (repoList === undefined || repoList === "loading") body = <p className="cv-note" role="status">Loading…</p>;
  else if (!Array.isArray(repoList)) body = <p className="cv-state" data-code-state={repoList.code ?? "error"}>{repoList.message}</p>;
  else if (!repoList.length) body = <p className="cv-state">{TEXT.noRepos(client.name)}</p>;
  else if (!at.repoId) body = <p className="cv-note">{TEXT.pickRepo}</p>;
  else if (!repo) body = <p className="cv-state" data-code-state="no_repo">That repo isn't one of {client.name}'s.</p>;
  else if (repo.state === "empty") body = <p className="cv-state" data-code-state="empty">{TEXT.empty}</p>;
  else if (repo.state === "disabled") body = <p className="cv-state" data-code-state="disabled">{TEXT.disabled}</p>;
  else if (!at.path) body = <p className="cv-note">{TEXT.pickFile}</p>;
  else if (!fileState || fileState.state === "loading") body = <p className="cv-note" role="status">Loading…</p>;
  else if (fileState.state === "failed") body = <p className="cv-state" data-code-state={fileState.failure.code ?? "error"}>{fileState.failure.message}</p>;
  else body = <FileView file={fileState.file} repo={repo} clientName={client.name} onFolder={openFolder} />;

  const title = (
    <span className="cv-title" data-code-title={client?.clientKey ?? ""}>
      {client ? (
        <>
          <Swatch color={client.color} />
          <span className="cv-title-client">{client.name}</span>
          {repo && <span className="cv-title-repo">· {repo.name}</span>}
        </>
      ) : (
        <span>{TEXT.name}</span>
      )}
      <span className="cv-ro">{TEXT.readOnly}</span>
    </span>
  );
  // A phone shows the client and the tree first (the shell's list page), then the file as its own page with Back.
  const showBody = !phone || !!at.path || !at.clientKey;
  return (
    <PanelShell
      name={TEXT.name}
      className="code-panel"
      groups={[]}
      current={showBody ? (at.path ?? "code") : null}
      onPick={() => {}}
      onClose={onClose}
      onBack={phone && at.path ? () => onGo({ clientKey: at.clientKey, repoId: at.repoId, path: null }) : null}
      backLabel={repo?.name ?? TEXT.name}
      title={title}
      railOverride={phone && !at.clientKey ? <></> : left}
      phone={phone}
      pageKey={`${at.clientKey ?? ""}/${at.repoId ?? ""}/${at.path ?? ""}`}
    >
      {phone && at.clientKey && !at.path ? left : body}
    </PanelShell>
  );
}
