// One desktop reminder per day with working hours when today isn't committed yet (step 5), only near the day start (Q23). Never
// repeats: the store keeps a marker per date, so a restart or a second check the same day sends nothing.
import { spawn } from "node:child_process";
import { hoursOn, type TimeModel } from "../week/hours.ts";

/** The reminder can fire only this long after the day's start (Q23). */
export const REMINDER_WINDOW_MINUTES = 90;

/**
 * Whether the reminder is due now: on a day with working hours, from the start of its main span until 90 minutes
 * after it, today not committed (step 6b: the time model, not Mon–Thu).
 */
export function reminderDue(now: Temporal.ZonedDateTime, model: TimeModel, committed: boolean): boolean {
  if (committed) return false;
  const main = hoursOn(model, now.toPlainDate().toString()).main;
  if (!main) return false;
  const start = now.withPlainTime(Temporal.PlainTime.from(main.start));
  const end = start.add({ minutes: REMINDER_WINDOW_MINUTES });
  return Temporal.ZonedDateTime.compare(now, start) >= 0 && Temporal.ZonedDateTime.compare(now, end) < 0;
}

export type ReminderDeps = {
  now: () => Temporal.ZonedDateTime;
  hours: () => Promise<TimeModel | null>;
  committed: (date: string) => boolean;
  /** Whether a date is a PTO day (D106): no reminder then. Asked only when a reminder would otherwise be due. */
  off?: (date: string) => Promise<boolean>;
  /** True the first time for a date (the store's markOnce). */
  once: (date: string) => boolean;
  send: (title: string, body: string) => void;
};

/** One check; returns true when a reminder was sent. */
export async function checkReminder(d: ReminderDeps): Promise<boolean> {
  const model = await d.hours();
  if (!model) return false;
  const now = d.now().withTimeZone(model.timeZone);
  const date = now.toPlainDate().toString();
  if (!reminderDue(now, model, d.committed(date))) return false;
  if (d.off && (await d.off(date).catch(() => false))) return false;
  if (!d.once(date)) return false;
  d.send("Coopilot", "Today isn't planned yet. Open Coopilot and press P to plan the day.");
  return true;
}

/** notify-send with a fixed argument list (no shell). Fire and forget. */
export function notifySend(title: string, body: string) {
  const p = spawn("notify-send", ["--app-name=Coopilot", "--urgency=normal", title, body], { stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}
