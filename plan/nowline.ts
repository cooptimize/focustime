// UI-B: the "now" line on today's column (Week's Board, Today's agenda, Plan today). Pure: the caller passes the
// clock and the person's zone; the line is drawn only on today, and only when the shown week has today.
import type { IsoDate } from "../week/types.ts";

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
type View = { start: string; end: string };
type DayLike = { date: IsoDate; am: { view: View }; pm: { view: View }; eve: { view: View } | null; pto: unknown; kind: string };

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

export type NowSpot =
  /** On one of the day's rails, at a fraction of it. */
  | { kind: "rail"; half: "AM" | "PM" | "EVE"; at: number }
  /** Before the first rail or after the last: the line sits in that edge, with the time. */
  | { kind: "before" }
  | { kind: "after" }
  /** A PTO or catch-up day drawn as one cell: a thinner line at a fraction of the day's range. */
  | { kind: "whole"; at: number; edge: "before" | "after" | null };

/** Where today's line goes in a day column; null when the day isn't today. `whole` says the day is one cell. */
export function nowSpot(day: DayLike, now: string, tz: string, whole: boolean): NowSpot | null {
  if (day.date !== dateIn(now, tz)) return null;
  const rails = [["AM", day.am.view], ["PM", day.pm.view], ...(day.eve ? [["EVE", day.eve.view] as const] : [])] as const;
  const first = ms(rails[0][1].start);
  const last = ms(rails[rails.length - 1]![1].end);
  const t = ms(now);
  if (whole) {
    const edge = t < first ? "before" : t >= last ? "after" : null;
    return { kind: "whole", at: edge === "before" ? 0 : edge === "after" ? 1 : (t - first) / Math.max(1, last - first), edge };
  }
  for (const [half, view] of rails) {
    const at = railAt(view, now);
    if (at !== null) return { kind: "rail", half, at };
  }
  return t < first ? { kind: "before" } : { kind: "after" };
}

/** Where the now row goes in a time-ordered agenda (row starts as ISO times or ms): before the first row that starts at
 * or after now (a free gap from now on starts at now); null when the agenda isn't today's. */
export function agendaNowIndex(starts: readonly (string | number)[], now: string, date: IsoDate, tz: string): number | null {
  if (date !== dateIn(now, tz)) return null;
  const t = ms(now);
  const i = starts.findIndex((s) => (typeof s === "number" ? s : ms(s)) >= t);
  return i < 0 ? starts.length : i;
}

/** Whether a block's agenda gets the now row: now is on its rail, or it is the morning and the day hasn't started. */
export function ownsNow(view: View, half: string, now: string): boolean {
  return railAt(view, now) !== null || (half === "AM" && ms(now) < ms(view.start));
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
