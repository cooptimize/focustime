// Notifications (step 15.5): which kinds there are, whether one goes out now, is held for later or not sent, how held
// ones collapse into one, and where clicking one opens Coopilot. Pure: no I/O, no host. The host only shows a
// notification and says which button was clicked (desktop today, browser notifications in a hosted version).
import { hoursOn, type TimeModel } from "../week/hours.ts";

/** Every kind of notification Coopilot sends. Each has its own switch in Settings > Notifications, except the test. */
export const NOTIFY_KINDS = ["plan_day", "checkin", "closeout", "plan_week", "look_ahead", "timer", "meeting", "vm", "followups", "expiry"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type AnyKind = NotifyKind | "test" | "held";

export const KIND_LABEL: Record<NotifyKind, string> = {
  plan_day: "Plan the day",
  checkin: "Check-in",
  closeout: "Close out",
  plan_week: "Plan the week",
  look_ahead: "Look ahead",
  timer: "Focus timer",
  meeting: "Meeting warnings",
  vm: "My VM",
  followups: "Follow-ups due",
  expiry: "Expiring secrets",
};
export const KIND_HINT: Record<NotifyKind, string> = {
  plan_day: "At the start of a workday when the day isn't planned yet.",
  checkin: "After lunch on a planned day.",
  closeout: "Near the end of the workday until you close out.",
  plan_week: "Monday morning when this week has no plan.",
  look_ahead: "Thursday and Friday when next week has no plan.",
  timer: "When a focus session or break ends, with Done, +15 min and Next pick.",
  meeting: "5 minutes before a meeting while a focus session runs.",
  vm: "Your VM is off at work start (with Start), or its auto-shutdown couldn't be put back (with Restore).",
  followups: "Once a workday when follow-ups are due today or overdue.",
  expiry: "Once a workday when a PAT or secret expires within 14 days.",
};
/** The ritual reminders, shown as one group in Settings. */
export const RITUAL_KINDS: readonly NotifyKind[] = ["plan_day", "checkin", "closeout", "plan_week", "look_ahead"];

export type QuietMode = "outside_hours" | "off";
export type NotifySettings = { kinds: Record<NotifyKind, boolean>; quiet: QuietMode; quietPto: boolean };
export const DEFAULT_NOTIFY: NotifySettings = {
  kinds: Object.fromEntries(NOTIFY_KINDS.map((k) => [k, true])) as Record<NotifyKind, boolean>,
  quiet: "outside_hours",
  quietPto: true,
};

/** Where clicking a notification opens Coopilot. */
export type Route =
  | { view: "today" | "planday" | "checkin" | "closeout" | "focus" | "vm" | "inbox" }
  | { view: "planweek"; weekStart: string }
  | { view: "followup"; id: number }
  | { view: "settings"; section: string };

const SIMPLE = new Set(["today", "planday", "checkin", "closeout", "focus", "vm", "inbox"]);
const SECTION = /^[a-z]{2,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "planweek:2026-11-09", "followup:12", "settings:notifications" or a plain view. */
export function routeText(r: Route): string {
  if (r.view === "planweek") return `planweek:${r.weekStart}`;
  if (r.view === "followup") return `followup:${r.id}`;
  if (r.view === "settings") return `settings:${r.section}`;
  return r.view;
}

/** The route in a stored or posted text, or null for anything unknown. */
export function parseRoute(s: unknown): Route | null {
  if (typeof s !== "string" || s.length > 40) return null;
  if (SIMPLE.has(s)) return { view: s as "today" };
  const [view, arg = "", ...rest] = s.split(":");
  if (rest.length) return null;
  if (view === "planweek" && DATE.test(arg)) return { view, weekStart: arg };
  if (view === "followup" && /^[1-9]\d{0,9}$/.test(arg)) return { view, id: Number(arg) };
  if (view === "settings" && SECTION.test(arg)) return { view, section: arg };
  return null;
}

export type NotifyButton = { key: string; label: string };

/** One notification, as stored while held and as handed to the host. Text only: no tokens, no event details beyond what the UI shows. */
export type Notice = {
  kind: AnyKind;
  /** The occasion: the same key is never shown twice (e.g. "plan_day:2026-11-02"). */
  key: string;
  title: string;
  body: string;
  buttons: NotifyButton[];
  route: string;
  /** When it was first due (ISO instant). */
  at: string;
};

export type GateFacts = {
  settings: NotifySettings;
  /** Within today's working hours (any span, an evening counts). */
  inHours: boolean;
  pto: boolean;
  /** A focus session runs (not a break, not paused counts as running too while it has time left). */
  focusRunning: boolean;
};

export type Gate = "send" | "hold" | "off" | "quiet";

/**
 * Whether a notification goes out now:
 * - off: its switch is off.
 * - The timer and meeting warnings belong to a session I started: never quiet, never held.
 * - quiet: outside working hours (unless quiet hours are off) or on a PTO day. Not sent and not marked, so a reminder
 *   still due when quiet hours end goes out then.
 * - hold: during a focus session; sent when the session ends.
 * The test notification always goes out.
 */
export function gate(kind: AnyKind, f: GateFacts): Gate {
  if (kind === "test" || kind === "held") return "send";
  if (!f.settings.kinds[kind]) return "off";
  if (kind === "timer" || kind === "meeting") return "send";
  if (f.settings.quietPto && f.pto) return "quiet";
  if (f.settings.quiet === "outside_hours" && !f.inHours) return "quiet";
  if (f.focusRunning) return "hold";
  return "send";
}

/** Whether a time is inside one of the day's working spans (start inclusive, end exclusive). */
export function inWorkingHours(model: TimeModel, now: Temporal.ZonedDateTime): boolean {
  const z = now.withTimeZone(model.timeZone);
  const t = z.toPlainTime().toString({ smallestUnit: "minute" });
  return hoursOn(model, z.toPlainDate().toString()).segments.some((s) => t >= s.start && (s.end === "24:00" || t < s.end));
}

const MAX_LINES = 4;

/**
 * Held notifications, delivered when a focus session ends: one as it was; several as one "While you were focused"
 * that lists them and opens Today (or their one shared view). No buttons on a collapsed one.
 */
export function collapse(held: readonly Notice[], at: string): Notice | null {
  if (!held.length) return null;
  if (held.length === 1) return held[0]!;
  const routes = new Set(held.map((n) => n.route));
  // Titles on one line: notification popups show about three lines.
  const names = held.slice(0, MAX_LINES).map((n) => n.title);
  if (held.length > MAX_LINES) names.push(`${held.length - MAX_LINES} more`);
  const lines = [names.join(" · "), routes.size === 1 ? "Click to open." : "Click to open Today."];
  return {
    kind: "held",
    key: `held:${held.map((n) => n.key).join("|")}`.slice(0, 500),
    title: `While you were focused (${held.length})`,
    body: lines.join("\n"),
    buttons: [],
    route: routes.size === 1 ? held[0]!.route : "today",
    at,
  };
}

/** The keys a clicked notification marks handled (a collapsed one stands for each it lists). */
export const handledKeys = (n: Notice, held: readonly Notice[] = []): string[] => (n.kind === "held" ? held.map((h) => h.key) : [n.key]);

/** The page event that opens a route in the window (a hosted version's browser notifications would use it too). */
export const ROUTE_EVENT = "coopilot:open-route";

/** "Open" is the click on the notification itself (the freedesktop "default" action). */
export const OPEN_KEY = "default";

// ---- The notifications themselves: text, buttons and where a click opens Coopilot. ----

const open = (label: string): NotifyButton => ({ key: "open", label });
const shortDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });

