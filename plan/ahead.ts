// Plan ahead (step 17, slice 2): one timeline with weekly columns for weeks 1 to 4 and monthly columns (compressed) for
// weeks 5 to 12; bar dates from DevOps or estimated; hours per week in weeks 1 to 4 (E2); crowded months after that.
// Pure: no I/O. Whole hours only in anything shown.
import type { IsoDate } from "../week/types.ts";
import { hoursText, isOver } from "./estimate.ts";

export const AHEAD_WEEKS = 12;
export const PLAN_WEEKS = 4;
/** A month after week 4 is crowded when its features due get less free time than this each (D351; E2: 3 blocks of 4h). */
export const CROWDED_MINUTES_PER_FEATURE = 12 * 60;
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
  | { kind: "past"; weekStart: IsoDate; from: IsoDate; to: IsoDate; label: string }
  | { kind: "week"; index: number; weekStart: IsoDate; from: IsoDate; to: IsoDate; label: string }
  | { kind: "month"; month: string; weeks: IsoDate[]; from: IsoDate; to: IsoDate; label: string };

/**
 * Weekly columns for weeks 1 to 4, then one column per month for weeks 5 to 12: a week belongs to the month its
 * Thursday is in, so a month column never holds a sliver. `to` is exclusive.
 */
export function aheadColumns(weeks: readonly IsoDate[], past: readonly IsoDate[] = []): AheadColumn[] {
  const label = (w: IsoDate) => D(w).toLocaleString("en-US", { month: "short", day: "numeric" });
  const before: AheadColumn[] = past.map((w) => ({ kind: "past", weekStart: w, from: w, to: plus(w, 7), label: label(w) }));
  const cols: AheadColumn[] = weeks.slice(0, PLAN_WEEKS).map((w, i) => ({ kind: "week", index: i + 1, weekStart: w, from: w, to: plus(w, 7), label: D(w).toLocaleString("en-US", { month: "short", day: "numeric" }) }));
  cols.unshift(...before);
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
export function timelineScale(cols: readonly AheadColumn[], w: { week: number; month: number; past?: number }): Scale {
  const widths = cols.map((c) => (c.kind === "week" ? w.week : c.kind === "past" ? (w.past ?? w.week) : w.month));
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
  /** Weeks (Mondays) in weeks 1 to 4 with time planned for it. */
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

export type MonthLoad = { month: string; label: string; available: number; due: number; crowded: boolean; text: string };
/** "about 32h, 3 features due" and Crowded month when each feature due gets less than 12h (D351, E2). Minutes in. */
export function monthLoad(col: { month: string; label: string }, availableMinutes: number, due: number): MonthLoad {
  const crowded = due > 0 && availableMinutes < due * CROWDED_MINUTES_PER_FEATURE;
  const features = due ? `, ${due} ${due === 1 ? "feature" : "features"} due` : "";
  return { month: col.month, label: col.label, available: availableMinutes, due, crowded, text: `${availableMinutes ? `about ${hoursText(availableMinutes)} free` : "No focus time"}${features}` };
}

/** Which month column a date falls in (null: weeks 1 to 4, or outside the 12 weeks). */
export function monthOf(cols: readonly AheadColumn[], d: IsoDate): string | null {
  const c = cols.find((x) => x.kind === "month" && d >= x.from && d < x.to);
  return c?.kind === "month" ? c.month : null;
}

/**
 * Over-booked weeks (the Roadmap summary's filter): weeks 1 to 4 where a client's musts need more than its free time,
 * and the features with time in one of them ("<client>:<id>"). In minutes.
 */
export function overbooked(
  clients: readonly { clientKey: string; weeks: readonly { weekStart: IsoDate; plannedMinutes: number; freeMinutes: number }[] }[],
  cells: readonly { clientKey: string; itemId: number; weekStart: IsoDate; minutes: number }[],
): { weeks: number; items: Set<string> } {
  const over = new Set(clients.flatMap((c) => c.weeks.filter((w) => isOver(w.plannedMinutes, w.freeMinutes)).map((w) => `${c.clientKey}|${w.weekStart}`)));
  const items = new Set(cells.filter((x) => x.minutes > 0 && over.has(`${x.clientKey}|${x.weekStart}`)).map((x) => `${x.clientKey}:${x.itemId}`));
  return { weeks: over.size, items };
}

/** The two weeks before week 1, shown as planned against worked. */
export const PAST_WEEKS = 2;
export const pastWeeks = (thisMonday: IsoDate): IsoDate[] => Array.from({ length: PAST_WEEKS }, (_, i) => plus(thisMonday, -7 * (PAST_WEEKS - i)));

/** "planned 6h, worked about 4h"; "planned 6h, no focus time"; "not planned, worked about 2h"; null when neither. Minutes in. */
export function pastWords(plannedMinutes: number, workedMinutes: number): string | null {
  const worked = workedMinutes <= 0 ? "no focus time" : workedMinutes < 30 ? "worked under 1h" : `worked about ${hoursText(workedMinutes)}`;
  if (plannedMinutes > 0) return `planned ${hoursText(plannedMinutes)}, ${worked}`;
  return workedMinutes > 0 ? `not planned, ${worked}` : null;
}

export type NextStep = "breakdown" | "brief" | "draft_feature" | "set_target" | "ask_owner" | "help" | "plan_weeks";
export type ReadinessKind = "not_scoped" | "blocked" | "stalled" | "no_target" | "target_before_planned" | "gap_before_target" | "crowded" | "beyond" | "needs_stories";
export type ReadinessFlag = { kind: ReadinessKind; text: string; next: NextStep[] };
export type ReadinessInput = {
  tier: "feature" | "epic";
  state: string;
  /** Assigned to me: I can set its dates; otherwise ask the owner. */
  owned: boolean;
  /** Its stories (an epic: features), any state. */
  stories: number;
  /** The bar's start (DevOps or estimated). */
  start: IsoDate;
  target: IsoDate | null;
  today: IsoDate;
  /** The 12 Mondays (week 1 is this week). */
  weeks: readonly IsoDate[];
  /** Weeks 1 to 4 with time planned for it. */
  plannedWeeks: readonly IsoDate[];
  crowdedMonths: ReadonlySet<string>;
  cols: readonly AheadColumn[];
  /** A week's estimate not covered by its listed stories (step 16.4 "needs more stories"). */
  needsStories: boolean;
};

/**
 * Plan ahead's readiness flags (step 17, slice 3), each with its next steps, in this order: not scoped, blocked,
 * stalled, no target date, target before its last planned week, nothing planned before the target, crowded month,
 * target beyond the 12 weeks, needs more stories. Done rows have none. Weeks count from this week (week 1).
 */
export function readiness(i: ReadinessInput): ReadinessFlag[] {
  if (i.state === "done") return [];
  const out: ReadinessFlag[] = [];
  const monday = i.weeks[0]!;
  const weekIdx = (d: IsoDate) => Math.floor(diff(monday, d) / 7);
  const inWeeks = (d: IsoDate) => (weekIdx(d) <= 0 ? "this week" : `in ${weekIdx(d)} ${weekIdx(d) === 1 ? "week" : "weeks"}`);
  const ask: NextStep = i.owned ? "set_target" : "ask_owner";
  if (i.state === "not_scoped" || i.stories === 0) {
    const when = i.start < monday ? "Started" : `Starts ${inWeeks(i.start)}`;
    out.push(i.tier === "epic" ? { kind: "not_scoped", text: `${when}, no features`, next: ["draft_feature"] } : { kind: "not_scoped", text: `${when}, not scoped`, next: ["breakdown", "brief"] });
  }
  if (i.state === "blocked") out.push({ kind: "blocked", text: "Blocked", next: ["ask_owner", "help"] });
  if (i.state === "stalled") out.push({ kind: "stalled", text: "Stalled", next: ["ask_owner", "help"] });
  const end = plus(i.weeks[i.weeks.length - 1]!, 7);
  const planned = [...i.plannedWeeks].sort();
  const last = planned[planned.length - 1];
  if (!i.target) out.push({ kind: "no_target", text: "No target date", next: [ask] });
  else {
    if (last && i.target < last) out.push({ kind: "target_before_planned", text: "Target date before its last planned week", next: [ask] });
    if (i.target >= i.today && i.target < end && i.tier === "feature") {
      const t = weekIdx(i.target);
      if (!last) out.push({ kind: "gap_before_target", text: `Target ${inWeeks(i.target)}, nothing planned`, next: ["plan_weeks"] });
      else if (weekIdx(last) < Math.min(t, PLAN_WEEKS - 1)) out.push({ kind: "gap_before_target", text: `Target ${inWeeks(i.target)}, nothing planned after week ${weekIdx(last) + 1}`, next: ["plan_weeks"] });
    }
    const m = monthOf(i.cols, i.target);
    if (m && i.crowdedMonths.has(m)) out.push({ kind: "crowded", text: "Crowded month", next: [ask] });
    if (i.target >= end) out.push({ kind: "beyond", text: "Target beyond 12 weeks", next: [ask] });
  }
  if (i.needsStories && i.tier === "feature") out.push({ kind: "needs_stories", text: "Needs more stories", next: ["breakdown", "brief"] });
  return out;
}

/** The words on each next step. */
export const NEXT_WORDS: Record<NextStep, string> = {
  breakdown: "Break it down",
  brief: "Copy Coop brief",
  draft_feature: "Draft a feature",
  set_target: "Set target date",
  ask_owner: "Ask owner as a follow-up",
  help: "Ask to collaborate",
  plan_weeks: "Plan its weeks",
};
