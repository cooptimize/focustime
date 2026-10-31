// Which day Plan the day targets (step 6, D97, D106). Pure.
import type { IsoDate } from "../week/types.ts";

/** Workdays for planning: Mon–Thu. Friday is the overflow day and not a target for now (D107). */
export const isPlanWorkday = (d: Temporal.PlainDate) => d.dayOfWeek <= 4;

/** Looked at most this far ahead; beyond it the date is returned as is (the server still refuses picks on PTO). */
const MAX_DAYS = 400;

/** The next Mon–Thu date strictly after `date` that isn't a PTO day. */
export function nextWorkday(date: IsoDate, pto: ReadonlySet<IsoDate> = new Set()): IsoDate {
  let d = Temporal.PlainDate.from(date).add({ days: 1 });
  for (let n = 0; n < MAX_DAYS && (!isPlanWorkday(d) || pto.has(d.toString())); n++) d = d.add({ days: 1 });
  return d.toString();
}

/**
 * Default day to plan: today on a workday that isn't PTO, before the usual end of day; otherwise the next
 * such workday (Thursday evening, Friday and the weekend plan Monday; PTO days are skipped).
 */
export function planTarget(now: Temporal.ZonedDateTime, dayEnd: string, pto: ReadonlySet<IsoDate> = new Set()): { date: IsoDate; isToday: boolean } {
  const today = now.toPlainDate();
  const beforeEnd = Temporal.PlainTime.compare(now.toPlainTime(), Temporal.PlainTime.from(dayEnd)) < 0;
  if (isPlanWorkday(today) && beforeEnd && !pto.has(today.toString())) return { date: today.toString(), isToday: true };
  return { date: nextWorkday(today.toString(), pto), isToday: false };
}
