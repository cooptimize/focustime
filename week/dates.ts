import { hoursOn, toMin, type TimeModel } from "./hours.ts";
import type { Half, IsoDate, IsoDateTime, Weekday } from "./types.ts";

export const WEEKDAYS: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const WEEKDAYS_7: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function mondayOf(date: IsoDate): IsoDate {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}

/** Mon to Fri dates of the week. Throws if weekStart is not a Monday. */
export function weekDates(weekStart: IsoDate): IsoDate[] {
  const d = Temporal.PlainDate.from(weekStart);
  if (d.dayOfWeek !== 1) throw new RangeError(`Week start must be a Monday, got ${weekStart}`);
  return WEEKDAYS.map((_, i) => d.add({ days: i }).toString());
}

export function addWeeks(weekStart: IsoDate, n: number): IsoDate {
  return Temporal.PlainDate.from(weekStart).add({ weeks: n }).toString();
}

/** Mon to Sun dates of the week. */
export function weekDates7(weekStart: IsoDate): IsoDate[] {
  const d = Temporal.PlainDate.from(weekStart);
  return WEEKDAYS_7.map((_, i) => d.add({ days: i }).toString());
}

/**
 * The week to show for a given local date: the current week on weekdays, the coming week on weekends, unless
 * today has something planned (working hours, a flex session, unavailable time or picks): then this week (step 6b).
 */
export function defaultWeekStart(today: IsoDate, todayHasPlans = false): IsoDate {
  const d = Temporal.PlainDate.from(today);
  return d.dayOfWeek >= 6 && !todayHasPlans ? d.add({ days: 8 - d.dayOfWeek }).toString() : mondayOf(today);
}

export type TodayTarget = { weekStart: IsoDate; dayIndex: number; half: Half };

/**
 * Where "today" lands in the grid for an instant: its half by the day's hours (morning until the lunch ends the
 * morning, then afternoon, then the evening slot after the main span when `hasEve`). On a weekend with nothing
 * planned, the coming Monday morning. `dayIndex` counts from Monday (Saturday is 5, Sunday 6).
 */
export function todayTarget(now: IsoDateTime, model: TimeModel, opts: { todayHasPlans?: boolean; hasEve?: boolean } = {}): TodayTarget {
  const zdt = Temporal.Instant.from(now).toZonedDateTimeISO(model.timeZone);
  const date = zdt.toPlainDate();
  if (date.dayOfWeek >= 6 && !opts.todayHasPlans) return { weekStart: defaultWeekStart(date.toString()), dayIndex: 0, half: "AM" };
  const h = hoursOn(model, date.toString());
  const t = zdt.hour * 60 + zdt.minute;
  let half: Half = "AM";
  if (!h.main) half = opts.hasEve ? "EVE" : "AM";
  else if (opts.hasEve && t >= toMin(h.main.end)) half = "EVE";
  else if (t >= toMin(h.am!.end)) half = "PM";
  return { weekStart: mondayOf(date.toString()), dayIndex: date.dayOfWeek - 1, half };
}

export function localToday(now: IsoDateTime, timeZone: string): IsoDate {
  return Temporal.Instant.from(now).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** A local "HH:MM" (or "24:00") on a date, in a zone. */
export function zonedAt(date: IsoDate, hm: string, timeZone: string): Temporal.ZonedDateTime {
  const d = Temporal.PlainDate.from(date);
  if (hm === "24:00") return d.add({ days: 1 }).toZonedDateTime({ timeZone });
  return d.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from(hm) });
}

/** Wall-clock minutes after midnight of `date` for an instant (negative the day before, over 1440 the day after). */
export function minutesOn(date: IsoDate, instant: IsoDateTime, timeZone: string): number {
  const z = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  const days = Temporal.PlainDate.from(date).until(z.toPlainDate(), { largestUnit: "days" }).days;
  return days * 1440 + z.hour * 60 + z.minute;
}

export function iso(zdt: Temporal.ZonedDateTime): IsoDateTime {
  return zdt.toString({ timeZoneName: "never", smallestUnit: "second" });
}
