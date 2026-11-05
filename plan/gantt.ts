// AH-1: Ahead's Gantt, pure. Half-day positions (DevOps stores the day; the half is FocusTime's, for display, D655),
// dragging a bar or an edge in half-days, the bars' dates with dashed edges where a date is missing, and the frozen row
// order that fixes the drag bug (D651): while a drag runs, rows keep their order and reloads wait; one reflow on drop.
import type { IsoDate } from "../week/types.ts";
import type { DayHalf as Half } from "./ahead-edit.ts";
import type { Scale } from "./ahead.ts";

/** A half-day: a date and AM or PM. */
export type HalfPos = { date: IsoDate; half: Half };

const EPOCH = Temporal.PlainDate.from("2000-01-03");
/** A half-day as a whole number (two per day), for arithmetic. */
export const halfIndex = (p: HalfPos): number => EPOCH.until(Temporal.PlainDate.from(p.date), { largestUnit: "days" }).days * 2 + (p.half === "PM" ? 1 : 0);
export const fromHalfIndex = (n: number): HalfPos => ({ date: EPOCH.add({ days: Math.floor(n / 2) }).toString(), half: ((n % 2) + 2) % 2 === 1 ? "PM" : "AM" });

/** A bar in half-days: from the start half to the end half, both included. */
export type HalfBar = { start: HalfPos; end: HalfPos };
export type DragMode = "move" | "start" | "end";

/** Dragging: the body moves both ends by whole half-days; an edge moves one, never past the other. */
export function dragHalves(b: HalfBar, mode: DragMode, halves: number): HalfBar {
  const n = Math.round(halves);
  const s = halfIndex(b.start), e = halfIndex(b.end);
  if (mode === "move") return { start: fromHalfIndex(s + n), end: fromHalfIndex(e + n) };
  if (mode === "start") return { start: fromHalfIndex(Math.min(s + n, e)), end: b.end };
  return { start: b.start, end: fromHalfIndex(Math.max(e + n, s)) };
}

const plus = (d: IsoDate, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString();

/** The left pixel of a half-day on a scale (a PM starts halfway through its day). */
export function halfX(scale: Pick<Scale, "x">, p: HalfPos): number {
  const a = scale.x(p.date);
  return p.half === "PM" ? a + (scale.x(plus(p.date, 1)) - a) / 2 : a;
}
/** The right pixel of a half-day (inclusive end). */
export const halfRight = (scale: Pick<Scale, "x">, p: HalfPos): number => halfX(scale, fromHalfIndex(halfIndex(p) + 1));

/** The half-day under a pixel. */
export function halfAt(scale: Pick<Scale, "x" | "dateAt">, px: number): HalfPos {
  const date = scale.dateAt(px);
  const a = scale.x(date), b = scale.x(plus(date, 1));
  return { date, half: b > a && px - a >= (b - a) / 2 ? "PM" : "AM" };
}

/** How many half-days a pointer moved, from where the drag began, snapped (whole half-days). */
export const halvesMoved = (scale: Pick<Scale, "x" | "dateAt">, fromPx: number, toPx: number): number => halfIndex(halfAt(scale, toPx)) - halfIndex(halfAt(scale, fromPx));

/**
 * A bar's two ends from DevOps (or my pending change), with an estimate where one is missing. Neither date: no bar
 * (the item goes under "No dates"). One date: the other comes from the estimate, drawn as a dashed edge.
 */
export type GanttBar = HalfBar & { dashedStart: boolean; dashedEnd: boolean };
export function ganttBar(i: { start: IsoDate | null; target: IsoDate | null; startHalf?: Half | null; targetHalf?: Half | null; estimate: { start: IsoDate; end: IsoDate } | null }): GanttBar | null {
  if (!i.start && !i.target) return null;
  const est = i.estimate;
  const startDate = i.start ?? (est && i.target && est.start <= i.target ? est.start : plus(i.target!, -13));
  const endDate = i.target ?? (est && est.end >= i.start! ? est.end : plus(i.start!, 13));
  const start: HalfPos = { date: startDate, half: i.start ? (i.startHalf ?? "AM") : "AM" };
  let end: HalfPos = { date: endDate, half: i.target ? (i.targetHalf ?? "PM") : "PM" };
  if (halfIndex(end) < halfIndex(start)) end = { ...start };
  return { start, end, dashedStart: !i.start, dashedEnd: !i.target };
}

/** Dates as DevOps will get them: the day only (the half stays in FocusTime). */
export const dayOf = (p: HalfPos): IsoDate => p.date;

// ---- The drag fix (D651) ----

/**
 * The row order to show. While a drag runs (`frozen` is the order when it began), the frozen order stands: rows that
 * left keep no slot and rows that arrived wait at the end, so nothing moves under the pointer. Otherwise `next`.
 */
export function shownOrder(frozen: readonly string[] | null, next: readonly string[]): string[] {
  if (!frozen) return [...next];
  const have = new Set(next);
  const kept = frozen.filter((k) => have.has(k));
  const seen = new Set(kept);
  return [...kept, ...next.filter((k) => !seen.has(k))];
}

/**
 * Data that arrives during a drag waits (a reload landing mid-drag re-sorted the rows before, D651). `dragging` true:
 * keep showing what was shown and hold the newest arrival; false: show the newest.
 */
export type Held<T> = { shown: T; pending: T | null };
export function receive<T>(h: Held<T>, value: T, dragging: boolean): Held<T> {
  return dragging ? { shown: h.shown, pending: value } : { shown: value, pending: null };
}
/** The drag ended: whatever arrived meanwhile shows now, once. */
export const release = <T,>(h: Held<T>): Held<T> => (h.pending === null ? h : { shown: h.pending, pending: null });
