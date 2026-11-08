// AH-1: Fix next (D662), pure. AH-3: ranked by the client's backlog.
//
// The gaps (each client may turn any off, the Rule fix_gaps): Needs stories (a feature or epic with no open items
// under it), No target date, Unassigned, Unsized (a story with no size in the process's own size field). Only items I
// may change, open, in Cooptimize's scope.
//
// Candidates: an item in the top N of its client's backlog order for its tier (epics, features and stories each ranked
// on their own; N is the Rule ahead.fix_top_n), or dated in the next 4 weeks (its start or target in the window, or it
// spans it), or something I own or lead (a feature or epic assigned to me, or a feature directly under an epic of mine).
// Lower backlog items never show.
//
// One entry per item with all its gaps; its next action is the first of them (Break down, Set dates, Assign, Size).
// Ranked by backlog order (the process's StackRank or BacklogPriority, ascending), ties by target date, then id; a
// project with no backlog order field is ranked by target date and says so. Grouped by client, then epic › feature.
import type { ChangeField, StagedChange } from "./ahead-edit.ts";

export const GAP_KINDS = ["needs_stories", "no_dates", "unassigned", "unsized"] as const;
export type GapKind = (typeof GAP_KINDS)[number];
export const GAP_ACTION: Record<GapKind, string> = { needs_stories: "Break down", no_dates: "Set dates", unassigned: "Assign", unsized: "Size" };
export const GAP_WORDS: Record<GapKind, string> = { needs_stories: "Needs stories", no_dates: "No target date", unassigned: "Unassigned", unsized: "Unsized" };

/** The default for ahead.fix_top_n, and how far ahead "the next 4 weeks" looks. */
export const TOP_N = 30;
export const WINDOW_DAYS = 28;
/** Rows shown per client before Show more. */
export const PER_CLIENT = 10;

/** What the gaps need to know of an item (Ahead's rows carry it). */
export type GapItem = {
  clientKey: string;
  id: number;
  open: boolean;
  /** A feature or epic whose type needs breaking down (the process model). */
  needsBreakdown: boolean;
  /** Open items one level down. */
  openChildren: number;
  /** The fields the type has in its process (null: the process has none). */
  startField: string | null;
  targetField: string | null;
  sizeField: string | null;
  /** Child level (stories): sized and assigned matter most there. */
  child: boolean;
  start: string | null;
  target: string | null;
  size: number | null;
  assigneeEmail: string | null;
  canEdit: boolean;
};

type Pending = readonly Pick<StagedChange, "clientKey" | "itemId" | "field" | "value">[];

/** The gaps an item has now, with my pending changes counted as filled; only the gaps its client counts. */
export function gapsOf(i: GapItem, pending: Pending = [], counted: readonly GapKind[] = GAP_KINDS): GapKind[] {
  if (!i.open || !i.canEdit) return [];
  const mine = (f: ChangeField) => pending.find((c) => c.clientKey === i.clientKey && c.itemId === i.id && c.field === f);
  const has = (f: ChangeField, now: unknown) => {
    const p = mine(f);
    return p ? p.value !== null : now !== null && now !== undefined;
  };
  const out: GapKind[] = [];
  if (i.needsBreakdown && i.openChildren === 0) out.push("needs_stories");
  if (!i.child && i.targetField && !has("target", i.target)) out.push("no_dates");
  if (!has("assignee", i.assigneeEmail)) out.push("unassigned");
  if (i.child && i.sizeField && !has("size", i.size)) out.push("unsized");
  return out.filter((g) => counted.includes(g));
}

export type Tier = "epic" | "feature" | "story";
/** An item as Fix next weighs it. `start` and `target` are what Ahead shows (my pending change first). */
export type FixItem = GapItem & {
  tier: Tier;
  parentId: number | null;
  /** The backlog order value (null: never ranked in DevOps). */
  order: number | null;
  inScope: boolean;
  /** Assigned to me (DevOps or pending). */
  mine: boolean;
  /** AH-7: DevOps's values when `start`, `target`, `size` and the assignee show my pending changes (what it had). */
  raw?: Pick<GapItem, "start" | "target" | "size" | "assigneeEmail">;
};
export type FixClient = { clientKey: string; /** The process's order field; null: rank by target date. */ orderField: string | null; gaps: readonly GapKind[]; items: readonly FixItem[] };

export type FixEntry = {
  key: string; clientKey: string; itemId: number; gaps: GapKind[]; action: GapKind; /** Why it's a candidate. */ why: ("top" | "window" | "mine")[];
  /** AH-7: its target, else its start (Start here's "dated soonest"). */ due?: string | null;
  /** AH-7: assigned to me. */ mine?: boolean;
  /** AH-7: just fixed in the change set, shown fading out (its gaps are the ones it had). */ leaving?: boolean;
};
export type FixRow = { key: string; itemId: number; depth: number; /** null: shown only as the header of what's under it. */ entry: FixEntry | null };
export type FixGroup = {
  clientKey: string; rankedBy: "backlog" | "target"; entries: FixEntry[];
  /** AH-7: skipped entries still not ready, in the same order. */ skipped?: FixEntry[];
  /** AH-7: pieces my change set fills on candidates (each pending save). */ pending?: { key: string; gap: GapKind }[];
};

export const entryKey = (clientKey: string, itemId: number) => `${clientKey}:${itemId}`;

