// AH-1 (D649, D650): Ahead's one model, pure. ahead.load's items with my pending changes laid over them, grouped
// client › epic › feature › story in DevOps order, my rights on each, the gaps Fix next works through, and the filters
// Grid and Gantt share (client, epic, owner, has gaps, date range, text). Levels come from the process model (the
// item's level), never from type names.
import type { AheadItem, AheadLoad } from "../../actions/types.ts";
import type { AheadFilters, AheadOwner } from "../../plan/ahead-edit.ts";
import type { Assignee, ChangeField, DayHalf, StagedChange } from "../../plan/ahead-edit.ts";
import { gapsOf, type GapItem, type GapKind } from "../../plan/fixnext.ts";
import { isOpen as isOpenCategory } from "../../plan/process.ts";

export type LoadClient = AheadLoad["clients"][number];
export type Tier = "epic" | "feature" | "story";

/** An item's values as Ahead shows them: my pending change where there is one, else DevOps. */
export type Eff = { start: string | null; target: string | null; size: number | null; assignee: Assignee };

export type Row = {
  key: string;
  clientKey: string;
  item: AheadItem;
  tier: Tier;
  depth: number;
  eff: Eff;
  /** The half-days FocusTime keeps (pending first, then kept). */
  startHalf: DayHalf | null;
  targetHalf: DayHalf | null;
  pending: Partial<Record<ChangeField, StagedChange>>;
  conflict: boolean;
  editable: boolean;
  /** The fields this item's type has in its process. */
  has: Record<ChangeField, boolean>;
  sizeLabel: string | null;
  hint: string | null;
  gaps: GapKind[];
  /** Assigned to me (DevOps or pending). */
  mine: boolean;
  /** Shown only so the rows under it have their place (the filter didn't pick it). */
  context: boolean;
  openChildren: number;
};

export type Group = { client: LoadClient; rows: Row[] };

export const DEFAULT_FILTERS: AheadFilters = { owner: {}, clients: [], epic: null, gaps: false, from: null, to: null, q: "", states: [] };

const TIER: Record<string, Tier | undefined> = { top: "epic", parent: "feature", child: "story" };
export const tierOf = (i: Pick<AheadItem, "level">): Tier | null => (i.level ? (TIER[i.level] ?? null) : null);
/** Open work, by the one rule (WT-1): Resolved, Completed and Removed have nothing left to fix. */
export const isOpen = (i: AheadItem) => isOpenCategory(i.stateCategory);
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The owner filter for a client: what I chose, else All for a lead and Mine for everyone else (D650). */
export const ownerOf = (f: AheadFilters, c: Pick<LoadClient, "clientKey" | "lead">): AheadOwner => f.owner[c.clientKey] ?? (c.lead ? "all" : "mine");

function effOf(i: AheadItem, p: Row["pending"]): Eff {
  return {
    start: p.start ? (p.start.value as string | null) : i.start,
    target: p.target ? (p.target.value as string | null) : i.target,
    size: p.size ? (p.size.value as number | null) : i.size,
    assignee: p.assignee ? (p.assignee.value as Assignee) : i.assignee?.email ? { email: i.assignee.email.toLowerCase(), name: i.assignee.name } : null,
  };
}

/** Every client's rows in tree order, before filtering. */
export function buildRows(load: AheadLoad, c: LoadClient): Row[] {
  const items = c.items.filter((i) => tierOf(i));
  const byId = new Map(items.map((i) => [i.id, i]));
  const kids = new Map<number | null, AheadItem[]>();
  for (const i of items) {
    const p = i.parentId !== null && byId.has(i.parentId) ? i.parentId : null;
    (kids.get(p) ?? kids.set(p, []).get(p)!).push(i);
  }
  const editable = new Set(c.editable);
  const me = lc(c.me);
  const changes = load.changes.filter((x) => x.clientKey === c.clientKey);
  const halves = load.halves.filter((h) => h.clientKey === c.clientKey);
  const out: Row[] = [];
  const visit = (i: AheadItem, depth: number) => {
    const pending: Row["pending"] = {};
    for (const x of changes.filter((x) => x.itemId === i.id)) pending[x.field] = x;
    const eff = effOf(i, pending);
    const half = (f: "start" | "target") => pending[f]?.half ?? halves.find((h) => h.itemId === i.id && h.field === f && h.day === eff[f])?.half ?? null;
    const tier = tierOf(i)!;
    const open = (kids.get(i.id) ?? []).filter(isOpen).length;
    const has = { start: !!c.startFields[i.type], target: !!c.targetFields[i.type], size: !!c.sizeFields[i.type], assignee: true };
    const sizeRef = c.sizeFields[i.type];
    const gi: GapItem = { clientKey: c.clientKey, id: i.id, open: isOpen(i), needsBreakdown: tier !== "story", openChildren: open, startField: c.startFields[i.type] ?? null, targetField: c.targetFields[i.type] ?? null, sizeField: sizeRef ?? null, child: tier === "story", start: i.start, target: i.target, size: i.size, assigneeEmail: i.assignee?.email ?? null, canEdit: editable.has(i.id) };
    out.push({
      key: `${c.clientKey}:${i.id}`,
      clientKey: c.clientKey,
      item: i,
      tier,
      depth,
      eff,
      startHalf: eff.start ? half("start") : null,
      targetHalf: eff.target ? half("target") : null,
      pending,
      conflict: changes.some((x) => x.itemId === i.id && x.theirs !== undefined),
      editable: editable.has(i.id),
      has,
      sizeLabel: sizeRef ? (c.fieldNames[sizeRef] ?? sizeRef.split(".").at(-1) ?? null) : null,
      hint: c.hints[i.id]?.text ?? null,
      gaps: gapsOf(gi, changes),
      mine: !!me && lc(eff.assignee?.email) === me,
      context: false,
      openChildren: open,
    });
    for (const k of kids.get(i.id) ?? []) visit(k, depth + 1);
  };
  for (const i of kids.get(null) ?? []) visit(i, 0);
  return out;
}

