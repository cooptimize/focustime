// BH-1: Ahead › Backlog. Pure: each client's open items at one tier (epics, features or stories), in that project's own
// backlog order (the order field DV-1 stores per process: StackRank or BacklogPriority, ascending; a project with none
// is ranked by target date and says so), within Cooptimize's scope (AH-2), with the owner filter Grid uses. Read-only
// order: nothing here reorders anything.
//
// Stale: an open item with no change in DevOps for N weeks (the person's Settings › Backlog, 6 by default). "No change"
// is DevOps's own System.ChangedDate, which every stored item has; DV-1's change log (30 days) only says what the last
// change was. Done items are never stale. An item whose changed date isn't known is never stale.
//
// Bulk actions decide here, per item, what would be staged in Ahead's change set or why the item is skipped; the
// server applies the same rights and field checks as a single edit (actions/ahead-actions.ts ahead.stage_bulk).
import type { AheadFilters } from "./ahead-edit.ts";
import { buildRows, filterRows, isOpen, ownerOf, type LoadClient, type Row, type Tier } from "./ahead-model.ts";
import type { AheadLoad } from "../actions/types.ts";

export type AheadSettings = { staleWeeks: number };
export const DEFAULT_AHEAD: AheadSettings = { staleWeeks: 6 };

/** What the change log says the last change was (within its 30 days). */
export type LastChangeKind = "assignee" | "target_date" | "start_date" | "size" | "state" | "new_child" | "comments" | "removed";
export type LastChange = { kind: LastChangeKind; at: string };
export const LAST_WORDS: Record<LastChangeKind, string> = { assignee: "assigned", target_date: "target date", start_date: "start date", size: "size", state: "state", new_child: "new child", comments: "comment", removed: "removed" };

/** The change log keeps this many days. */
export const LOG_DAYS = 30;

export { ageDays, isStale } from "./stale.ts";
import { ageDays, isStale } from "./stale.ts";

/** "today", "yesterday", "5 days ago", "7 weeks ago", "5 months ago"; "not known". */
export function ageText(days: number | null): string {
  if (days === null) return "not known";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 7 * 13) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** The Last change cell: the age, and what changed when the change log still has it. */
export function lastText(days: number | null, last: LastChange | null): string {
  const age = ageText(days);
  return last && days !== null && days <= LOG_DAYS ? `${age} · ${LAST_WORDS[last.kind]}` : age;
}

export type BacklogFilters = AheadFilters & { tier?: Tier; stale?: boolean };
export type BacklogRow = Row & { rank: number; stale: boolean; age: number | null; last: LastChange | null };
export type BacklogGroup = {
  client: LoadClient;
  rows: BacklogRow[];
  /** Ranked by the project's backlog order, or by target date when it has no order field. */
  rankedBy: "backlog" | "target";
  /** Open items at this tier in scope, before the owner and stale filters. */
  total: number;
  /** Stale items after the owner filter (what the Stale filter would show). */
  stale: number;
};

/** The project's backlog order: the order field ascending (unset last), then target date, then id. Without one: target date, then id. */
export function backlogOrder<T extends { item: { id: number; order?: number | null }; eff: { target: string | null } }>(rows: readonly T[], byOrder: boolean): T[] {
  const num = (v: number | null | undefined) => (typeof v === "number" ? v : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => {
    if (byOrder) {
      const d = num(a.item.order) - num(b.item.order);
      if (d) return d;
    }
    const ta = a.eff.target ?? "9999", tb = b.eff.target ?? "9999";
    return ta < tb ? -1 : ta > tb ? 1 : a.item.id - b.item.id;
  });
}

/** One client's backlog at a tier. */
export function backlogOf(load: AheadLoad, c: LoadClient, f: BacklogFilters, o: { staleWeeks: number; last?: Readonly<Record<number, LastChange>> }): BacklogGroup {
  const tier = f.tier ?? "story";
  const byOrder = !!c.orderField;
  const all = buildRows(load, c);
  // Rank among the open items at this tier in Cooptimize's scope: the backlog as DevOps orders it.
  const ranked = backlogOrder(all.filter((r) => r.tier === tier && isOpen(r.item) && r.item.inScope !== false), byOrder);
  const owner = ownerOf(f, c);
  // AH-6: every Ahead filter applies here too (Stale is counted first, then applied below).
  const kept = new Set(filterRows(all, c, { ...f, owner: { [c.clientKey]: owner }, stale: false }, { stories: true, today: load.today, staleWeeks: o.staleWeeks }).filter((r) => !r.context).map((r) => r.key));
  const rows: BacklogRow[] = ranked
    .map((r, i) => {
      const age = ageDays(r.item.changedAt, load.today);
      return { ...r, rank: i + 1, age, stale: isStale(r.item, load.today, o.staleWeeks), last: o.last?.[r.item.id] ?? null };
    })
    .filter((r) => kept.has(r.key));
  const stale = rows.filter((r) => r.stale).length;
  return { client: c, rows: f.stale ? rows.filter((r) => r.stale) : rows, rankedBy: byOrder ? "backlog" : "target", total: ranked.length, stale };
}

