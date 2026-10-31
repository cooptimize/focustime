// Which day Plan the day targets (step 6, D97). Pure.
import type { IsoDate } from "../week/types.ts";

/** Workdays for planning: Mon–Thu (Friday is the overflow day, D78). */
export const isPlanWorkday = (d: Temporal.PlainDate) => d.dayOfWeek <= 4;

/** The next Mon–Thu date strictly after `date`. */
export function nextWorkday(date: IsoDate): IsoDate {
  let d = Temporal.PlainDate.from(date).add({ days: 1 });
  while (!isPlanWorkday(d)) d = d.add({ days: 1 });
  return d.toString();
}

/**
 * Default day to plan: today on a workday before the usual end of day; otherwise the next workday
 * (Thursday evening, Friday and the weekend plan Monday).
 */
export function planTarget(now: Temporal.ZonedDateTime, dayEnd: string): { date: IsoDate; isToday: boolean } {
  const today = now.toPlainDate();
  const beforeEnd = Temporal.PlainTime.compare(now.toPlainTime(), Temporal.PlainTime.from(dayEnd)) < 0;
  if (isPlanWorkday(today) && beforeEnd) return { date: today.toString(), isToday: true };
  return { date: nextWorkday(today.toString()), isToday: false };
}
