import type { DayShape, Half, IsoDate, IsoDateTime, Weekday } from "./types";

export const WEEKDAYS: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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

/** The week to show for a given local date: the current week on weekdays, the coming week on weekends. */
export function defaultWeekStart(today: IsoDate): IsoDate {
  const d = Temporal.PlainDate.from(today);
  return d.dayOfWeek >= 6 ? d.add({ days: 8 - d.dayOfWeek }).toString() : mondayOf(today);
}

export type TodayTarget = { weekStart: IsoDate; dayIndex: number; half: Half };

/** Where "today" lands in the grid for an instant, using the day shape's time zone and split. */
export function todayTarget(now: IsoDateTime, shape: DayShape): TodayTarget {
  const zdt = Temporal.Instant.from(now).toZonedDateTimeISO(shape.timeZone);
  const date = zdt.toPlainDate();
  if (date.dayOfWeek >= 6) return { weekStart: defaultWeekStart(date.toString()), dayIndex: 0, half: "AM" };
  const beforeSplit = Temporal.PlainTime.compare(zdt.toPlainTime(), Temporal.PlainTime.from(shape.split)) < 0;
  return { weekStart: mondayOf(date.toString()), dayIndex: date.dayOfWeek - 1, half: beforeSplit ? "AM" : "PM" };
}

export function localToday(now: IsoDateTime, timeZone: string): IsoDate {
  return Temporal.Instant.from(now).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** Zoned boundaries of one day under the day shape. */
export function dayBounds(date: IsoDate, shape: DayShape) {
  const d = Temporal.PlainDate.from(date);
  const at = (t: string) => d.toZonedDateTime({ timeZone: shape.timeZone, plainTime: Temporal.PlainTime.from(t) });
  return {
    midnight: d.toZonedDateTime({ timeZone: shape.timeZone }),
    start: at(shape.start),
    split: at(shape.split),
    end: at(shape.end),
    nextMidnight: d.add({ days: 1 }).toZonedDateTime({ timeZone: shape.timeZone }),
  };
}

export function iso(zdt: Temporal.ZonedDateTime): IsoDateTime {
  return zdt.toString({ timeZoneName: "never", smallestUnit: "second" });
}