/** The clients the client filter keeps, each with its backlog; a client that failed keeps its message and no rows. */
export function backlogGroups(load: AheadLoad, f: BacklogFilters, o: { staleWeeks: number; last?: Readonly<Record<string, Readonly<Record<number, LastChange>>>> }): BacklogGroup[] {
  return load.clients
    .filter((c) => !f.clients.length || f.clients.includes(c.clientKey))
    .map((c) => (c.status === "ok" ? backlogOf(load, c, f, { staleWeeks: o.staleWeeks, ...(o.last?.[c.clientKey] ? { last: o.last[c.clientKey] } : {}) }) : { client: c, rows: [], rankedBy: c.orderField ? "backlog" : "target", total: 0, stale: 0 }));
}

// ---- Bulk actions (through Ahead's change set) ----

/**
 * BH-1's four (push, move, set_missing, assign_me) and ED-2's four: Assign to… (someone on the client's DevOps
 * project), State… (a state of the item's own type), Size… (the process's size field) and Move to… (one new parent).
 */
export type BulkOp =
  | { kind: "push"; weeks: 2 | 4 }
  | { kind: "move"; date: string }
  | { kind: "set_missing"; date: string }
  | { kind: "assign_me" }
  | { kind: "assign"; email: string | null; name: string }
  | { kind: "state"; state: string }
  | { kind: "size"; value: number | null }
  | { kind: "parent"; parentId: number | null; title: string };
export const BULK_WORDS: Record<BulkOp["kind"], string> = { push: "Push target date", move: "Target date", set_missing: "Set a target date", assign_me: "Assign to me", assign: "Assign to…", state: "State…", size: "Size…", parent: "Move to…" };

/** What a bulk action needs to know of one item. */
export type BulkItem = {
  id: number;
  type: string;
  editable: boolean;
  /** Why I can't change it (the shared rights' note). */
  note: string;
  hasTarget: boolean;
  /** Its target as Ahead shows it (my pending change first). */
  target: string | null;
  /** Assigned to me now (DevOps or pending). */
  mine: boolean;
  /** ED-2: who has it now (DevOps or pending), lowercased; null: nobody. */
  assignee?: string | null;
  /** ED-2: its state now, and the states its own type takes in the process. */
  state?: string;
  states?: readonly string[];
  /** ED-2: its type has the process's size field; its size now. */
  hasSize?: boolean;
  size?: number | null;
  /** ED-2: its parent now, and why it can't go under the parent asked for (the move rule's words; null: it can). */
  parentId?: number | null;
  moveProblem?: string | null;
};
export type BulkStep =
  | { field: "target"; value: string }
  | { field: "assignee"; value: "me" }
  | { field: "assignee"; value: { email: string; name: string } | null }
  | { field: "state"; value: string }
  | { field: "size"; value: number | null }
  | { field: "parent"; value: number | null };
export type BulkDecision = { ok: true; step: BulkStep } | { ok: false; reason: string };

const longDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const lc = (x: string | null | undefined) => (x ?? "").trim().toLowerCase();

