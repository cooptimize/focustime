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

export type BulkOp = { kind: "push"; weeks: 2 | 4 } | { kind: "move"; date: string } | { kind: "set_missing"; date: string } | { kind: "assign_me" };
export const BULK_WORDS: Record<BulkOp["kind"], string> = { push: "Push target date", move: "Target date", set_missing: "Set a target date", assign_me: "Assign to me" };

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
};
export type BulkStep = { field: "target"; value: string } | { field: "assignee"; value: "me" };
export type BulkDecision = { ok: true; step: BulkStep } | { ok: false; reason: string };

const longDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });

/** One item: the change to stage, or why it's skipped (in words a person reads). */
export function bulkDecide(i: BulkItem, op: BulkOp, project: string): BulkDecision {
  if (!i.editable) return { ok: false, reason: i.note };
  if (op.kind === "assign_me") return i.mine ? { ok: false, reason: "Already yours" } : { ok: true, step: { field: "assignee", value: "me" } };
  if (!i.hasTarget) return { ok: false, reason: `${i.type} has no target date in ${project}'s process` };
  if (op.kind === "push") {
    if (!i.target) return { ok: false, reason: "No target date to push. Use Set a target date" };
    return { ok: true, step: { field: "target", value: Temporal.PlainDate.from(i.target).add({ weeks: op.weeks }).toString() } };
  }
  if (op.kind === "set_missing" && i.target) return { ok: false, reason: `Already has a target date (${longDay(i.target)})` };
  if (i.target === op.date) return { ok: false, reason: "Already has that target date" };
  return { ok: true, step: { field: "target", value: op.date } };
}

/** "Pushed 3 target dates by 2 weeks", "2 skipped" etc., for the line after a bulk action. */
export function bulkSummary(op: BulkOp, staged: number, skipped: number): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const what =
    op.kind === "push" ? `${n(staged, "target date", "target dates")} pushed by ${op.weeks} weeks`
    : op.kind === "assign_me" ? `${n(staged, "item", "items")} assigned to you`
    : `${n(staged, "target date", "target dates")} set to ${longDay(op.date)}`;
  return `${what}, ready to save${skipped ? ` · ${skipped} skipped` : ""}`;
}

/** Plan it: the Monday after this week's. */
export function nextMonday(today: string): string {
  const d = Temporal.PlainDate.from(today);
  return d.add({ days: 8 - d.dayOfWeek }).toString();
}
