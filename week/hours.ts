// The time model (step 6b, D122): working hours per weekday, a lunch that is the AM/PM split, one-day overrides
// (split days too), flex sessions and the view range. Pure: no I/O, no clock.
import type { IsoDate } from "./types.ts";

/** "HH:MM" local time; an end may be "24:00". */
export type Hm = string;
export type Span = { start: Hm; end: Hm };
export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAY_KEYS: readonly WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A one-day change: other working spans (a squeezed or split day), and or another lunch (null: no lunch). */
export type DayOverride = { date: IsoDate; segments?: Span[]; lunch?: Span | null };

export type TimeModel = {
  timeZone: string;
  /** Default working spans per weekday; an empty list is a day off. */
  weekdays: Record<WeekdayKey, Span[]>;
  /** Default lunch. Its start ends the morning and its end starts the afternoon. null: split at the middle. */
  lunch: Span | null;
  overrides: DayOverride[];
};

export type ViewRange = "business" | "12h" | "24h";
export const VIEW_RANGES: readonly ViewRange[] = ["business", "12h", "24h"];

/** Minutes after midnight. */
export const toMin = (t: Hm) => {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};
export const toHm = (n: number): Hm => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const spanMin = (s: Span): [number, number] => [toMin(s.start), toMin(s.end)];

/** Sorted, overlapping or touching spans merged, empty ones dropped. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const iv = spans.map(spanMin).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => ({ start: toHm(a), end: toHm(b) }));
}

export const weekdayKey = (date: IsoDate): WeekdayKey => WEEKDAY_KEYS[Temporal.PlainDate.from(date).dayOfWeek - 1]!;

/** One day's working hours, after any override. */
export type DayHours = {
  date: IsoDate;
  /** Working spans, merged and sorted. Empty: no working hours. */
  segments: Span[];
  /** The first span: the normal workday, split into morning and afternoon. */
  main: Span | null;
  /** Spans after the first (an evening on a split day). */
  extra: Span[];
  /** The lunch in effect, only when it falls inside the main span. */
  lunch: Span | null;
  /** Morning and afternoon working spans (null without a main span). */
  am: Span | null;
  pm: Span | null;
  overridden: boolean;
};

/** Where the morning ends and the afternoon starts: the lunch, else the middle of the day (to 15 minutes). */
function split(main: Span, lunch: Span | null): { amEnd: number; pmStart: number; lunch: Span | null } {
  const [a, b] = spanMin(main);
  if (lunch) {
    const [la, lb] = spanMin(lunch);
    if (la > a && lb < b && lb >= la) return { amEnd: la, pmStart: lb, lunch };
  }
  const mid = a + Math.floor((b - a) / 2 / 15) * 15;
  return { amEnd: mid, pmStart: mid, lunch: null };
}

export function hoursOn(model: TimeModel, date: IsoDate): DayHours {
  const o = model.overrides.find((x) => x.date === date);
  const segments = mergeSpans(o?.segments ?? model.weekdays[weekdayKey(date)]);
  const lunchRule = o && o.lunch !== undefined ? o.lunch : model.lunch;
  const main = segments[0] ?? null;
  if (!main) return { date, segments, main: null, extra: [], lunch: null, am: null, pm: null, overridden: !!o };
  const s = split(main, lunchRule);
  return { date, segments, main, extra: segments.slice(1), lunch: s.lunch, am: { start: main.start, end: toHm(s.amEnd) }, pm: { start: toHm(s.pmStart), end: main.end }, overridden: !!o };
}

/** Total working minutes of a day, lunch excluded. */
export function workingMinutes(h: DayHours): number {
  const all = h.segments.reduce((n, s) => n + toMin(s.end) - toMin(s.start), 0);
  return all - (h.lunch ? toMin(h.lunch.end) - toMin(h.lunch.start) : 0);
}

/** The usual end of a day: the end of its last working span (an evening counts), or null on a day without working hours. */
export const dayEndOf = (model: TimeModel, date: IsoDate): Hm | null => hoursOn(model, date).segments.at(-1)?.end ?? null;

/** Nominal morning and afternoon (for cards on a day off): the first weekday with hours, else 09:00 to 17:00. */
export function nominalHours(model: TimeModel): { am: Span; pm: Span } {
  for (const k of WEEKDAY_KEYS) {
    const segs = mergeSpans(model.weekdays[k]);
    if (segs[0]) {
      const s = split(segs[0], model.lunch);
      return { am: { start: segs[0].start, end: toHm(s.amEnd) }, pm: { start: toHm(s.pmStart), end: segs[0].end } };
    }
  }
  return { am: { start: "09:00", end: "12:30" }, pm: { start: "12:30", end: "17:00" } };
}