/** One item: the change to stage, or why it's skipped (in words a person reads). */
export function bulkDecide(i: BulkItem, op: BulkOp, project: string): BulkDecision {
  if (!i.editable) return { ok: false, reason: i.note };
  if (op.kind === "assign_me") return i.mine ? { ok: false, reason: "Already yours" } : { ok: true, step: { field: "assignee", value: "me" } };
  if (op.kind === "assign") {
    if (lc(i.assignee) === lc(op.email)) return { ok: false, reason: op.email ? `Already assigned to ${op.name}` : "Already unassigned" };
    return { ok: true, step: { field: "assignee", value: op.email ? { email: op.email, name: op.name } : null } };
  }
  if (op.kind === "state") {
    // The spelling the type's own process has; a state the type doesn't take is never written.
    const st = (i.states ?? []).find((x) => lc(x) === lc(op.state));
    if (!st) return { ok: false, reason: `${op.state} isn't a state of ${i.type} in ${project}'s process` };
    if (lc(i.state) === lc(st)) return { ok: false, reason: `Already ${st}` };
    return { ok: true, step: { field: "state", value: st } };
  }
  if (op.kind === "size") {
    if (!i.hasSize) return { ok: false, reason: `${i.type} has no size in ${project}'s process` };
    if ((i.size ?? null) === op.value) return { ok: false, reason: op.value === null ? "Already has no size" : "Already that size" };
    return { ok: true, step: { field: "size", value: op.value } };
  }
  if (op.kind === "parent") {
    if (i.moveProblem) return { ok: false, reason: i.moveProblem };
    if ((i.parentId ?? null) === op.parentId) return { ok: false, reason: op.parentId === null ? "Already has no parent" : "Already under it" };
    return { ok: true, step: { field: "parent", value: op.parentId } };
  }
  if (!i.hasTarget) return { ok: false, reason: `${i.type} has no target date in ${project}'s process` };
  if (op.kind === "push") {
    if (!i.target) return { ok: false, reason: "No target date to push. Use Set a target date" };
    return { ok: true, step: { field: "target", value: Temporal.PlainDate.from(i.target).add({ weeks: op.weeks }).toString() } };
  }
  if (op.kind === "set_missing" && i.target) return { ok: false, reason: `Already has a target date (${longDay(i.target)})` };
  if (i.target === op.date) return { ok: false, reason: "Already has that target date" };
  return { ok: true, step: { field: "target", value: op.date } };
}

/** "Pushed 3 target dates by 2 weeks", "2 skipped" etc., for the line after a bulk action. ED-2's say "Staged N, skipped M". */
export function bulkSummary(op: BulkOp, staged: number, skipped: number): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (op.kind === "assign" || op.kind === "state" || op.kind === "size" || op.kind === "parent") {
    const what =
      op.kind === "assign" ? (op.email ? `Assign to ${op.name}` : "Unassign")
      : op.kind === "state" ? `State ${op.state}`
      : op.kind === "size" ? (op.value === null ? "No size" : `Size ${op.value}`)
      : op.parentId === null ? "No parent" : `Move under ${op.title || `#${op.parentId}`}`;
    return `${what}: staged ${staged}, skipped ${skipped}. Nothing is written until you save.`;
  }
  const what =
    op.kind === "push" ? `${n(staged, "target date", "target dates")} pushed by ${op.weeks} weeks`
    : op.kind === "assign_me" ? `${n(staged, "item", "items")} assigned to you`
    : `${n(staged, "target date", "target dates")} set to ${longDay(op.date)}`;
  return `${what}, ready to save${skipped ? ` · ${skipped} skipped` : ""}`;
}

/**
 * ED-2: State… over a mixed selection: the states every ticked row's type takes (these can be picked), and the rest
 * with which types they fit, in the first type's own order then the others'. Names come from the process, never a list.
 */
export function commonStates(rows: readonly { type: string; states: readonly string[] }[]): { common: string[]; partial: { state: string; types: string[]; fits: number }[] } {
  const order: string[] = [];
  for (const r of rows) for (const s of r.states) if (!order.some((x) => lc(x) === lc(s))) order.push(s);
  const takes = (r: { states: readonly string[] }, s: string) => r.states.some((x) => lc(x) === lc(s));
  const common = order.filter((s) => rows.every((r) => takes(r, s)));
  const partial = order.filter((s) => !common.includes(s)).map((s) => ({ state: s, types: [...new Set(rows.filter((r) => takes(r, s)).map((r) => r.type))], fits: rows.filter((r) => takes(r, s)).length }));
  return { common, partial };
}

/**
 * ED-2: Move to… needs the ticked rows at one level of one client (one picker of parents fits them all). Null: it
 * does; otherwise the reason the bar shows.
 */
export function bulkMoveBlock(rows: readonly { clientKey: string; rung: number | null }[]): string | null {
  if (!rows.length) return null;
  if (new Set(rows.map((r) => r.clientKey)).size > 1) return "Move to… needs rows from one client. A move never crosses clients";
  if (new Set(rows.map((r) => r.rung)).size > 1) return "Move to… needs rows at one level, so one parent fits them all";
  if (rows[0]!.rung === null || rows[0]!.rung === 0) return "These rows have no level above them, so there is no parent to move them under";
  return null;
}

/** Plan it: the Monday after this week's. */
export function nextMonday(today: string): string {
  const d = Temporal.PlainDate.from(today);
  return d.add({ days: 8 - d.dayOfWeek }).toString();
}
