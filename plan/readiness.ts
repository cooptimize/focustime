// AH-7: Readiness you can finish, pure. Start here (the few most urgent entries across the clients shown), the counts
// by kind, my progress (pieces saved to DevOps this week, pieces waiting in the change set), and Skip that expires.
//
// The urgency rule (Start here, and its "Why these?"): dated soonest first (an item's target, else its start; an
// overdue date is the soonest of all; undated last), then nearest the top of its client's backlog (its place in that
// client's Readiness list, which is backlog order), then mine, then the item id.
import { GAP_KINDS, type FixEntry, type GapKind } from "./fixnext.ts";

export const START_N = 5;
export const START_RULE = "Dated soonest first (target, else start; undated last), then nearest the top of its backlog, then yours.";

/** What Start here weighs of an entry. */
export type Urgent = { entry: FixEntry; /** Its place in its client's Readiness list (backlog order). */ rank: number; date: string | null; mine: boolean };

const cmpDate = (a: string | null, b: string | null) => (a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0);

/** The `n` most urgent entries, in order. */
export function startHere(xs: readonly Urgent[], n = START_N): FixEntry[] {
  return [...xs]
    .sort((a, b) => cmpDate(a.date, b.date) || a.rank - b.rank || Number(b.mine) - Number(a.mine) || a.entry.itemId - b.entry.itemId)
    .slice(0, n)
    .map((x) => x.entry);
}

/** "Needs stories 23 · No target date 40 …": how many entries have each kind (an entry with two kinds counts in both). */
export function kindCounts(entries: readonly Pick<FixEntry, "gaps">[], kinds: readonly GapKind[] = GAP_KINDS): Record<GapKind, number> {
  const out = Object.fromEntries(GAP_KINDS.map((k) => [k, 0])) as Record<GapKind, number>;
  for (const e of entries) for (const g of e.gaps) if (kinds.includes(g)) out[g]++;
  return out;
}

/** A kind count clicked: that kind alone, or nothing when it was the only one on. */
export const toggleKind = (on: readonly GapKind[] | undefined, k: GapKind): GapKind[] => (on?.length === 1 && on[0] === k ? [] : [k]);

// ---- Skips: remembered per person in the plan store, each for 2 weeks ----

export const SKIPS_KEY = "ahead_skips";
export const SKIP_DAYS = 14;
/** "client:id" → the day it was skipped. */
export type Skips = Record<string, string>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[^\n]{1,100}:\d{1,10}$/;

/** The skips still on today (one made on Nov 2 is gone on Nov 16); anything unreadable is dropped. */
export function liveSkips(v: unknown, today: string): Skips {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const cut = Temporal.PlainDate.from(today).subtract({ days: SKIP_DAYS }).toString();
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => KEY.test(e[0]) && typeof e[1] === "string" && DAY.test(e[1]) && e[1] > cut && e[1] <= today));
}
/** When a skip ends: the day it's shown again. */
export const skipEnds = (on: string) => Temporal.PlainDate.from(on).add({ days: SKIP_DAYS }).toString();

// ---- Progress: pieces fixed (saved to DevOps) this week, and pieces waiting to save ----

export const FIXED_KEY = "ahead_fixed";
/** One piece saved: which item, which kind, when (an instant). */
export type Fixed = { k: string; g: GapKind; at: string };
const KEEP_DAYS = 14;

const isInstant = (s: string) => {
  try {
    Temporal.Instant.from(s);
    return true;
  } catch {
    return false;
  }
};
export function readFixed(v: unknown): Fixed[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Fixed => typeof x === "object" && x !== null && typeof x.k === "string" && (GAP_KINDS as readonly unknown[]).includes(x.g) && typeof x.at === "string" && isInstant(x.at));
}

/** Which kind a saved field fills, when it went from empty to set (a start alone isn't a target date). */
export function fills(field: "start" | "target" | "size" | "assignee" | "state", before: string | null | undefined, after: string | null | undefined): GapKind | null {
  const empty = (x: string | null | undefined) => x === null || x === undefined || x === "";
  if (!empty(before) || empty(after)) return null;
  return field === "target" ? "no_dates" : field === "assignee" ? "unassigned" : field === "size" ? "unsized" : null;
}

/** The log after a save: these pieces added (once per item and kind), anything older than 2 weeks gone. */
export function addFixed(log: readonly Fixed[], k: string, gs: readonly GapKind[], at: string): Fixed[] {
  const cut = Temporal.Instant.from(at).subtract({ hours: KEEP_DAYS * 24 });
  const kept = log.filter((x) => Temporal.Instant.compare(Temporal.Instant.from(x.at), cut) > 0 && !(x.k === k && gs.includes(x.g)));
  return [...kept, ...gs.map((g) => ({ k, g, at }))];
}
/** An undo landed: those pieces aren't fixed any more. */
export const dropFixed = (log: readonly Fixed[], k: string, gs: readonly GapKind[]): Fixed[] => log.filter((x) => !(x.k === k && gs.includes(x.g)));

/** How many pieces were saved since `since` (an instant: Monday's start in my zone). */
export const fixedSince = (log: readonly Fixed[], since: string) => log.filter((x) => Temporal.Instant.compare(Temporal.Instant.from(x.at), Temporal.Instant.from(since)) >= 0).length;

/** "12 fixed this week · 3 pending save", or null when both are 0. */
export function progressText(fixed: number, pending: number): string | null {
  if (!fixed && !pending) return null;
  return [fixed ? `${fixed} fixed this week` : null, pending ? `${pending} pending save` : null].filter(Boolean).join(" · ");
}
