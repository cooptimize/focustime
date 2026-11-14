// UI-B: the "now" line on today's column (Week's Board, Today's agenda, Plan today). Pure: the caller passes the
// clock and the person's zone; the line is drawn only on today, and only when the shown week has today. NL-1: and only
// on the block whose hours the clock is inside; nowhere before, after or between the day's blocks.
import type { IsoDate } from "../week/types.ts";

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
type View = { start: string; end: string };
type Block = View & { view: View; off?: boolean };
type DayLike = { date: IsoDate; am: Block; pm: Block; eve: Block | null; pto: unknown; kind: string };

/** Where on a rail (0 at its start, up to 1 at its end) now falls; null outside it. The end belongs to the next rail. */
export function railAt(view: View, now: string): number | null {
  const [a, b, t] = [ms(view.start), ms(view.end), ms(now)];
  if (b <= a || t < a || t >= b) return null;
  return (t - a) / (b - a);
}

/** The date in the person's zone. */
export const dateIn = (now: string, tz: string): IsoDate => Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainDate().toString();

/** "2:14", in the person's zone. */
export function nowClock(now: string, tz: string): string {
  return Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/, "");
}

/** NL-1: whether the clock is inside a block's own hours (its working bounds, not the wider timeline): from its start,
 * up to but not including its end. The one rule for every "now" mark, line, tick, edge and row. */
export function insideHours(hours: View, now: string): boolean {
  const t = ms(now);
  return ms(hours.start) <= t && t < ms(hours.end);
}

export type NowSpot =
  /** On the rail of the block under way, at a fraction of the rail. */
  | { kind: "rail"; half: "AM" | "PM" | "EVE"; at: number }
  /** NL-1: today, but no block is under way (before the first, after the last, or between two): nothing draws a mark.
   * NM-1: a day drawn as one cell (PTO, a catch-up day with no working hours) has no block, so it is always this.
   * Kept apart from null so a block that has ended still reads as past. */
  | { kind: "none" };

/**
 * Where today's line goes in a day column; null when the day isn't today. `whole` says the day is one cell. NL-1: a
 * block gets the line only while the clock is inside its own hours (start to end, the end belonging to the next block);
 * before the first block, after the last and in a gap between two there is no line anywhere (`none`). NM-1: a cell that
 * isn't a block (a PTO day, a catch-up day with no working hours) never gets one: the line ran across its title.
 */
export function nowSpot(day: DayLike, now: string, tz: string, whole: boolean): NowSpot | null {
  if (day.date !== dateIn(now, tz)) return null;
  const rails = [["AM", day.am], ["PM", day.pm], ...(day.eve ? [["EVE", day.eve] as const] : [])] as const;
  if (whole) return { kind: "none" };
  for (const [half, slot] of rails) {
    // A half with no working hours (a workday with none) keeps nominal bounds for its shape; it is never under way.
    if (slot.off || !insideHours(slot, now)) continue;
    const at = railAt(slot.view, now);
    if (at !== null) return { kind: "rail", half, at };
  }
  return { kind: "none" };
}

/** Where the now row goes in a time-ordered agenda (row starts as ISO times or ms): before the first row that starts at
 * or after now (a free gap from now on starts at now); null when the agenda isn't today's. */
export function agendaNowIndex(starts: readonly (string | number)[], now: string, date: IsoDate, tz: string): number | null {
  if (date !== dateIn(now, tz)) return null;
  const t = ms(now);
  const i = starts.findIndex((s) => (typeof s === "number" ? s : ms(s)) >= t);
  return i < 0 ? starts.length : i;
}

/** Whether a block's agenda gets the now row: only the block under way (NL-1: never the morning before the day starts). */
export function ownsNow(block: View & { off?: boolean }, now: string): boolean {
  return !block.off && insideHours(block, now);
}

/** HK-3: a box on a rail, in pixels from its top left. */
export type Box = { top: number; bottom: number; left: number; right: number };
/** Where the now line's time pill goes on a compact rail: on the line, just above or below an hour mark, or at the right end. */
export type PillSpot = { spot: "center" | "above" | "below" | "end"; top: number };

const hits = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * HK-3: the pill sits centered on the line unless that covers an hour mark's label; then just above or just below that
 * label (the nearer one that covers nothing and stays on the rail), else at the rail's right end, centered on the line
 * (on a narrow card, where neither fits). The line itself never moves. `top` is the pill's top in rail pixels.
 */
export function pillSpot(o: { line: number; pill: { width: number; height: number }; left: number; rail: { width: number; height: number }; labels: readonly Box[] }): PillSpot {
  const { line, pill, left, rail, labels } = o;
  const at = (top: number, l = left): Box => ({ top, bottom: top + pill.height, left: l, right: l + pill.width });
  const free = (b: Box) => b.top >= 0 && b.bottom <= rail.height && !labels.some((l) => hits(b, l));
  const center = line - pill.height / 2;
  if (!labels.some((l) => hits(at(center), l))) return { spot: "center", top: center };
  const covered = labels.filter((l) => hits(at(center), l));
  const tries: PillSpot[] = covered.flatMap((l) => [
    { spot: "above" as const, top: l.top - 1 - pill.height },
    { spot: "below" as const, top: l.bottom + 1 },
  ]);
  tries.sort((a, b) => Math.abs(a.top + pill.height / 2 - line) - Math.abs(b.top + pill.height / 2 - line));
  const fit = tries.find((t) => free(at(t.top)));
  return fit ?? { spot: "end", top: center };
}
