// RB-5: a database's SQL objects in folders, in Code's By kind: by schema then type, or by type then schema, with one
// Group by switch. The folders come from plan/code-kinds.ts (sqlTree), which reads names and folders only: no file is
// opened to group anything and switching the grouping asks the server for nothing but to remember the choice. A tree
// for the keyboard and a screen reader: Up and Down move, Right opens, Left closes, Enter opens the file.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../icons.tsx";
import { sqlTree, type SqlDatabase, type SqlGrouping, type SqlObject } from "../../plan/code-kinds.ts";

export const SQL_TEXT = {
  groupBy: "Group by",
  schema: "Schema",
  type: "Type",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  showAll: (n: number) => `Show all ${n.toLocaleString()}`,
  folder: (label: string, count: number) => `${label}, ${count.toLocaleString()}`,
} as const;

/** A folder shows this many objects until Show all. */
export const SQL_FOLDER_SHOWN = 100;

export type SqlRow = SqlObject & { repoId: string; /** Words beside the name that the folders above don't already say. */ note?: string };
/** What is open, and which folders show everything: kept by the panel, so it outlasts the list while the panel is open. */
export type SqlTreeMemo = { open: Map<string, boolean>; whole: Set<string> };

type Node<T> = { key: string; label: string; count: number; kids: Node<T>[]; objects: T[] };
type Line<T> =
  | { kind: "folder"; key: string; level: number; node: Node<T>; open: boolean }
  | { kind: "object"; key: string; level: number; object: T }
  | { kind: "more"; key: string; level: number; folder: string; count: number };

function nodesOf<T extends SqlRow>(prefix: string, objects: readonly T[], grouping: SqlGrouping): Node<T>[] {
  return sqlTree(objects, grouping).folders.map((f) => ({
    key: `${prefix}|${f.key}`,
    label: f.label,
    count: f.count,
    objects: [],
    kids: f.folders.map((l) => ({ key: `${prefix}|${l.key}`, label: l.label, count: l.count, kids: [], objects: l.objects })),
  }));
}

const rootsOf = <T extends SqlRow>(id: string, objects: readonly T[], databases: readonly SqlDatabase<T>[] | null | undefined, grouping: SqlGrouping): Node<T>[] => {
  const base = `${id}|${grouping}`;
  return databases ? databases.map((d) => ({ key: `${base}|${d.key}`, label: d.label, count: d.objects.length, objects: [], kids: nodesOf(`${base}|${d.key}`, d.objects, grouping) })) : nodesOf(base, objects, grouping);
};

/**
 * The folders that lead to one file in a tree, outermost first (none when the tree doesn't hold it): what a change
 * of grouping opens, so the file on the right is still in view. The list calls it for every tree, shown or not.
 */
export function sqlPathTo<T extends SqlRow>(id: string, objects: readonly T[], databases: readonly SqlDatabase<T>[] | null | undefined, grouping: SqlGrouping, selected: { repoId: string | null; path: string | null }): string[] {
  if (!selected.path) return [];
  const find = (nodes: Node<T>[], trail: string[]): string[] | null => {
    for (const n of nodes) {
      const here = [...trail, n.key];
      if (n.objects.some((o) => o.repoId === selected.repoId && o.file === selected.path)) return here;
      const below = find(n.kids, here);
      if (below) return below;
    }
    return null;
  };
  return find(rootsOf(id, objects, databases, grouping), []) ?? [];
}
/** A memo with those folders open, and the last one showing all it holds. */
export function sqlOpened(m: SqlTreeMemo, path: readonly string[]): SqlTreeMemo {
  if (!path.length) return m;
  const open = new Map(m.open);
  for (const k of path) open.set(k, true);
  return { open, whole: new Set([...m.whole, path[path.length - 1]!]) };
}

