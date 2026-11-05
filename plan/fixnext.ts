// AH-1: Fix next (D662), pure. Readiness gaps as actions, one at a time: Break down (a feature or epic with no open
// items under it), Set dates, Assign, Size. Only items the person may change. Ordered by the item's target date (soonest
// first; none last), then the gap (Break down, Set dates, Assign, Size), then id. A gap a pending change already fills
// leaves the queue; Skip puts one aside for the session.
import type { ChangeField, StagedChange } from "./ahead-edit.ts";

export const GAP_KINDS = ["needs_stories", "no_dates", "unassigned", "unsized"] as const;
export type GapKind = (typeof GAP_KINDS)[number];
export const GAP_ACTION: Record<GapKind, string> = { needs_stories: "Break down", no_dates: "Set dates", unassigned: "Assign", unsized: "Size" };
export const GAP_WORDS: Record<GapKind, string> = { needs_stories: "Needs stories", no_dates: "No dates", unassigned: "Unassigned", unsized: "Unsized" };

/** What the queue needs to know of an item (Ahead's rows carry it). */
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

/** The gaps an item has now, with my pending changes counted as filled. */
export function gapsOf(i: GapItem, pending: readonly Pick<StagedChange, "clientKey" | "itemId" | "field" | "value">[] = []): GapKind[] {
  if (!i.open || !i.canEdit) return [];
  const mine = (f: ChangeField) => pending.find((c) => c.clientKey === i.clientKey && c.itemId === i.id && c.field === f);
  const has = (f: ChangeField, now: unknown) => {
    const p = mine(f);
    return p ? p.value !== null : now !== null && now !== undefined;
  };
  const out: GapKind[] = [];
  if (i.needsBreakdown && i.openChildren === 0) out.push("needs_stories");
  if (!i.child && ((i.targetField && !has("target", i.target)) || (i.startField && !has("start", i.start)))) out.push("no_dates");
  if (!has("assignee", i.assigneeEmail)) out.push("unassigned");
  if (i.child && i.sizeField && !has("size", i.size)) out.push("unsized");
  return out;
}

export type QueueEntry = { clientKey: string; itemId: number; gap: GapKind; key: string };
export const entryKey = (clientKey: string, itemId: number, gap: GapKind) => `${clientKey}:${itemId}:${gap}`;

/** The whole queue, in order, without the skipped entries. */
export function fixQueue(items: readonly GapItem[], pending: Parameters<typeof gapsOf>[1] = [], skipped: ReadonlySet<string> = new Set(), dueOf: (i: GapItem) => string | null = (i) => i.target): QueueEntry[] {
  const rank = (g: GapKind) => GAP_KINDS.indexOf(g);
  const out: (QueueEntry & { due: string | null })[] = [];
  for (const i of items)
    for (const g of gapsOf(i, pending)) {
      const key = entryKey(i.clientKey, i.id, g);
      if (!skipped.has(key)) out.push({ clientKey: i.clientKey, itemId: i.id, gap: g, key, due: dueOf(i) });
    }
  return out
    .sort((a, b) => (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0) || rank(a.gap) - rank(b.gap) || a.itemId - b.itemId || a.clientKey.localeCompare(b.clientKey))
    .map(({ due: _d, ...e }) => e);
}
