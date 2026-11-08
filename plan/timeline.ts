// TY-1: the arithmetic of timeboxing on Today's timeline: where a drop lands, keeping a stretch inside its block, the
// keyboard's nudges, the next free slot, a phone's 15-minute list and where a Timebox my day placeholder may go. Pure.
import type { SizeScale } from "./estimate.ts";
import type { Slot } from "../week/types.ts";
import { openGaps, type AgendaTimebox } from "./agenda.ts";
import { dragTimes, shift, timeChoices, type DragMode } from "./picktime.ts";
import { TIMEBOX_MIN, TIMEBOX_SNAP } from "./timebox.ts";
import type { Size } from "./types.ts";

export type Span = { start: string; end: string };
type View = Span;

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
const snapMs = TIMEBOX_SNAP * 60_000;
/** An instant in the person's zone, as a timebox stores it (local time with offset). */
const zoned = (x: number, tz: string) => Temporal.Instant.fromEpochMilliseconds(x).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" });

/**
 * A drop at `frac` of a block's hours (0 its top, 1 its bottom): starts on the nearest quarter hour, keeps `minutes` of
 * length, and stays whole inside the hours shown (moved up from the bottom edge; cut only when longer than the block).
 */
export function dropSpan(view: View, frac: number, minutes: number, tz: string): Span {
  const [a, b] = [ms(view.start), ms(view.end)];
  const len = Math.min(Math.max(TIMEBOX_MIN, minutes) * 60_000, Math.floor((b - a) / snapMs) * snapMs);
  const raw = a + Math.max(0, Math.min(1, frac)) * (b - a);
  // The view starts on a quarter hour in every Timelines range; ceil keeps a drop from going above it when it doesn't.
  const first = Math.ceil(a / snapMs) * snapMs;
  const lastStart = Math.floor((b - len) / snapMs) * snapMs;
  const start = Math.max(first, Math.min(lastStart, Math.round(raw / snapMs) * snapMs));
  return { start: zoned(start, tz), end: zoned(start + len, tz) };
}

/** A stretch kept inside the hours shown: a move slides back in whole; a resize is cut at the edge, never under 15 minutes. */
export function clampSpan(view: View, next: Span, mode: DragMode): Span {
  const [a, b] = [ms(view.start), ms(view.end)];
  if (mode === "move") {
    const over = Math.max(0, ms(next.end) - b);
    const under = Math.max(0, a - ms(next.start));
    const by = under > 0 ? under : -over;
    if (!by) return next;
    const minutes = by / 60_000;
    return { start: shift(next.start, minutes), end: shift(next.end, minutes) };
  }
  if (mode === "end" && ms(next.end) > b) return { start: next.start, end: shift(next.end, -(ms(next.end) - b) / 60_000) };
  if (mode === "start" && ms(next.start) < a) return { start: shift(next.start, (a - ms(next.start)) / 60_000), end: next.end };
  return next;
}

/** The keyboard: Up or Down moves 15 minutes, with Shift the end moves; null when it would change nothing. */
export function nudgeSpan(view: View, span: Span, dir: 1 | -1, resize: boolean): Span | null {
  const mode: DragMode = resize ? "end" : "move";
  const next = dragTimes(mode, span.start, span.end, dir * TIMEBOX_SNAP);
  if (!next) return null;
  const kept = clampSpan(view, next, mode);
  return ms(kept.start) === ms(span.start) && ms(kept.end) === ms(span.end) ? null : kept;
}

type Box = AgendaTimebox & { outlook: boolean };
type PickLike = { id: number; size: Size | null; minutes?: number | null };

/** T: the first place in the block's free time the pick fits, by the same rule as "+ time" and Timebox my day. */
export function nextFreeSpan(slot: Slot, timeboxes: readonly Box[], pick: PickLike, sizes: SizeScale, now?: string, minSizes?: Readonly<Record<Size, number>>): Span | null {
  const c = timeChoices(slot, timeboxes, pick, sizes, now, minSizes).find((x) => x.kind === "gap");
  return c ? { start: c.start, end: c.end } : null;
}

/** The phone's list: every quarter hour in the block's free time where the to-do fits whole (its own timebox counts as free). */
export function quarterStarts(slot: Slot, timeboxes: readonly AgendaTimebox[], own: AgendaTimebox | null, minutes: number, tz: string, now?: string): Span[] {
  const others = own ? timeboxes.filter((t) => t.id !== own.id) : timeboxes;
  const len = Math.max(TIMEBOX_MIN, minutes) * 60_000;
  const out: Span[] = [];
  for (const g of openGaps(slot, others, now)) {
    const end = ms(g.end);
    for (let t = Math.ceil(ms(g.start) / snapMs) * snapMs; t + len <= end; t += snapMs) out.push({ start: zoned(t, tz), end: zoned(t + len, tz) });
  }
  return out;
}

/**
 * A Timebox my day placeholder's rule, the same as the suggestions': it sits inside one open gap of its block, so it
 * never covers a busy meeting, personal event, unavailable time or another timebox or placeholder (an event shown as
 * free leaves its time free, as it always has).
 */
export function placeholderFits(slot: Slot, others: readonly AgendaTimebox[], span: Span, now?: string): boolean {
  if (ms(span.end) - ms(span.start) < TIMEBOX_MIN * 60_000) return false;
  return openGaps(slot, others, now).some((g) => ms(g.start) <= ms(span.start) && ms(span.end) <= ms(g.end));
}