/** The Group by switch and the tree under it. `databases` puts each database first; without it the grouping starts at the top. */
export function SqlTree<T extends SqlRow>({ id, label, objects, databases, grouping, onGrouping, filtering, selected, onOpen, memo, onMemo, attr }: {
  /** This list's own name for its keys (a client's SQL group, or one item). */
  id: string;
  label: string;
  objects: readonly T[];
  databases?: readonly SqlDatabase<T>[] | null;
  grouping: SqlGrouping;
  onGrouping: (g: SqlGrouping) => void;
  /** The filter box has words: `objects` are the matches, and every folder with one is open. */
  filtering: boolean;
  selected: { repoId: string | null; path: string | null };
  onOpen: (repoId: string, file: string) => void;
  memo: SqlTreeMemo;
  /** Changes go through a function of the latest value: two trees may change it in the same moment. */
  onMemo: (change: (m: SqlTreeMemo) => SqlTreeMemo) => void;
  /** The attribute an object's row carries, as By kind's rows do. */
  attr: "data-code-thing" | "data-code-table";
}) {
  const byId = useId();
  const roots = useMemo(() => rootsOf(id, objects, databases, grouping), [id, databases, objects, grouping]);
  // A folder starts closed, except where it is the only one at its level. While filtering every folder is open.
  const isOpen = (n: Node<T>, alone: boolean) => filtering || (memo.open.get(n.key) ?? alone);
  const lines = useMemo(() => {
    const out: Line<T>[] = [];
    const walk = (nodes: Node<T>[], level: number) => {
      for (const n of nodes) {
        const open = isOpen(n, nodes.length === 1);
        out.push({ kind: "folder", key: n.key, level, node: n, open });
        if (!open) continue;
        walk(n.kids, level + 1);
        const all = memo.whole.has(n.key) || n.objects.length <= SQL_FOLDER_SHOWN;
        for (const o of all ? n.objects : n.objects.slice(0, SQL_FOLDER_SHOWN)) out.push({ kind: "object", key: `${n.key}|${o.repoId}|${o.file}`, level: level + 1, object: o });
        if (!all) out.push({ kind: "more", key: `${n.key}|more`, level: level + 1, folder: n.key, count: n.objects.length });
      }
    };
    walk(roots, 1);
    return out;
  }, [roots, memo, filtering]); // eslint-disable-line react-hooks/exhaustive-deps

  const allFolders = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: Node<T>[]) => nodes.forEach((n) => (keys.push(n.key), walk(n.kids)));
    walk(roots);
    return keys;
  }, [roots]);
  const setOpen = (keys: readonly string[], open: boolean) => {
    onMemo((m) => {
      const next = new Map(m.open);
      for (const k of keys) next.set(k, open);
      return { ...m, open: next };
    });
  };

  // One row takes the Tab key; the arrows move from there. The row is kept in state, so the tab stop is always React's.
  const ul = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState<string | null>(null);
  const focusKey = at !== null && lines.some((l) => l.key === at) ? at : (lines.find((l) => l.kind === "object" && l.object.repoId === selected.repoId && l.object.file === selected.path)?.key ?? lines[0]?.key ?? null);
  /** A row to put the keyboard on once it is drawn (the first object Show all brought in). */
  const pending = useRef<string | null>(null);
  const focusLine = (key: string) => {
    setAt(key);
    [...(ul.current?.querySelectorAll<HTMLElement>("[data-sql-key]") ?? [])].find((e) => e.dataset.sqlKey === key)?.focus();
  };
  useEffect(() => {
    const key = pending.current;
    if (!key || !lines.some((l) => l.key === key)) return;
    pending.current = null;
    focusLine(key);
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (l: Line<T>, keyboard = false) => {
    setAt(l.key);
    if (l.kind === "folder") {
      // While the filter has words every folder with a match is open; nothing is stored, so clearing it puts the tree back.
      if (!filtering) setOpen([l.key], !l.open);
    } else if (l.kind === "object") onOpen(l.object.repoId, l.object.file);
    else {
      // Show all: the row goes away, and the keyboard lands on the first object it brought in.
      const node = l.folder;
      const find = (nodes: Node<T>[]): Node<T> | null => nodes.reduce<Node<T> | null>((hit, n) => hit ?? (n.key === node ? n : find(n.kids)), null);
      const next = find(roots)?.objects[SQL_FOLDER_SHOWN];
      if (keyboard && next) pending.current = `${node}|${next.repoId}|${next.file}`;
      onMemo((m) => ({ ...m, whole: new Set([...m.whole, l.folder]) }));
    }
  };
  const onKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const i = lines.findIndex((l) => l.key === (e.target as HTMLElement).dataset?.sqlKey);
    const l = lines[i];
    if (!l || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = (j: number) => lines[j] && focusLine(lines[j]!.key);
    const parent = () => {
      for (let j = i - 1; j >= 0; j--) if (lines[j]!.level < l.level) return to(j);
    };
    if (e.key === "ArrowDown") to(i + 1);
    else if (e.key === "ArrowUp") to(i - 1);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(lines.length - 1);
    else if (e.key === "ArrowRight") {
      if (l.kind !== "folder") return;
      if (!l.open) act(l, true);
      else to(i + 1);
    } else if (e.key === "ArrowLeft") {
      if (l.kind === "folder" && l.open && !filtering) act(l, true);
      else parent();
    } else if (e.key === "Enter" || e.key === " ") act(l, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="cv-sql" data-sql-list={id}>
      <div className="cv-sql-bar">
        <span className="cv-sql-by" id={byId}>{SQL_TEXT.groupBy}</span>
        <span className="day-switch cv-sql-switch" role="group" aria-labelledby={byId} data-sql-group={grouping}>
          <button type="button" aria-pressed={grouping === "schema"} data-sql-group-btn="schema" title="Schemas, then the types in each" onClick={() => grouping !== "schema" && onGrouping("schema")}>
            {SQL_TEXT.schema}
          </button>
          <button type="button" aria-pressed={grouping === "type"} data-sql-group-btn="type" title="Types, then the schemas in each" onClick={() => grouping !== "type" && onGrouping("type")}>
            {SQL_TEXT.type}
          </button>
        </span>
        <span className="cv-sql-all">
          <button type="button" className="cv-sql-all-btn" data-sql-expand="" disabled={filtering} onClick={() => setOpen(allFolders, true)}>
            {SQL_TEXT.expandAll}
          </button>
          <button type="button" className="cv-sql-all-btn" data-sql-collapse="" disabled={filtering} onClick={() => setOpen(allFolders, false)}>
            {SQL_TEXT.collapseAll}
          </button>
        </span>
      </div>
      <ul className="cv-sql-tree" role="tree" aria-label={label} ref={ul} onKeyDown={onKey}>
        {lines.map((l) => {
          const common = { key: l.key, role: "treeitem" as const, "aria-level": l.level, "data-sql-key": l.key, tabIndex: l.key === focusKey ? 0 : -1, style: { "--lvl": l.level } as React.CSSProperties, onClick: () => act(l), onFocus: () => setAt(l.key) };
          if (l.kind === "folder")
            return (
              <li {...common} className="cv-sql-row folder" aria-expanded={l.open} aria-label={SQL_TEXT.folder(l.node.label, l.node.count)} data-sql-folder={l.node.label} data-sql-level={l.level}>
                <Icon name="closed" className={`ah-chev-svg${l.open ? " open" : ""}`} />
                <span className="cv-thing-name">{l.node.label}</span>
                <span className="cv-kind-count">{l.node.count.toLocaleString()}</span>
              </li>
            );
          if (l.kind === "more")
            return (
              <li {...common} className="cv-sql-row more" data-sql-more="">
                <span className="cv-sql-more">{SQL_TEXT.showAll(l.count)}</span>
              </li>
            );
          const o = l.object;
          const on = selected.repoId === o.repoId && selected.path === o.file;
          return (
            <li {...common} className={`cv-sql-row object${on ? " selected" : ""}`} aria-current={on ? "true" : undefined} aria-selected={on} title={o.file} data-sql-file={o.file} {...{ [attr]: o.name }}>
              <Icon name={o.sqlType === "table" ? "table" : "sql"} className="cv-kind" />
              <span className="cv-thing-name">{o.name}</span>
              {o.note && <span className="cv-thing-detail">{o.note}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
