// One desktop reminder per day with working hours when today isn't committed yet (step 5), only near the day start (Q23). Never
// repeats: the store keeps a marker per date, so a restart or a second check the same day sends nothing.
import { spawn } from "node:child_process";
import { OPEN_KEY, type Notice } from "../plan/notify.ts";
import { WEEK_NUDGE_MESSAGE, weekNudges, type NudgeTimes } from "../plan/weekplan.ts";
import { hoursOn, type TimeModel } from "../week/hours.ts";

/** The reminder can fire only this long after the day's start (Q23). */
export const REMINDER_WINDOW_MINUTES = 90;

/**
 * Whether the reminder is due now: on a day with working hours, from the start of its main span until 90 minutes
 * after it, today not committed (step 6b: the time model, not Mon–Thu).
 */
export function reminderDue(now: Temporal.ZonedDateTime, model: TimeModel, committed: boolean, offsetMinutes = 0): boolean {
  if (committed) return false;
  const main = hoursOn(model, now.toPlainDate().toString()).main;
  if (!main) return false;
  // Settings > Planning (step 6c): the reminder can start later than the day does.
  const start = now.withPlainTime(Temporal.PlainTime.from(main.start)).add({ minutes: offsetMinutes });
  const end = start.add({ minutes: REMINDER_WINDOW_MINUTES });
  return Temporal.ZonedDateTime.compare(now, start) >= 0 && Temporal.ZonedDateTime.compare(now, end) < 0;
}

export type ReminderDeps = {
  now: () => Temporal.ZonedDateTime;
  hours: () => Promise<TimeModel | null>;
  /** Minutes after the day's start the reminder may first fire ([plan] reminder_offset_minutes). */
  offsetMinutes?: () => Promise<number>;
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
  const offset = d.offsetMinutes ? await d.offsetMinutes().catch(() => 0) : 0;
  if (!reminderDue(now, model, d.committed(date), offset)) return false;
  if (d.off && (await d.off(date).catch(() => false))) return false;
  if (!d.once(date)) return false;
  d.send("Coopilot", "Today isn't planned yet. Open Coopilot and press P to plan the day.");
  return true;
}

/** The icon name every notification carries (step 17.5): the hicolor icons installed by system/install-icons.sh. */
export const NOTIFY_ICON = "coopilot";

