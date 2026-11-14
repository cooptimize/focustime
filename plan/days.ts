// Which days Plan the day can open, how much of a day can be changed, and where carry-over is offered
// ("Plan any day"). Pure: the caller passes today, PTO and commits.
import type { IsoDate } from "../week/types.ts";
import type { PtoDay } from "../week/pto.ts";
import { isPlanWorkday } from "./target.ts";
import { hoursText } from "./estimate.ts";

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
    return { ok: false, kind: "no_hours", reason: `${dayLabel(date)} has no working hours, so there is nothing to plan. Give it working hours (its Actions menu on Week, or Settings) or add a flex session` };
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
 * The one day carry-over is offered on: the next day (from `start`) that can take work (working hours, not PTO).
 * Never several days at once, so an unfinished pick can't be offered twice. CF-1: was "the earliest day that isn't
 * confirmed"; there is no confirm.
 */
export function carryTarget(start: IsoDate, pto: ReadonlySet<IsoDate> = new Set(), hasHours: HasHours = monToThu): IsoDate | null {
  let d = Temporal.PlainDate.from(start);
  for (let n = 0; n < SCAN_DAYS; n++, d = d.add({ days: 1 })) {
    const s = d.toString();
    if (hasHours(s) && !pto.has(s)) return s;
  }
  return null;
}

export type PlanButton = "hidden" | "plan" | "planned" | "add_hours";
/**
 * The Plan button in a day header (step 13.6, D240): "Plan", "Planned ✓" once it has to-dos (CF-1), or hidden. Friday with work
 * on it and no hours shows the "Add hours" link instead (Plan the day plans against working time).
 */
export function planButton(d: { date: IsoDate; today: IsoDate; pto: boolean; hasHours: boolean; hasPicks: boolean }): PlanButton {
  if (d.pto) return "hidden";
  if (!d.hasHours) return Temporal.PlainDate.from(d.date).dayOfWeek === 5 && d.hasPicks ? "add_hours" : "hidden";
  if (d.date < d.today) return d.hasPicks ? "planned" : "hidden";
  return d.hasPicks ? "planned" : "plan";
}

/** "+ Add work" on a block card and key A (step 13.6, D241): today or later, not PTO, with working time. */
export const canAddWork = (b: { date: IsoDate; today: IsoDate; pto: boolean; off: boolean }) => b.date >= b.today && !b.pto && !b.off;

/**
 * AS-2: a to-do may go on any day that hasn't ended. A weekend, Friday's catch-up, a day without working hours and a
 * PTO day all take it, with a short note instead of a refusal (the Board's drop tip, pick.move's answer and the
 * assistant's preview say the same thing). Null: a normal working day.
 */
export function placeNote(date: IsoDate, o: { pto: boolean; hasHours: boolean }): string | null {
  const d = Temporal.PlainDate.from(date);
  const name = d.toLocaleString("en-US", { weekday: "long" });
  if (o.pto) return "You're on PTO that day";
  if (o.hasHours) return null;
  if (d.dayOfWeek >= 6) return `${name} isn't a working day: this is flex time`;
  if (d.dayOfWeek === 5) return "Friday is your catch-up day";
  return `${name} has no working hours: this is flex time`;
}

/**
 * QT-2: the assistant's move preview note, the target block's free time as a fact: "Wednesday PM: 3h free", or
 * "Wednesday PM: no free time". Replaced AS-2's "Over your Wednesday PM hours by 1h"; nothing says the work is too much.
 */
export const freeNote = (date: IsoDate, half: "AM" | "PM" | "EVE", freeMinutes: number) =>
  `${Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" })} ${half === "EVE" ? "evening" : half}: ${freeMinutes > 0 ? `${hoursText(freeMinutes)} free` : "no free time"}`;

/** A day off's words: "PTO · Trip", or an observed holiday's own name ("Thanksgiving Day (observed)", "Holiday"; PS-1). */
export function ptoLabel(p: PtoDay): string {
  return p.holiday ?? `PTO · ${p.titles.join(", ")}`;
}

/** PS-1: a day header's chip: "Holiday" on an observed holiday (it wins over PTO), else "PTO". */
export const offWord = (p: PtoDay | null | undefined) => (p?.holiday ? "Holiday" : "PTO");