/** The rows the filters keep, with their ancestors as context so the tree still reads. */
export function filterRows(rows: readonly Row[], c: LoadClient, f: AheadFilters, o: { stories: boolean }): Row[] {
  const byId = new Map(rows.map((r) => [r.item.id, r]));
  const parentOf = (r: Row) => (r.item.parentId !== null ? byId.get(r.item.parentId) ?? null : null);
  const ancestors = (r: Row) => {
    const out: Row[] = [];
    for (let p = parentOf(r); p; p = parentOf(p)) out.push(p);
    return out;
  };
  const owner = ownerOf(f, c);
  const mineIds = new Set(rows.filter((r) => r.mine).map((r) => r.item.id));
  const pick = (r: Row): boolean => {
    if (!o.stories && r.tier === "story") return false;
    if (owner === "mine" && !(r.mine || ancestors(r).some((a) => mineIds.has(a.item.id) && a.tier !== "story"))) return false;
    // Contributing (as Roadmap had it): the features and epics my stories are under, with those stories.
    if (owner === "contributing" && !((r.mine && r.tier === "story") || rows.some((x) => x.mine && x.tier === "story" && ancestors(x).includes(r)))) return false;
    if (f.epic && !(r.key === f.epic || ancestors(r).some((a) => a.key === f.epic))) return false;
    if (f.gaps && !r.gaps.length) return false;
    if (f.from || f.to) {
      const a = r.eff.start ?? r.eff.target, b = r.eff.target ?? r.eff.start;
      if (!a || !b) return false;
      if (f.from && b < f.from) return false;
      if (f.to && a > f.to) return false;
    }
    if (f.q.trim()) {
      const q = lc(f.q);
      if (!lc(r.item.title).includes(q) && `#${r.item.id}` !== q && String(r.item.id) !== q) return false;
    }
    return true;
  };
  const keep = new Set<number>();
  const ctx = new Set<number>();
  for (const r of rows)
    if (pick(r)) {
      keep.add(r.item.id);
      for (const a of ancestors(r)) if (!keep.has(a.item.id)) ctx.add(a.item.id);
    }
  return rows.filter((r) => keep.has(r.item.id) || ctx.has(r.item.id)).map((r) => (keep.has(r.item.id) ? r : { ...r, context: true }));
}

/** Clients the client filter keeps, each with its filtered rows; clients that failed keep their message. */
export function groups(load: AheadLoad, f: AheadFilters, o: { stories: boolean }): Group[] {
  return load.clients.filter((c) => !f.clients.length || f.clients.includes(c.clientKey)).map((c) => ({ client: c, rows: c.status === "ok" ? filterRows(buildRows(load, c), c, f, o) : [] }));
}

/** The epics a client filter offers (key, title), across the shown clients. */
export function epicsOf(load: AheadLoad, f: AheadFilters): { key: string; label: string }[] {
  return load.clients.filter((c) => !f.clients.length || f.clients.includes(c.clientKey)).flatMap((c) => c.items.filter((i) => tierOf(i) === "epic").map((i) => ({ key: `${c.clientKey}:${i.id}`, label: `${load.clients.length > 1 ? `${c.clientName} · ` : ""}${i.title}` })));
}

/** For Fix next: an item's due date, its own target else its parent's (pending first). */
export function dueOfRow(rows: readonly Row[], r: Row): string | null {
  if (r.eff.target) return r.eff.target;
  const p = r.item.parentId !== null ? rows.find((x) => x.item.id === r.item.parentId) : undefined;
  return p ? dueOfRow(rows, p) : null;
}