/** notify-send with a fixed argument list (no shell). Fire and forget: for a line that needs no buttons or click. */
export function notifySend(title: string, body: string) {
  const p = spawn("notify-send", ["--app-name=Coopilot", "--urgency=normal", `--icon=${NOTIFY_ICON}`, title, body], { stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}

/**
 * Step 15.5, the desktop host's notifications (a hosted version would use browser notifications behind the same
 * NotifyHost): notify-send with a fixed argument list (no shell), the click on the notification itself as the
 * freedesktop "default" action, and its buttons. notify-send waits while a notification with actions is open and
 * prints the chosen key; resolves null when it is dismissed or expires. Only known keys are passed on (the notifier
 * checks again).
 */
export function desktopNotify(n: Notice, shown?: (handle: string) => void): Promise<string | null> {
  return new Promise((resolve) => {
    // --print-id (Q91): the first line is the notification's id, so it can be closed when its occasion is handled.
    const args = ["--app-name=Coopilot", "--urgency=normal", "--print-id", `--icon=${NOTIFY_ICON}`, `--action=${OPEN_KEY}=Open`, ...n.buttons.map((b) => `--action=${b.key}=${b.label}`), n.title, n.body];
    const p = spawn("notify-send", args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    let told = false;
    p.stdout.on("data", (c: Buffer) => {
      out += c.toString();
      const first = out.split("\n")[0]!;
      if (!told && out.includes("\n") && /^\d{1,10}$/.test(first)) {
        told = true;
        shown?.(first);
      }
    });
    p.on("error", () => resolve(null));
    p.on("close", () => {
      const lines = out.trim().split("\n");
      const key = (/^\d{1,10}$/.test(lines[0] ?? "") ? lines.slice(1) : lines).join("").trim();
      resolve(key === OPEN_KEY || n.buttons.some((b) => b.key === key) ? key : null);
    });
  });
}

/**
 * Q91: withdraws a notification Coopilot showed (freedesktop CloseNotification, fixed arguments, no shell). A
 * service that ignores it leaves the notification; clicking it then opens a view that shows the thing is done.
 */
export function closeDesktopNotification(handle: string) {
  if (!/^\d{1,10}$/.test(handle)) return;
  const p = spawn("gdbus", ["call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.CloseNotification", handle], { stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}

// ---- Check-in and Close out reminders (step 7): once a day each, near midday and near the end of the day. ----

const at = (now: Temporal.ZonedDateTime, hm: string) => (hm === "24:00" ? now.withPlainTime("00:00").add({ days: 1 }) : now.withPlainTime(Temporal.PlainTime.from(hm)));
const within = (now: Temporal.ZonedDateTime, start: Temporal.ZonedDateTime) => Temporal.ZonedDateTime.compare(now, start) >= 0 && Temporal.ZonedDateTime.compare(now, start.add({ minutes: REMINDER_WINDOW_MINUTES })) < 0;

/** Close out: from `offset` minutes before the end of today's working hours (an evening counts) for 90 minutes, if not closed out. */
export function closeoutReminderDue(now: Temporal.ZonedDateTime, model: TimeModel, closedOut: boolean, offsetMinutes: number): boolean {
  if (closedOut) return false;
  const end = hoursOn(model, now.toPlainDate().toString()).segments.at(-1)?.end;
  return !!end && within(now, at(now, end).subtract({ minutes: offsetMinutes }));
}

/** Check-in: from the end of lunch (or midday without one) plus `offset`, for 90 minutes, only on a committed day. */
export function checkinReminderDue(now: Temporal.ZonedDateTime, model: TimeModel, committed: boolean, offsetMinutes: number): boolean {
  if (!committed) return false;
  const pm = hoursOn(model, now.toPlainDate().toString()).pm;
  return !!pm && within(now, at(now, pm.start).add({ minutes: offsetMinutes }));
}

export type DayReminderDeps = {
  now: () => Temporal.ZonedDateTime;
  hours: () => Promise<TimeModel | null>;
  /** Whether the reminder is due (the rule above, with today's plan state and the offset). */
  due: (now: Temporal.ZonedDateTime, model: TimeModel) => Promise<boolean> | boolean;
  off?: (date: string) => Promise<boolean>;
  once: (date: string) => boolean;
  send: () => void;
};

/** One check of a once-a-day reminder; true when it was sent. */
export async function checkDayReminder(d: DayReminderDeps): Promise<boolean> {
  const model = await d.hours();
  if (!model) return false;
  const now = d.now().withTimeZone(model.timeZone);
  const date = now.toPlainDate().toString();
  if (!(await d.due(now, model))) return false;
  if (d.off && (await d.off(date).catch(() => false))) return false;
  if (!d.once(date)) return false;
  d.send();
  return true;
}

export const CLOSEOUT_MESSAGE = "Time to close out the day: picks, resume notes and follow-ups. Open Coopilot and press E.";
export const CHECKIN_MESSAGE = "Midday check-in: what still fits this afternoon. Open Coopilot and press M.";

/**
 * Plan the week nudges (step 8): Thursday and Friday for next week, Monday for this week, each from its time (Settings
 * > Planning) until the end of that day, only while that week isn't committed, never on a PTO day, and each once per
 * week (`once`, the store's markOnce). Returns how many were sent.
 */
export async function checkWeekNudges(d: {
  now: () => Temporal.ZonedDateTime;
  times: () => Promise<NudgeTimes | null>;
  committed: (weekStart: string) => boolean;
  off: (date: string) => Promise<boolean>;
  once: (key: string, weekStart: string) => boolean;
  send: (body: string, weekStart: string) => void;
  /** Today's working start ("HH:MM"), or null with no working time today (Q50: a skipped nudge fires then). */
  workStart?: (date: string) => Promise<string | null>;
}): Promise<number> {
  const times = await d.times();
  if (!times) return 0;
  const now = d.now();
  const today = now.toPlainDate().toString();
  const start = d.workStart ? await d.workStart(today).catch(() => null) : undefined;
  const { due } = weekNudges(now, times, d.committed, start === undefined ? {} : { workStart: start ? Temporal.PlainTime.from(start) : null });
  if (!due.length) return 0;
  if (await d.off(today).catch(() => false)) return 0;
  const thisWeek = now.toPlainDate().subtract({ days: now.dayOfWeek - 1 }).toString();
  let n = 0;
  // One message per week, however many of its nudges are due; each is marked so none repeats.
  for (const weekStart of [...new Set(due.map((x) => x.weekStart))]) {
    const fresh = due.filter((x) => x.weekStart === weekStart).map((x) => d.once(x.key, weekStart));
    if (!fresh.some(Boolean)) continue;
    d.send(WEEK_NUDGE_MESSAGE(weekStart, weekStart === thisWeek), weekStart);
    n++;
  }
  return n;
}

