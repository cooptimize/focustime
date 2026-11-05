// Step 16.2: the status each mode shows on its tab's mode switch. Shown, never forced: a ✓ when it was done for that
// day (or week), a small dot while it is due, nothing otherwise. Pure; times are "HH:MM" in the configured zone.
import { toMin, type Hm } from "../week/hours.ts";

export type ModeStatus = "done" | "due" | null;

export type DayFacts = {
  /** The day the switch is about (Today's selected day). */
  date: string;
  /** Today in the configured zone, and the time now. */
  today: string;
  time: Hm;
  /** The day has working hours and isn't PTO. */
  workday: boolean;
  /** Where the morning ends (lunch start or midday) and the afternoon starts; null without hours. */
  amEnd: Hm | null;
  pmStart: Hm | null;
  /** End of the working day (its last span); null without hours. */
  end: Hm | null;
  committed: boolean;
  checkedIn: boolean;
  closedOut: boolean;
  /** Settings > Planning: Check-in from the end of lunch plus this many minutes. */
  checkinOffsetMinutes: number;
  /** Settings > Planning: the Close out reminder, minutes before the end of the day. */
  closeoutLeadMinutes: number;
};

/** The last hour of the day counts as "near the end", or longer when the Close out reminder is set earlier. */
export const CLOSEOUT_WINDOW_MINUTES = 60;

/** When Close out becomes due on a day (minutes since midnight), or null without an end. */
const closeoutFrom = (f: DayFacts) => (f.end ? toMin(f.end) - Math.max(CLOSEOUT_WINDOW_MINUTES, f.closeoutLeadMinutes) : null);

/**
 * Plan: ✓ once the day is committed; due on today's morning (before the morning ends) while it isn't.
 * Check-in: ✓ once done (or the day closed out); due on a planned day from the end of lunch (plus the offset) until
 *   Close out becomes due.
 * Close out: ✓ once the day is closed out; due near the end of today's working hours (and after, the same day).
 * Only today has due dots; another day shows only ✓.
 */
export function dayModeStatus(f: DayFacts): { plan: ModeStatus; checkin: ModeStatus; closeout: ModeStatus } {
  const isToday = f.date === f.today;
  const now = toMin(f.time);
  const due = isToday && f.workday;
  const close = closeoutFrom(f);
  const plan: ModeStatus = f.committed ? "done" : due && now < toMin(f.amEnd ?? f.end ?? "12:00") ? "due" : null;
  const checkin: ModeStatus =
    f.checkedIn || f.closedOut ? "done" : due && f.committed && f.pmStart && now >= toMin(f.pmStart) + f.checkinOffsetMinutes && (close === null || now < close) ? "due" : null;
  const closeout: ModeStatus = f.closedOut ? "done" : due && close !== null && now >= close ? "due" : null;
  return { plan, checkin, closeout };
}

/** Plan the week: ✓ once that week is committed; due while a week nudge asks for that week. */
export function weekModeStatus(committed: boolean, nudgeWeek: string | null, weekStart: string): ModeStatus {
  return committed ? "done" : nudgeWeek === weekStart ? "due" : null;
}

/**
 * NV-1: Today's card for the moment of the day, or none. Only on today, a workday:
 * - Close out: from the time Close out is due (the end of the day minus its window); once closed out (even early) a
 *   small "Closed out ✓" line instead, reopenable.
 * - Midday check-in: from the afternoon's start plus the Check-in offset until Close out is due; once done, a small
 *   "Checked in ✓" line instead.
 * - Plan today: while today isn't committed, until the afternoon starts (until the end of the day when there is no
 *   afternoon). It opens Week's Board focused on today and goes once the day is committed.
 */
export type Moment = { kind: "plan" | "checkin" | "closeout"; done: boolean };
export function momentCard(f: DayFacts): Moment | null {
  if (f.date !== f.today || !f.workday) return null;
  if (f.closedOut) return { kind: "closeout", done: true };
  const now = toMin(f.time);
  const close = closeoutFrom(f);
  if (close !== null && now >= close) return { kind: "closeout", done: false };
  const checkFrom = f.pmStart ? toMin(f.pmStart) + f.checkinOffsetMinutes : null;
  if (checkFrom !== null && now >= checkFrom) return { kind: "checkin", done: f.checkedIn };
  const planUntil = f.pmStart ? toMin(f.pmStart) : f.end ? toMin(f.end) : null;
  if (!f.committed && (planUntil === null || now < planUntil)) return { kind: "plan", done: false };
  return null;
}
