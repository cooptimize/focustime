// Plan ahead (step 17, slice 2): one timeline with weekly columns for weeks 1 to 4 and monthly columns (compressed) for
// weeks 5 to 12; bar dates from DevOps or estimated; whole blocks per week in weeks 1 to 4; crowded months after that.
// Pure: no I/O. Whole numbers only in anything shown.
import type { IsoDate } from "../week/types.ts";

export const AHEAD_WEEKS = 12;
export const PLAN_WEEKS = 4;
/** A month after week 4 is crowded when its features due get fewer than this many blocks each (D351). */
export const CROWDED_BLOCKS_PER_FEATURE = 3;
/** Without a target date, a planned week or a pace, an estimated bar runs this many days. */
export const DEFAULT_SPAN_DAYS = 14;

const D = (d: IsoDate) => Temporal.PlainDate.from(d);
const plus = (d: IsoDate, days: number) => D(d).add({ days }).toString();
const diff = (a: IsoDate, b: IsoDate) => D(a).until(D(b), { largestUnit: "days" }).days;
const minDate = (a: IsoDate, b: IsoDate) => (a <= b ? a : b);
const maxDate = (a: IsoDate, b: IsoDate) => (a >= b ? a : b);

/** The 12 Mondays from this week's: week 1 is this week (D350). */
export function aheadWeeks(thisMonday: IsoDate): IsoDate[] {
  return Array.from({ length: AHEAD_WEEKS }, (_, i) => plus(thisMonday, i * 7));
}

export type AheadColumn =
  | { kind: "week"; index: number; weekStart: IsoDate; from: IsoDate; to: IsoDate; label: string }
  | { kind: "month"; month: string; weeks: IsoDate[]; from: IsoDate; to: IsoDate; label: string };

/**
 * Weekly columns for weeks 1 to 4, then one column per month for weeks 5 to 12: a week belongs to the month its
 * Thursday is in, so a month column never holds a sliver. `to` is exclusive.
 */
export function aheadColumns(weeks: readonly IsoDate[]): AheadColumn[] {
  const cols: AheadColumn[] = weeks.slice(0, PLAN_WEEKS).map((w, i) => ({ kind: "week", index: i + 1, weekStart: w, from: w, to: plus(w, 7), label: D(w).toLocaleString("en-US", { month: "short", day: "numeric" }) }));
  for (const w of weeks.slice(PLAN_WEEKS)) {
    const thu = D(w).add({ days: 3 });
    const month = thu.toPlainYearMonth().toString();
    const last = cols[cols.length - 1];
    if (last?.kind === "month" && last.month === month) {
      last.weeks.push(w);
      last.to = plus(w, 7);
    } else cols.push({ kind: "month", month, weeks: [w], from: w, to: plus(w, 7), label: thu.toLocaleString("en-US", { month: "short" }) });
  }
  return cols;
}

export type Scale = { width: number; from: IsoDate; to: IsoDate; x: (d: IsoDate) => number; dateAt: (x: number) => IsoDate; colX: (i: number) => number; colW: (i: number) => number };

/** Pixel positions: each column a fixed width, dates spread evenly inside it. Dates outside clamp to the edges. */
export function timelineScale(cols: readonly AheadColumn[], w: { week: number; month: number }): Scale {
  const widths = cols.map((c) => (c.kind === "week" ? w.week : w.month));
  const starts = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
  const width = widths.reduce((a, b) => a + b, 0);
  const x = (d: IsoDate) => {
    if (d < cols[0]!.from) return 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]!;
      if (d < c.to) return starts[i]! + (diff(c.from, d) / diff(c.from, c.to)) * widths[i]!;
    }
    return width;
  };
  const dateAt = (px: number) => {
    const p = Math.max(0, Math.min(width - 0.001, px));
    const i = Math.max(0, starts.findLastIndex((s) => s <= p));
    const c = cols[i]!;
    return plus(c.from, Math.floor(((p - starts[i]!) / widths[i]!) * diff(c.from, c.to)));
  };
  return { width, from: cols[0]!.from, to: cols[cols.length - 1]!.to, x, dateAt, colX: (i) => starts[i]!, colW: (i) => widths[i]! };
}

export type StartFrom = "devops" | "local" | "planned" | "activity" | "today";
export type EndFrom = "devops" | "local" | "planned" | "pace" | "default";
export type BarDates = {
  start: IsoDate;
  /** Inclusive last day. */
  end: IsoDate;
  startFrom: StartFrom;
  endFrom: EndFrom;
  /** Both dates from DevOps (the process has Start Date and both are set): a solid bar. Otherwise hatched, "est.". */
  solid: boolean;
  /** The target date (a diamond), when set in DevOps. */
  target: IsoDate | null;
  /** The pace forecast, when it lands after the target: the ghost extension past the diamond (the row is At risk). */
  ghostEnd: IsoDate | null;
  /** Dragged and not saved to DevOps yet. */
  changed: boolean;
};
export type BarInput = {
  hasStartField: boolean;
  startDate: IsoDate | null;
  targetDate: IsoDate | null;
  /** Dates I dragged (kept locally until saved). */
  local: { start: IsoDate; end: IsoDate } | null;
  /** Weeks (Mondays) in weeks 1 to 4 with blocks for it. */
  plannedWeeks: readonly IsoDate[];
  /** The earliest change seen among its stories (ISO instant or date). */
  firstActivity: string | null;
  forecastEnd: IsoDate | null;
  today: IsoDate;
};