/** "09:00-17:00" ⇄ Span, the form used in config. */
export const SPAN_TEXT = /^([01]\d|2[0-3]):([0-5]\d)-(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;
export function parseSpan(s: string): Span | null {
  if (!SPAN_TEXT.test(s)) return null;
  const [start, end] = s.split("-") as [string, string];
  return toMin(end) >= toMin(start) ? { start, end } : null;
}
export const spanText = (s: Span) => `${s.start}-${s.end}`;

/**
 * The hours a week's timelines show (D123): business hours (the earliest morning start to the latest afternoon end
 * of the week's working days, to whole hours), 12 hours (07:00 to 19:00) or the whole day, widened to the whole hour around
 * anything planned outside it (morning and afternoon working time, unavailable time).
 */
export function viewRange(mode: ViewRange, days: readonly DayHours[], planned: readonly Span[]): { start: Hm; end: Hm; expanded: boolean } {
  let [a, b] = mode === "24h" ? [0, 1440] : mode === "12h" ? [420, 1140] : [Infinity, -Infinity];
  if (mode === "business") {
    for (const d of days) {
      if (d.am) a = Math.min(a, toMin(d.am.start));
      if (d.pm) b = Math.max(b, toMin(d.pm.end));
    }
    if (a === Infinity) [a, b] = [540, 1020];
    [a, b] = [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60];
  }
  const base: [number, number] = [a, b];
  for (const s of [...days.flatMap((d) => [d.am, d.pm].filter((x): x is Span => !!x)), ...planned]) {
    const [x, y] = spanMin(s);
    if (y <= x) continue;
    a = Math.min(a, Math.floor(x / 60) * 60);
    b = Math.max(b, Math.ceil(y / 60) * 60);
  }
  b = Math.min(b, 1440);
  return { start: toHm(a), end: toHm(b), expanded: a < base[0] || b > base[1] };
}

const DAY_NAMES: Record<WeekdayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const spansText = (spans: readonly Span[]) => spans.map((s) => `${s.start}–${s.end}`).join(" + ");

/** "Mon–Thu 09:00–17:00 · split 12:30": the usual week in one line (runs of weekdays with the same hours). */
export function hoursSummary(model: TimeModel): string {
  const runs: { from: WeekdayKey; to: WeekdayKey; text: string }[] = [];
  for (const k of WEEKDAY_KEYS) {
    const segs = mergeSpans(model.weekdays[k]);
    if (!segs.length) continue;
    const text = spansText(segs);
    const last = runs.at(-1);
    if (last && last.text === text && WEEKDAY_KEYS.indexOf(last.to) === WEEKDAY_KEYS.indexOf(k) - 1) last.to = k;
    else runs.push({ from: k, to: k, text });
  }
  const days = runs.length ? runs.map((r) => `${DAY_NAMES[r.from]}${r.to !== r.from ? `–${DAY_NAMES[r.to]}` : ""} ${r.text}`).join(", ") : "No usual working hours";
  const lunch = model.lunch ? (model.lunch.start === model.lunch.end ? ` · split ${model.lunch.start}` : ` · lunch ${model.lunch.start}–${model.lunch.end}`) : "";
  return `${days}${lunch}`;
}

export const VIEW_RANGE_NAMES: Record<ViewRange, string> = { business: "Business hours", "12h": "12 hours", "24h": "24 hours" };

/**
 * Step 13.5: moving a pick to a day without working hours asks first. The question, or null when the day has hours.
 * The weekday alone within a week of `today`; with the date beyond that.
 */
export function noHoursPrompt(model: TimeModel, date: IsoDate, today?: IsoDate): string | null {
  if (hoursOn(model, date).segments.length) return null;
  const d = Temporal.PlainDate.from(date);
  // Step 13.6 (Q78, D238): Friday is the overflow / catch-up day (D26); a pick moved there is catch-up work.
  if (d.dayOfWeek === 5) return null;
  const near = !today || Math.abs(Temporal.PlainDate.from(today).until(d, { largestUnit: "days" }).days) < 7;
  const name = near ? d.toLocaleString("en-US", { weekday: "long" }) : d.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return `${name} has no working hours. Add hours for that day?`;
}
