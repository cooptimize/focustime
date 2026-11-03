// A3, the idle rule: when nobody is using FocusTime, the scheduler sleeps until the next moment one person's
// background work could do something, instead of passing every few seconds (so a serverless database can pause).
// This is that moment for one person, from what their passes weigh: a running focus timer (its end, a meeting
// warning, the 5-minute calendar refresh while it runs), and the reminders' windows on their working hours (the day's
// plan, check-in, close out, the week nudges, the once-a-workday notices and the VM, which go at work start or
// midnight). Early is harmless (a pass that finds nothing due does nothing); late is not, so every candidate counts.
import { hoursOn, type TimeModel } from "../week/hours.ts";
import { remainingMs, WARN_MINUTES, type TimerState, type WarnPoint } from "./timer.ts";

export type WakeFacts = {
  now: Temporal.Instant;
  zone: string;
  /** Working hours (null: none set up; then only the timer, the week nudges and midnight count). */
  hours: TimeModel | null;
  offsets: { reminderMinutes: number; checkinMinutes: number; closeoutMinutes: number; weekNudges: readonly string[] };
  timer: TimerState | null;
  /** Today's meeting and window-end warning points (what a running session is warned about). */
  warnPoints: readonly WarnPoint[];
  /** Something waits for the next pass (a Teams status to clear, a notice held for after focus). */
  pending: boolean;
};

/** While a timer runs, today's calendars are reloaded this often (as the fast pass does). */
export const RUNNING_RECHECK_MS = 5 * 60_000;

const at = (date: Temporal.PlainDate, hm: string, zone: string, plusMinutes = 0): Temporal.Instant | null => {
  if (!/^\d\d:\d\d$/.test(hm)) return null;
  const day = hm === "24:00" ? date.add({ days: 1 }) : date;
  return day.toZonedDateTime({ timeZone: zone, plainTime: hm === "24:00" ? "00:00" : hm }).add({ minutes: plusMinutes }).toInstant();
};

/** The next moment this person's background work could be due: never later than the next midnight in their zone. */
export function nextWake(f: WakeFacts): Temporal.Instant {
  if (f.pending) return f.now;
  const out: (Temporal.Instant | null)[] = [];
  const t = f.timer;
  if (t && !t.ended && t.runningSince) {
    out.push(f.now.add({ milliseconds: remainingMs(t, f.now) }), f.now.add({ milliseconds: RUNNING_RECHECK_MS }));
    for (const p of f.warnPoints) if (!t.warned.includes(p.key)) out.push(Temporal.Instant.from(p.at).subtract({ minutes: WARN_MINUTES }));
  }
  const today = f.now.toZonedDateTimeISO(f.zone).toPlainDate();
  for (const date of [today, today.add({ days: 1 })]) {
    // Just after midnight: a new day, and the VM's auto-shutdown is put back on the first pass after it.
    out.push(date.toZonedDateTime({ timeZone: f.zone }).toInstant().add({ minutes: 1 }));
    for (const hm of f.offsets.weekNudges) out.push(at(date, hm, f.zone));
    if (!f.hours) continue;
    const h = hoursOn(f.hours, date.toString());
    for (const s of h.segments) out.push(at(date, s.start, f.zone), at(date, s.end, f.zone));
    if (h.main) out.push(at(date, h.main.start, f.zone, f.offsets.reminderMinutes));
    if (h.pm) out.push(at(date, h.pm.start, f.zone, f.offsets.checkinMinutes));
    const end = h.segments.at(-1)?.end;
    if (end) out.push(at(date, end, f.zone, -f.offsets.closeoutMinutes));
  }
  const later = out.filter((x): x is Temporal.Instant => !!x && Temporal.Instant.compare(x, f.now) > 0);
  return later.reduce((a, b) => (Temporal.Instant.compare(a, b) <= 0 ? a : b));
}