/**
 * A bar's dates (D349). Start: dragged, else DevOps Start Date, else the first planned week, else the first story
 * activity, else today. End: dragged, else the target date, else the last planned week's Friday, else the pace
 * forecast, else two weeks from the later of its start and today (open work never ends in the past by default). Solid only when both come from DevOps.
 */
export function barDates(i: BarInput): BarDates {
  const planned = [...i.plannedWeeks].sort();
  let start: IsoDate, startFrom: StartFrom;
  if (i.local) [start, startFrom] = [i.local.start, "local"];
  else if (i.hasStartField && i.startDate) [start, startFrom] = [i.startDate, "devops"];
  else if (planned.length) [start, startFrom] = [planned[0]!, "planned"];
  else if (i.firstActivity) [start, startFrom] = [minDate(i.firstActivity.slice(0, 10), i.today), "activity"];
  else [start, startFrom] = [i.today, "today"];
  let end: IsoDate, endFrom: EndFrom;
  if (i.local) [end, endFrom] = [i.local.end, "local"];
  else if (i.targetDate) [end, endFrom] = [i.targetDate, "devops"];
  else if (planned.length) [end, endFrom] = [plus(planned[planned.length - 1]!, 4), "planned"];
  else if (i.forecastEnd) [end, endFrom] = [i.forecastEnd, "pace"];
  else [end, endFrom] = [plus(maxDate(start, i.today), DEFAULT_SPAN_DAYS - 1), "default"];
  end = maxDate(end, start);
  const ghost = i.targetDate && i.forecastEnd && i.forecastEnd > i.targetDate ? i.forecastEnd : null;
  return { start, end, startFrom, endFrom, solid: startFrom === "devops" && endFrom === "devops", target: i.targetDate, ghostEnd: ghost, changed: startFrom === "local" };
}

export type DragMode = "move" | "start" | "end";
/** Dragging a bar's body moves both dates; an end moves one, never past the other. Whole days. */
export function dragBar(b: { start: IsoDate; end: IsoDate }, mode: DragMode, days: number): { start: IsoDate; end: IsoDate } {
  const n = Math.round(days);
  if (mode === "move") return { start: plus(b.start, n), end: plus(b.end, n) };
  if (mode === "start") return { start: minDate(plus(b.start, n), b.end), end: b.end };
  return { start: b.start, end: maxDate(plus(b.end, n), b.start) };
}

/** Week cells take whole blocks from 0 to the client's budget that week (at least what is set already). */
export function cellChoices(budget: number, current: number): number[] {
  const top = Math.max(budget, current);
  return Array.from({ length: top + 1 }, (_, i) => i);
}
/** + and − on a focused week cell, kept within 0 and the client's budget. */
export function stepCell(current: number, delta: 1 | -1, budget: number): number {
  return Math.max(0, Math.min(Math.max(budget, current), current + delta));
}

export type MonthLoad = { month: string; label: string; available: number; due: number; crowded: boolean; text: string };
/** "Dec: 8 blocks, 3 features due" and Crowded month when each feature due gets fewer than 3 blocks (D351). */
export function monthLoad(col: { month: string; label: string }, available: number, due: number): MonthLoad {
  const crowded = due > 0 && available < due * CROWDED_BLOCKS_PER_FEATURE;
  const blocks = `${available} ${available === 1 ? "block" : "blocks"}`;
  const features = due ? `, ${due} ${due === 1 ? "feature" : "features"} due` : "";
  return { month: col.month, label: col.label, available, due, crowded, text: `${blocks}${features}` };
}

/** Which month column a date falls in (null: weeks 1 to 4, or outside the 12 weeks). */
export function monthOf(cols: readonly AheadColumn[], d: IsoDate): string | null {
  const c = cols.find((x) => x.kind === "month" && d >= x.from && d < x.to);
  return c?.kind === "month" ? c.month : null;
}

/**
 * Over-booked weeks (the Roadmap summary's filter): weeks 1 to 4 where a client's musts take more blocks than its
 * budget, and the features with blocks in one of them ("<client>:<id>").
 */
export function overbooked(
  clients: readonly { clientKey: string; weeks: readonly { weekStart: IsoDate; planned: number; budget: number }[] }[],
  cells: readonly { clientKey: string; itemId: number; weekStart: IsoDate; blocks: number }[],
): { weeks: number; items: Set<string> } {
  const over = new Set(clients.flatMap((c) => c.weeks.filter((w) => w.planned > w.budget).map((w) => `${c.clientKey}|${w.weekStart}`)));
  const items = new Set(cells.filter((x) => x.blocks > 0 && over.has(`${x.clientKey}|${x.weekStart}`)).map((x) => `${x.clientKey}:${x.itemId}`));
  return { weeks: over.size, items };
}