export const notices = {
  planDay: (date: string, at: string): Notice => ({ kind: "plan_day", key: `plan_day:${date}`, title: "Plan the day", body: "Today isn't planned yet.\nClick to plan the day.", buttons: [open("Plan the day")], route: "planday", at }),
  checkin: (date: string, at: string): Notice => ({ kind: "checkin", key: `checkin:${date}`, title: "Check-in", body: "Midday check-in: what still fits this afternoon.\nClick to check in.", buttons: [open("Check in")], route: "checkin", at }),
  closeout: (date: string, at: string): Notice => ({ kind: "closeout", key: `closeout:${date}`, title: "Close out", body: "Time to close out the day: picks, resume notes and follow-ups.\nClick to close out.", buttons: [open("Close out")], route: "closeout", at }),
  /** Monday for this week (Plan the week), Thursday and Friday for next week (Look ahead). */
  week: (weekStart: string, thisWeek: boolean, at: string): Notice => ({
    kind: thisWeek ? "plan_week" : "look_ahead",
    key: `week:${weekStart}:${at.slice(0, 10)}`,
    title: thisWeek ? "Plan the week" : "Look ahead",
    body: `${thisWeek ? "This week" : `Next week (${shortDay(weekStart)})`} isn't planned yet: choose each client's features.\nClick to plan it.`,
    buttons: [open("Plan the week")],
    route: `planweek:${weekStart}`,
    at,
  }),
  timerEnd: (breakOver: boolean, label: string, startedAt: string, at: string): Notice => ({
    kind: "timer",
    key: `timer:${startedAt}`,
    title: breakOver ? "Break over" : "Focus session done",
    body: `${label}\nClick for Done, +15 min or Next pick.`,
    buttons: [{ key: "done", label: "Done" }, { key: "extend", label: "+15 min" }, { key: "next", label: "Next pick" }],
    route: "focus",
    at,
  }),
  meeting: (labels: string[], keys: string[], at: string): Notice => ({ kind: "meeting", key: `meeting:${keys.join("|")}`.slice(0, 300), title: "In 5 minutes", body: labels.join("\n"), buttons: [], route: "focus", at }),
  vmOff: (date: string, vmName: string, at: string): Notice => ({ kind: "vm", key: `vm_off:${date}`, title: "Your VM is off", body: `${vmName} is stopped.\nClick to start it.`, buttons: [{ key: "start", label: "Start" }], route: "vm", at }),
  vmChanged: (date: string, text: string, at: string): Notice => ({ kind: "vm", key: `vm_changed:${date}`, title: "Auto-shutdown is still changed", body: `${text}. Coopilot couldn't put it back.\nClick to restore it.`, buttons: [{ key: "restore", label: "Restore" }], route: "today", at }),
  followUps: (date: string, due: { id: number; what: string; overdue: boolean }[], at: string): Notice | null => {
    if (!due.length) return null;
    const over = due.filter((f) => f.overdue).length;
    const today = due.length - over;
    const counts = [today ? `${today} due today` : "", over ? `${over} overdue` : ""].filter(Boolean).join(", ");
    return {
      kind: "followups",
      key: `followups:${date}`,
      title: due.length === 1 ? "Follow-up due" : "Follow-ups due",
      body: `${due.length === 1 ? `${due[0]!.what} (${counts})` : `${counts}: ${due[0]!.what} and ${due.length - 1} more`}\nClick to open ${due.length === 1 ? "it" : "the Inbox"}.`,
      buttons: [open(due.length === 1 ? "Open it" : "Open Inbox")],
      route: due.length === 1 ? `followup:${due[0]!.id}` : "inbox",
      at,
    };
  },
  expiry: (date: string, lines: { text: string; section: string }[], at: string): Notice | null =>
    lines.length
      ? { kind: "expiry", key: `expiry:${date}`, title: lines.length === 1 ? "Expiring soon" : `${lines.length} expiring soon`, body: lines.slice(0, 3).map((l) => l.text).join("\n"), buttons: [open("Open Settings")], route: `settings:${lines[0]!.section}`, at }
      : null,
};

/** Open follow-ups due today or overdue (not snoozed past today), overdue first. */
export function dueFollowUps(open: readonly { id: number; what: string; due: string | null; snoozedUntil: string | null; closedAt: string | null }[], today: string): { id: number; what: string; overdue: boolean }[] {
  return open
    .filter((f) => !f.closedAt && f.due && f.due <= today && !(f.snoozedUntil && f.snoozedUntil > today))
    .sort((a, b) => a.due!.localeCompare(b.due!) || a.id - b.id)
    .map((f) => ({ id: f.id, what: f.what, overdue: f.due! < today }));
}
