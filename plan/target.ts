// Which day Plan the day targets (step 6, D97, D106). Pure.
import type { IsoDate } from "../week/types.ts";

/** The default config's workdays (Mon–Thu); the time model replaces this where it is known (step 6b). */
export const isPlanWorkday = (d: Temporal.PlainDate) => d.dayOfWeek <= 4;

/** Looked at most this far ahead; beyond it the date is returned as is (the server still refuses picks on PTO). */
const MAX_DAYS = 400;

/** Whether a date has working hours or a flex session (the time model, step 6b). Default: Mon–Thu. */
type HasHours = (date: IsoDate) => boolean;
const monToThu: HasHours = (d) => isPlanWorkday(Temporal.PlainDate.from(d));

/** The next date strictly after `date` with working hours (or a flex session) that isn't a PTO day. */
export function nextWorkday(date: IsoDate, pto: ReadonlySet<IsoDate> = new Set(), hasHours: HasHours = monToThu): IsoDate {
  let d = Temporal.PlainDate.from(date).add({ days: 1 });
  for (let n = 0; n < MAX_DAYS && (!hasHours(d.toString()) || pto.has(d.toString())); n++) d = d.add({ days: 1 });
  return d.toString();
}

/**
 * Default day to plan: today on a workday that isn't PTO, before the usual end of day; otherwise the next
 * such workday (Thursday evening, Friday and the weekend plan Monday; PTO days are skipped).
 */
export function planTarget(now: Temporal.ZonedDateTime, dayEnd: string, pto: ReadonlySet<IsoDate> = new Set(), hasHours: HasHours = monToThu): { date: IsoDate; isToday: boolean } {
  const today = now.toPlainDate();
  const beforeEnd = dayEnd === "24:00" || Temporal.PlainTime.compare(now.toPlainTime(), Temporal.PlainTime.from(dayEnd)) < 0;
  if (hasHours(today.toString()) && beforeEnd && !pto.has(today.toString())) return { date: today.toString(), isToday: true };
  return { date: nextWorkday(today.toString(), pto, hasHours), isToday: false };
}