const addDays = (d: string, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString();
const cmpDate = (a: string | null, b: string | null) => (a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0);
const cmpOrder = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : a !== null ? -1 : b !== null ? 1 : 0);

/** The top N open, in-scope items of each tier by backlog order (an unset order never counts as near the top). */
function topOf(c: FixClient, n: number): Set<number> {
  const out = new Set<number>();
  if (!c.orderField) return out;
  for (const tier of ["epic", "feature", "story"] as const) {
    const ranked = c.items.filter((i) => i.tier === tier && i.open && i.inScope && i.order !== null).sort((a, b) => cmpOrder(a.order, b.order) || a.id - b.id);
    for (const i of ranked.slice(0, n)) out.add(i.id);
  }
  return out;
}

/** In the next 4 weeks: its start or target falls in [today, today + 28], or it spans the window. */
export function inWindow(i: Pick<FixItem, "start" | "target">, today: string, days = WINDOW_DAYS): boolean {
  const end = addDays(today, days);
  const a = i.start ?? i.target;
  const b = i.target ?? i.start;
  if (!a || !b) return false;
  return a <= end && b >= today;
}

/**
 * One client's Fix next, ranked, without the skipped items (AH-7: those come back as `skipped`). AH-7: `leaving` keeps an
 * entry my change set just fixed, with the gaps it had, so it can fade out; `pending` lists the pieces the change set fills.
 */
export function fixClient(c: FixClient, o: { today: string; topN?: number; pending?: Pending; skipped?: ReadonlySet<string>; leaving?: ReadonlySet<string> }): FixGroup {
  const top = topOf(c, o.topN ?? TOP_N);
  const ownEpics = new Set(c.items.filter((i) => i.tier === "epic" && i.mine).map((i) => i.id));
  const entries: (FixEntry & { item: FixItem })[] = [];
  const skipped: (FixEntry & { item: FixItem })[] = [];
  const pending: { key: string; gap: GapKind }[] = [];
  for (const i of c.items) {
    if (!i.inScope) continue;
    const had = gapsOf(i.raw ? { ...i, ...i.raw } : i, [], c.gaps);
    if (!had.length) continue;
    const now = gapsOf(i, o.pending ?? [], c.gaps);
    const key = entryKey(c.clientKey, i.id);
    const why: FixEntry["why"] = [];
    if (top.has(i.id)) why.push("top");
    if (inWindow(i, o.today)) why.push("window");
    if ((i.tier !== "story" && i.mine) || (i.tier === "feature" && i.parentId !== null && ownEpics.has(i.parentId))) why.push("mine");
    if (!why.length) continue;
    for (const g of had) if (!now.includes(g)) pending.push({ key, gap: g });
    const leaving = !now.length && o.leaving?.has(key) === true;
    const gaps = leaving ? had : now;
    if (!gaps.length) continue;
    const e = { key, clientKey: c.clientKey, itemId: i.id, gaps, action: gaps[0]!, why, due: i.target ?? i.start, mine: i.mine, ...(leaving ? { leaving: true } : {}), item: i };
    (o.skipped?.has(key) ? skipped : entries).push(e);
  }
  const sort = (xs: typeof entries) =>
    c.orderField
      ? xs.sort((a, b) => cmpOrder(a.item.order, b.item.order) || cmpDate(a.item.target, b.item.target) || a.itemId - b.itemId)
      : xs.sort((a, b) => cmpDate(a.item.target, b.item.target) || a.itemId - b.itemId);
  const strip = (xs: typeof entries) => sort(xs).map(({ item: _i, ...e }) => e);
  return { clientKey: c.clientKey, rankedBy: c.orderField ? "backlog" : "target", entries: strip(entries), skipped: strip(skipped), pending };
}

/**
 * The rows for the first `limit` entries in rank order, grouped epic › feature › story: each entry under its ancestors
 * (shown as headers when they aren't entries themselves), siblings in the order of their best-ranked entry.
 */
export function fixRows(g: FixGroup, items: readonly Pick<FixItem, "id" | "parentId">[], limit = PER_CLIENT): FixRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const chain = (id: number) => {
    const out: number[] = [];
    for (let p: number | null = id, n = 0; p !== null && byId.has(p) && n < 10; p = byId.get(p)!.parentId, n++) out.unshift(p);
    return out.length ? out : [id];
  };
  type Node = { id: number; entry: FixEntry | null; kids: Node[] };
  const root: Node = { id: 0, entry: null, kids: [] };
  const nodes = new Map<number, Node>();
  for (const e of g.entries.slice(0, limit)) {
    let at = root;
    for (const id of chain(e.itemId)) {
      let n = nodes.get(id);
      if (!n) {
        n = { id, entry: null, kids: [] };
        nodes.set(id, n);
        at.kids.push(n);
      }
      at = n;
    }
    at.entry = e;
  }
  const out: FixRow[] = [];
  const walk = (n: Node, depth: number) => {
    for (const k of n.kids) {
      out.push({ key: `${g.clientKey}:${k.id}`, itemId: k.id, depth, entry: k.entry });
      walk(k, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** How many entries across clients (the header's "Fix next · N"). */
export const fixCount = (groups: readonly FixGroup[]) => groups.reduce((n, g) => n + g.entries.filter((e) => !e.leaving).length, 0);
