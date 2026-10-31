// Which days Plan the day can open, how much of a day can be changed, and where carry-over is offered
// ("Plan any day"). Pure: the caller passes today, PTO and commits.
import type { IsoDate } from "../week/types.ts";
import { isPlanWorkday } from "./target.ts";

/** "plan": everything can change. "past": only ticking picks done or dropping them. */
export type DayAccess = "plan" | "past";
export type DayRule = { ok: true; access: DayAccess } | { ok: false; reason: string; kind: "pto" | "no_hours" };

export const dayLabel = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Whether a date has working hours or a flex session (step 6b, D127). Callers build it from the time model. */
export type HasHours = (date: IsoDate) => boolean;

/** The default config's answer (Mon–Thu), for callers and tests without a time model at hand. */
export const monToThu: HasHours = (date) => isPlanWorkday(Temporal.PlainDate.from(date));

/** Can this date be planned, and how far? PTO days and days without working hours or a flex session are refused. */
export function dayRule(date: IsoDate, today: IsoDate, pto: { titles: readonly string[] } | null, hasHours: boolean = monToThu(date)): DayRule {
  if (pto) return { ok: false, kind: "pto", reason: `${dayLabel(date)} is a PTO day${pto.titles.length ? ` (${pto.titles.join(", ")})` : ""}. Nothing can be planned on it` };
  if (!hasHours)
    return { ok: false, kind: "no_hours", reason: `${dayLabel(date)} has no working hours, so there is nothing to plan. Give it working hours (its ⋯ menu or Settings) or add a flex session` };
  return { ok: true, access: date < today ? "past" : "plan" };
}

/** The first plannable day can be today, until its usual end; after it, tomorrow. */
export function upcomingStart(now: Temporal.ZonedDateTime, dayEnd: string): IsoDate {
  const today = now.toPlainDate();
  const before = dayEnd === "24:00" || Temporal.PlainTime.compare(now.toPlainTime(), Temporal.PlainTime.from(dayEnd)) < 0;
  return before ? today.toString() : today.add({ days: 1 }).toString();
}

/** How far the day stepper and the carry-over target look before giving up. */
export const SCAN_DAYS = 31;

/**
 * The next day from `date` in direction `dir` that Plan the day can open, skipping days without working
 * hours and known PTO days. Null when there is none within SCAN_DAYS.
 */
export function stepDay(date: IsoDate, dir: 1 | -1, pto: ReadonlySet<IsoDate> = new Set(), hasHours: HasHours = monToThu): IsoDate | null {
  let d = Temporal.PlainDate.from(date);
  for (let n = 0; n < SCAN_DAYS; n++) {
    d = d.add({ days: dir });
    const s = d.toString();
    if (hasHours(s) && !pto.has(s)) return s;
  }
  return null;
}

/**
 * The one day carry-over is offered on: the earliest upcoming day (from `start`) that can be planned and is
 * not committed yet. Never several days at once, so an unfinished pick can't be offered twice.
 */
export function carryTarget(start: IsoDate, isCommitted: (d: IsoDate) => boolean, pto: ReadonlySet<IsoDate> = new Set(), hasHours: HasHours = monToThu): IsoDate | null {
  let d = Temporal.PlainDate.from(start);
  for (let n = 0; n < SCAN_DAYS; n++, d = d.add({ days: 1 })) {
    const s = d.toString();
    if (hasHours(s) && !pto.has(s) && !isCommitted(s)) return s;
  }
  return null;
}
