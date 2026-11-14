// BL-2: Backlog's one rule for order, pure. The level a person picks (epics, features or stories, each client's own
// levels from its process) is the list: that client's items at the level, in that level's own backlog order (the order
// field DV-1 stores per process, StackRank or BacklogPriority, ascending; a project with none by target date), each
// with its rank number among the level's open items in Cooptimize's scope, whatever its parent. Items at the level
// above are not rows; a row's parent shows on it as a label. A row opens to what is one level under it, in that level's
// own order, and those rows open in turn. The Grid and the Gantt both read this.
//
// Filters and search remove rows; they never reorder what is left, and the rank numbers stay the true ones. A row kept
// only because something under it matches is a context row, as before. An item at the level whose parent is filtered
// out, or that has none, keeps its place. Items under the level with no item at the level above them (a story directly
// under an epic, or under nothing) follow the ranked rows, in their own level's order, so nothing on the tree is lost.
//
// Read-only order: nothing here reorders anything in DevOps.
import { buildRows, filterRows, isOpen, type LoadClient, type Row, type Tier } from "./ahead-model.ts";
import type { AheadFilters } from "./ahead-edit.ts";
import type { AheadLoad } from "../actions/types.ts";
import { backlogOrder, type LastChange } from "./backlog.ts";
import { ageDays, isStale } from "./stale.ts";
import { levelRank } from "./gantt-tree.ts";

/** A row's parent, for its label (and the Epic filter it opens). */
export type ParentLabel = { key: string; id: number; title: string; type: string; tier: Tier };
export type ListRow = Row & {
  /** Its rank in its level's backlog (1 is the top), only on the chosen level's open items in scope. */
  rank: number | null;
  parent: ParentLabel | null;
  stale: boolean;
  age: number | null;
  last: LastChange | null;
};
export type ListGroup = {
  client: LoadClient;
  /** In list order: each row at the chosen level, then what's under it (depth 1, 2, …), then the next. */
  rows: ListRow[];
  /** Ranked by the project's backlog order, or by target date when it has no order field. */
  rankedBy: "backlog" | "target";
  level: Tier;
};

export type ListOptions = {
  level: Tier;
  today?: string;
  staleWeeks?: number;
  /** QC-1: rows I just created, shown whatever the filters say. */
  keep?: ReadonlySet<string>;
  /** BH-1: the change log's last change per item. */
  last?: Readonly<Record<number, LastChange>>;
};

/** One client's list at a level. */
export function listOf(load: AheadLoad, c: LoadClient, f: AheadFilters, o: ListOptions): ListGroup {
  const byOrder = !!c.orderField;
  const rankedBy = byOrder ? ("backlog" as const) : ("target" as const);
  if (c.status !== "ok") return { client: c, rows: [], rankedBy, level: o.level };
  const all = buildRows(load, c);
  const byId = new Map(all.map((r) => [r.item.id, r]));
  // The true rank: among the level's open items in scope, before any filter.
  const rank = new Map(backlogOrder(all.filter((r) => r.tier === o.level && isOpen(r.item) && r.item.inScope !== false), byOrder).map((r, i) => [r.item.id, i + 1]));
  const today = o.today ?? load.today;
  const weeks = o.staleWeeks ?? load.staleWeeks ?? 6;
  const kept = filterRows(all, c, f, { stories: true, today, staleWeeks: weeks, ...(o.keep ? { keep: o.keep } : {}) });
  const keptIds = new Set(kept.map((r) => r.item.id));
  const childrenOf = new Map<number, Row[]>();
  for (const r of kept) if (r.item.parentId !== null && keptIds.has(r.item.parentId) && r.item.parentId !== r.item.id) (childrenOf.get(r.item.parentId) ?? childrenOf.set(r.item.parentId, []).get(r.item.parentId)!).push(r);
  const lv = levelRank(o.level);
  /** Does this row have an item at the chosen level above it (in the whole backlog, not only what's kept)? */
  const underLevel = (r: Row) => {
    const seen = new Set<number>();
    for (let p = r.item.parentId; p !== null && !seen.has(p); p = byId.get(p)?.item.parentId ?? null) {
      seen.add(p);
      const x = byId.get(p);
      if (!x) return false;
      if (x.tier === o.level) return true;
    }
    return false;
  };
  const roots = backlogOrder(kept.filter((r) => r.tier === o.level), byOrder);
  // Below the level with nothing at the level above: after the ranked rows, the higher level first.
  const loose = kept.filter((r) => levelRank(r.tier) > lv && !underLevel(r) && !(r.item.parentId !== null && keptIds.has(r.item.parentId) && levelRank(byId.get(r.item.parentId)!.tier) > lv));
  const looseSorted = [...new Set(loose.map((r) => r.tier))].sort((a, b) => levelRank(a) - levelRank(b)).flatMap((t) => backlogOrder(loose.filter((r) => r.tier === t), byOrder));
  const parentOf = (r: Row): ParentLabel | null => {
    const p = r.item.parentId !== null ? byId.get(r.item.parentId) : undefined;
    return p ? { key: p.key, id: p.item.id, title: p.item.title, type: p.item.type, tier: p.tier } : null;
  };
  const out: ListRow[] = [];
  const seen = new Set<number>();
  const visit = (r: Row, depth: number) => {
    if (seen.has(r.item.id)) return;
    seen.add(r.item.id);
    out.push({ ...r, depth, rank: depth === 0 ? (rank.get(r.item.id) ?? null) : null, parent: parentOf(r), stale: isStale(r.item, today, weeks), age: ageDays(r.item.changedAt, today), last: o.last?.[r.item.id] ?? null });
    for (const k of backlogOrder(childrenOf.get(r.item.id) ?? [], byOrder)) visit(k, depth + 1);
  };
  for (const r of [...roots, ...looseSorted]) visit(r, 0);
  return { client: c, rows: out, rankedBy, level: o.level };
}

/** The clients the client filter keeps (and any with a row I just created), each with its list. */
export function listGroups(load: AheadLoad, f: AheadFilters, o: Omit<ListOptions, "last"> & { last?: Readonly<Record<string, Readonly<Record<number, LastChange>>>> }): ListGroup[] {
  return load.clients
    .filter((c) => !f.clients.length || f.clients.includes(c.clientKey) || [...(o.keep ?? [])].some((k) => k.startsWith(`${c.clientKey}:`)))
    .map((c) => listOf(load, c, f, { ...o, last: o.last?.[c.clientKey] ?? c.last ?? {} }));
}

/** The rows a list counts: the chosen level's rows (and the loose ones after them) that a filter picked, not context. */
export const listCount = (g: Pick<ListGroup, "rows">): number => g.rows.filter((r) => r.depth === 0 && !r.context).length;
