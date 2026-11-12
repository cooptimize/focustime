// WK-5 (undoes QT-1's one-line fold for blocks with to-dos): a past block lists its to-dos again, one line each:
// unfinished ones plain, done ones ticked and quiet, a moved one with where it went ("→ Thu"). Six at most, then
// "N more", which opens the block panel. A past block with nothing on it stays one quiet line ("Nothing planned"). Pure.
import type { Half, IsoDate } from "../week/types.ts";

/** The most to-do lines a past block lists before "N more". */
export const PAST_ROWS = 6;

export type PastPick = { id: number; status: string; carriedTo?: { date: IsoDate; half: Half } | null };
export type PastRows<P> = { rows: P[]; more: number; empty: boolean };

/**
 * The rows a past block lists: unfinished first (what still needs me), then done, then moved on, each in the order
 * given (the card's clock order). Dropped and removed to-dos are never rows.
 */
export function pastRows<P extends PastPick>(picks: readonly P[]): PastRows<P> {
  const open = picks.filter((p) => p.status === "planned");
  const done = picks.filter((p) => p.status === "done");
  const moved = picks.filter((p) => p.status === "moved" && !!p.carriedTo);
  const all = [...open, ...done, ...moved];
  return { rows: all.slice(0, PAST_ROWS), more: Math.max(0, all.length - PAST_ROWS), empty: all.length === 0 };
}

/** Where a moved to-do went, in Week's short form: "→ Thu", or "→ Mon 16" in another week. */
export function movedTo(to: { date: IsoDate }, weekStart: IsoDate): string {
  const d = Temporal.PlainDate.from(to.date);
  const day = d.toLocaleString("en-US", { weekday: "short" });
  const monday = Temporal.PlainDate.from(weekStart);
  const inWeek = Temporal.PlainDate.compare(d, monday) >= 0 && Temporal.PlainDate.compare(d, monday.add({ days: 6 })) <= 0;
  return `→ ${day}${inWeek ? "" : ` ${d.day}`}`;
}
