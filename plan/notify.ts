// Notifications (step 15.5): which kinds there are, whether one goes out now, is held for later or not sent, how held
// ones collapse into one, and where clicking one opens FocusTime. Pure: no I/O, no host. The host only shows a
// notification and says which button was clicked (desktop today, browser notifications in a hosted version).
import { hoursOn, type TimeModel } from "../week/hours.ts";
import { userZone } from "../week/zone.ts";
import { DEFAULT_TEAMS_RHYTHM, type TeamsRhythm } from "./teams-rhythm.ts";
import { DEFAULT_STATUS_TIMES, type StatusTimes } from "./status-report.ts";

/** Every kind of notification FocusTime sends. Each has its own switch in Settings > Notifications, except the test. */
export const NOTIFY_KINDS = ["plan_day", "checkin", "closeout", "plan_week", "look_ahead", "plan_ahead", "direction", "timer", "meeting", "vm", "followups", "expiry", "asks", "commitment_item", "taken_over", "story_taken", "sent_to_you", "send_answered", "send_cant_lead", "look_ask", "look_reply", "assigned", "dates_moved", "status_report", "meeting_review", "conversation_given", "conversation_activity"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type AnyKind = NotifyKind | "test" | "held";

export const KIND_LABEL: Record<NotifyKind, string> = {
  plan_day: "Add work to today",
  checkin: "Check-in",
  closeout: "Close out",
  plan_week: "Add work to the week",
  look_ahead: "Look ahead",
  plan_ahead: "Look ahead 4 weeks",
  direction: "Direction review",
  timer: "Focus timer",
  meeting: "Meeting warnings",
  vm: "My VM",
  followups: "Promises due",
  expiry: "Expiring secrets",
  asks: "Urgent requests",
  commitment_item: "DevOps item not created yet",
  taken_over: "Someone took over your promise",
  story_taken: "Someone took your story",
  sent_to_you: "Work sent to your week",
  send_answered: "Answers to work you sent",
  send_cant_lead: "A Must someone can't take",
  look_ask: "Asked to look at a week",
  look_reply: "A lead's reply about your week",
  assigned: "Someone assigned you an item",
  dates_moved: "Someone moved your dates",
  status_report: "Monday's status report",
  meeting_review: "Client calls to review",
  conversation_given: "A conversation handed to you",
  conversation_activity: "New on a conversation you have",
};
export const KIND_HINT: Record<NotifyKind, string> = {
  plan_day: "At the start of a workday when nothing is on today yet.",
  checkin: "After lunch when today has to-dos and you haven't closed out.",
  closeout: "Near the end of the workday until you close out.",
  plan_week: "Monday morning when nothing is on this week yet.",
  look_ahead: "Thursday and Friday when nothing is on next week yet.",
  plan_ahead: "Every other Thursday, once next week has work on it.",
  direction: "The first Thursday of each month.",
  timer: "When a focus session or break ends.",
  meeting: "5 minutes before a meeting while a focus session runs.",
  vm: "VM off at work start.",
  followups: "Once a workday when promises are due today or overdue.",
  expiry: "Once a workday when a PAT or secret expires within 14 days.",
  asks: "When AI sorts a request from a client chat you are in as needing someone now.",
  commitment_item: "Once, when a promise in a client chat needs a DevOps item and a working day has passed without one.",
  taken_over: "When a teammate takes over something you said you'd do in a client chat.",
  story_taken: "When a teammate takes a DevOps story assigned to you with Take one in FocusTime.",
  sent_to_you: "When a teammate sends a feature or story to your week.",
  send_answered: "When someone accepts, passes on or can't take work you sent.",
  send_cant_lead: "On a client you lead, when someone can't take a Must another lead sent.",
  look_ask: "When a teammate asks you, as a client lead, to look at their planned week.",
  look_reply: "When a lead you asked replies about your week.",
  assigned: "When a teammate assigns you a DevOps item from Ahead in FocusTime.",
  dates_moved: "When a teammate moves the dates of a DevOps item you own from Ahead in FocusTime, once per save.",
  status_report: "Friday afternoon (and Sunday evening if you like) when some of your features have no update yet for Monday's report. Off until you turn it on.",
  meeting_review: "After a client call you review, once: its proposals are ready, or its transcript needs uploading.",
  conversation_given: "When a teammate gives you a conversation or adds you as a helper.",
  conversation_activity: "When someone writes in a conversation you have, or asks again on one you closed.",
};
/** PV-1: quiet kinds go to the in-app list only, never to push. */
export const QUIET_KINDS: ReadonlySet<AnyKind> = new Set<AnyKind>(["story_taken", "send_cant_lead", "assigned", "dates_moved"]);
/** The ritual reminders, shown as one group in Settings. */
export const RITUAL_KINDS: readonly NotifyKind[] = ["plan_day", "checkin", "closeout", "plan_week", "look_ahead", "plan_ahead", "direction"];

export type QuietMode = "outside_hours" | "off";
/**
 * pushDetails (P1): push messages say what the notice says (client names, work item titles); off by default.
 * asksThroughFocus (AP-2): an urgent ask is sent during focus instead of held; off by default.
 * teamsMessages (TB-1): FocusTime may message me in Teams on its own; off by default. TB-2: `teams` holds the kinds
 * it may send (brief, check-in, close out, nudges, each off by default) and their times; nothing is sent unless both
 * this switch and the kind's are on.
 */
export type NotifySettings = { kinds: Record<NotifyKind, boolean>; quiet: QuietMode; quietPto: boolean; pushDetails: boolean; asksThroughFocus: boolean; teamsMessages: boolean; teams: TeamsRhythm; status: StatusTimes };
/** SR-1: kinds that start off (every other kind starts on). */
export const OFF_BY_DEFAULT: readonly NotifyKind[] = ["status_report"];
export const DEFAULT_NOTIFY: NotifySettings = {
  kinds: Object.fromEntries(NOTIFY_KINDS.map((k) => [k, !OFF_BY_DEFAULT.includes(k)])) as Record<NotifyKind, boolean>,
  quiet: "outside_hours",
  quietPto: true,
  pushDetails: false,
  asksThroughFocus: false,
  teamsMessages: false,
  teams: DEFAULT_TEAMS_RHYTHM,
  status: DEFAULT_STATUS_TIMES,
};

/** Where clicking a notification opens FocusTime. */
export type Route =
  | { view: "today" | "planday" | "checkin" | "closeout" | "focus" | "vm" | "inbox" | "ahead" | "asks" | "requests" | "conversations" | "my_promises" | "week" | "team" | "status" | "status_needs" }
  | { view: "planweek"; weekStart: string }
  | { view: "followup"; id: number }
  | { view: "aheaditem"; id: number }
  | { view: "settings"; section: string }
  /** MC-1: one call's review (#/meetings/<occurrence>). */
  | { view: "meeting"; id: number };

// "asks": notifications sent before the rename to Requests still open the tab.
const SIMPLE = new Set(["today", "planday", "checkin", "closeout", "focus", "vm", "inbox", "ahead", "asks", "requests", "conversations", "my_promises", "week", "team", "status", "status_needs"]);
const SECTION = /^[a-z]{2,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "planweek:2026-11-09", "followup:12", "settings:notifications" or a plain view. */
export function routeText(r: Route): string {
  if (r.view === "planweek") return `planweek:${r.weekStart}`;
  if (r.view === "followup") return `followup:${r.id}`;
  if (r.view === "aheaditem") return `aheaditem:${r.id}`;
  if (r.view === "settings") return `settings:${r.section}`;
  if (r.view === "meeting") return `meeting:${r.id}`;
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
  if (view === "aheaditem" && /^[1-9]\d{0,9}$/.test(arg)) return { view, id: Number(arg) };
  if (view === "settings" && SECTION.test(arg)) return { view, section: arg };
  if (view === "meeting" && /^[1-9]\d{0,9}$/.test(arg)) return { view, id: Number(arg) };
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
  /** Step 16.2 (Q91): what the occasion is about (a date, a week, a timer session), to tell when it's handled. */
  ref?: string;
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
 * - hold: during a focus session; sent when the session ends (an urgent ask goes through when Settings allows it).
 * The test notification always goes out.
 */
export function gate(kind: AnyKind, f: GateFacts): Gate {
  if (kind === "test" || kind === "held") return "send";
  if (!f.settings.kinds[kind]) return "off";
  if (kind === "timer" || kind === "meeting") return "send";
  if (f.settings.quietPto && f.pto) return "quiet";
  // SR-1: the status nudge keeps to its own times (Friday before my day ends, Sunday evening only when I asked for it).
  if (f.settings.quiet === "outside_hours" && !f.inHours && kind !== "status_report") return "quiet";
  // AP-2: an urgent ask waits for the session to end, unless I let urgent asks through.
  if (f.focusRunning) return kind === "asks" && f.settings.asksThroughFocus ? "send" : "hold";
  return "send";
}

/** Whether a time is inside one of the day's working spans (start inclusive, end exclusive). */
export function inWorkingHours(model: TimeModel, now: Temporal.ZonedDateTime): boolean {
  const z = now.withTimeZone(userZone(model));
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

/** The page event that opens a route in the window (a hosted version's browser notifications would use it too). */
export const ROUTE_EVENT = "focustime:open-route";

/** "Open" is the click on the notification itself (the freedesktop "default" action). */
export const OPEN_KEY = "default";

// ---- The notifications themselves: text, buttons and where a click opens FocusTime. ----

const open = (label: string): NotifyButton => ({ key: "open", label });
const shortDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });

export const notices = {
  planDay: (date: string, at: string): Notice => ({ kind: "plan_day", key: `plan_day:${date}`, title: "Add work to today", body: "Nothing on today yet.\nClick to add work.", buttons: [open("Add work")], route: "planday", at, ref: date }),
  checkin: (date: string, at: string): Notice => ({ kind: "checkin", key: `checkin:${date}`, title: "Check-in", body: "Midday check-in: what still fits this afternoon.\nClick to check in.", buttons: [open("Check in")], route: "checkin", at, ref: date }),
  closeout: (date: string, at: string): Notice => ({ kind: "closeout", key: `closeout:${date}`, title: "Close out", body: "Time to close out the day: to-dos, resume notes and promises.\nClick to close out.", buttons: [open("Close out")], route: "closeout", at, ref: date }),
  /** Monday for this week (Plan the week), Thursday and Friday for next week (Look ahead). */
  week: (weekStart: string, thisWeek: boolean, at: string): Notice => ({
    kind: thisWeek ? "plan_week" : "look_ahead",
    key: `week:${weekStart}:${at.slice(0, 10)}`,
    title: thisWeek ? "Add work to the week" : "Look ahead",
    body: `${thisWeek ? "This week" : `Next week (${shortDay(weekStart)})`} has nothing on it yet.\nClick to add work.`,
    buttons: [open("Add work")],
    route: `planweek:${weekStart}`,
    at,
    ref: weekStart,
  }),
  /** Step 17: every other Thursday after Done in Plan the week, and the first Thursday of the month (Roadmap › Plan ahead). */
  planAhead: (key: string, at: string): Notice => ({ kind: "plan_ahead", key, title: "Look ahead 4 weeks", body: "Next week is planned. Time to look 4 weeks ahead: blocks per week and dates.\nClick to open Plan ahead.", buttons: [open("Plan ahead")], route: "ahead", at, ref: key }),
  direction: (key: string, occasion: string, at: string): Notice => ({ kind: "direction", key, title: "Direction review", body: `First Thursday of ${Temporal.PlainDate.from(occasion).toLocaleString("en-US", { month: "long" })}: look 8 to 12 weeks ahead.\nClick to open Plan ahead.`, buttons: [open("Plan ahead")], route: "ahead", at, ref: key }),
  timerEnd: (breakOver: boolean, label: string, startedAt: string, at: string): Notice => ({
    kind: "timer",
    key: `timer:${startedAt}`,
    title: breakOver ? "Break over" : "Focus session done",
    body: `${label}\nClick for Done, +15 min or Next to-do.`,
    buttons: [{ key: "done", label: "Done" }, { key: "extend", label: "+15 min" }, { key: "next", label: "Next to-do" }],
    route: "focus",
    at,
    ref: startedAt,
  }),
  meeting: (labels: string[], keys: string[], at: string): Notice => ({ kind: "meeting", key: `meeting:${keys.join("|")}`.slice(0, 300), title: "In 5 minutes", body: labels.join("\n"), buttons: [], route: "focus", at }),
  vmOff: (date: string, vmName: string, at: string): Notice => ({ kind: "vm", key: `vm_off:${date}`, title: "Your VM is off", body: `${vmName} is stopped.\nClick to start it.`, buttons: [{ key: "start", label: "Start" }], route: "vm", at, ref: date }),
  followUps: (date: string, due: { id: number; what: string; overdue: boolean }[], at: string): Notice | null => {
    if (!due.length) return null;
    const over = due.filter((f) => f.overdue).length;
    const today = due.length - over;
    const counts = [today ? `${today} due today` : "", over ? `${over} overdue` : ""].filter(Boolean).join(", ");
    return {
      kind: "followups",
      key: `followups:${date}`,
      title: due.length === 1 ? "Promise due" : "Promises due",
      body: `${due.length === 1 ? `${due[0]!.what} (${counts})` : `${counts}: ${due[0]!.what} and ${due.length - 1} more`}\nClick to open ${due.length === 1 ? "it" : "the Inbox"}.`,
      buttons: [open(due.length === 1 ? "Open it" : "Open Inbox")],
      route: due.length === 1 ? `followup:${due[0]!.id}` : "inbox",
      at,
    };
  },
  /** AP-2: an ask AI sorted as needing me now, once per ask. */
  urgentAsk: (messageId: string, clientName: string, title: string, at: string): Notice => ({ kind: "asks", key: `ask:${messageId}`.slice(0, 200), title: `Urgent request from ${clientName}`, body: `${title}\nClick to open Conversations.`, buttons: [open("Open Conversations")], route: "conversations", at }),
  /** CV-1: one reminder to the committer, a working day after a promise that needs a DevOps item. */
  commitmentItem: (id: number, clientName: string, what: string, at: string): Notice => ({ kind: "commitment_item", key: `commitment_item:${id}`, title: `DevOps item not created yet · ${clientName}`, body: `${what}\nClick to open Promises.`, buttons: [open("Open My promises")], route: "my_promises", at }),
  /** CV-1: told quietly, once, that a teammate took a promise over. */
  /** PV-1: told quietly, once, that a teammate took one of my stories (Take one). Never the item's title. */
  storyTaken: (id: number, byName: string, itemId: number, at: string): Notice => ({ kind: "story_taken", key: `story_taken:${id}`, title: `${byName} took #${itemId}`, body: "It's assigned to them in DevOps now. Nothing more for you to do.", buttons: [open("Open Week")], route: "week", at }),
  /** SW-1: work sent to my week, once per send and recipient. */
  sentToYou: (id: number, to: string, fromName: string, title: string, must: boolean, weekStart: string, at: string): Notice => ({ kind: "sent_to_you", key: `sent_to_you:${id}:${to}`.slice(0, 200), title: `${fromName} sent you ${must ? "a Must" : "a suggestion"}`, body: `${title}\nClick to open Add work.`, buttons: [open("Open Week")], route: `planweek:${weekStart}`, at }),
  /** SW-1: an answer on work I sent (accepted, scheduled, passed, can't), once per answer. */
  sendAnswered: (id: number, stamp: string, words: string, title: string, weekStart: string, at: string): Notice => ({ kind: "send_answered", key: `send_answered:${id}:${stamp}`.slice(0, 200), title: words, body: `${title}\nClick to see what you sent.`, buttons: [open("Open Week")], route: `planweek:${weekStart}`, at }),
  /** SW-1 (D632): quietly, to the other leads of the client, when a Must can't be taken. */
  sendCantLead: (id: number, stamp: string, who: string, title: string, reason: string, at: string): Notice => ({ kind: "send_cant_lead", key: `send_cant_lead:${id}:${stamp}`.slice(0, 200), title: `${who} can't take a Must this week`, body: `${title}\n${reason}`, buttons: [open("Open Team")], route: "team", at }),
  /** SW-1: a teammate asks me (a client lead) to look at their planned week. */
  lookAsk: (id: number, fromName: string, clientName: string, at: string): Notice => ({ kind: "look_ask", key: `look_ask:${id}`, title: `${fromName} asked you to look at their week`, body: `${clientName}\nClick to open Team.`, buttons: [open("Open Team")], route: "team", at }),
  /** SW-1: the lead replied to my Ask to look. */
  lookReply: (id: number, leadName: string, clientName: string, weekStart: string, at: string): Notice => ({ kind: "look_reply", key: `look_reply:${id}`, title: `${leadName} replied about your week`, body: `${clientName}\nClick to open Week.`, buttons: [open("Open Week")], route: `planweek:${weekStart}`, at }),
  // AH-1 (D664): quiet, in-app only; ids and a first name, never a title.
  assigned: (key: string, byName: string, itemIds: readonly number[], at: string): Notice => ({ kind: "assigned", key, title: itemIds.length === 1 ? `${byName} assigned you #${itemIds[0]}` : `${byName} assigned you ${itemIds.length} items`, body: `${itemIds.slice(0, 6).map((i) => `#${i}`).join(", ")}${itemIds.length > 6 ? " and more" : ""} in DevOps.\nClick to open it in Ahead.`, buttons: [open("Open Ahead")], route: `aheaditem:${itemIds[0]}`, at }),
  datesMoved: (key: string, byName: string, itemIds: readonly number[], at: string): Notice => ({ kind: "dates_moved", key, title: itemIds.length === 1 ? `${byName} moved the dates of #${itemIds[0]}` : `${byName} moved the dates of ${itemIds.length} of your items`, body: `${itemIds.slice(0, 6).map((i) => `#${i}`).join(", ")}${itemIds.length > 6 ? " and more" : ""} in DevOps.\nClick to see them in Ahead.`, buttons: [open("Open Ahead")], route: `aheaditem:${itemIds[0]}`, at }),
  /** SR-1: Friday afternoon or Sunday evening, once per occasion, when features have no update yet. */
  // SR-3: with features I worked on, the click opens Status on Needs your update.
  statusReport: (occasion: string, line: string, at: string, needsYou = false): Notice => ({ kind: "status_report", key: occasion, title: "Monday's status report", body: `${line}.\nClick to open Status.`, buttons: [open(needsYou ? "Open Needs your update" : "Open Status")], route: needsYou ? "status_needs" : "status", at, ref: occasion }),
  /** MC-1: a call I review, once per occurrence: proposals ready, or a transcript to upload. The call's name, never its words. */
  meetingReview: (key: string, occurrenceId: number, upload: boolean, clientName: string, meeting: string, dateLabel: string, at: string): Notice => ({
    kind: "meeting_review",
    key,
    title: upload ? `Upload ${clientName}'s transcript` : `Update ${clientName}'s plan`,
    body: `${meeting} · ${dateLabel}\n${upload ? "No transcript came through. Upload it, or say there isn't one this week." : "Proposals from the call are ready to review."}`,
    buttons: [open(upload ? "Upload" : "Review")],
    route: `meeting:${occurrenceId}`,
    at,
  }),
  takenOver: (id: number, byName: string, what: string, at: string): Notice => ({ kind: "taken_over", key: `taken_over:${id}`, title: `${byName} took it over`, body: `${what}\nNothing more for you to do.`, buttons: [open("Open Conversations")], route: "conversations", at }),
  /** Part 0: handed to me: given, or added as a helper. */
  conversationGiven: (eventId: number, byName: string, title: string, helper: boolean, at: string): Notice => ({ kind: "conversation_given", key: `conversation_given:${eventId}`, title: helper ? `${byName} added you as a helper` : `${byName} gave this to you`, body: `${title}\nClick to open it.`, buttons: [open("Open Inbox")], route: "conversations", at }),
  /** Part 0: something new on one I have (a new message, or someone asking again on one I closed). */
  conversationActivity: (key: string, heading: string, title: string, at: string): Notice => ({ kind: "conversation_activity", key, title: heading, body: `${title}\nIt stays with you.`, buttons: [open("Open Inbox")], route: "conversations", at }),
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

/** Step 16.2 (Q91): what tells whether a sent notification's occasion was handled since. */
export type DoneFacts = {
  /** CF-1: the day has to-dos (was: confirmed). */
  dayHasWork: (date: string) => boolean;
  checkedIn: (date: string) => boolean;
  closedOut: (date: string) => boolean;
  /** CF-1: the week has anything placed (was: confirmed). */
  weekHasWork: (weekStart: string) => boolean;
  /** Whether a follow-up is still open. */
  followUpOpen: (id: number) => boolean;
  /** Follow-ups due today or overdue now. */
  dueCount: () => number;
  /** Whether the timer still waits on the session that started then (ended, not yet Done, +15 or Next pick). */
  timerWaiting: (startedAt: string) => boolean;
  /** My VM: off and needing a start (null: unknown, never closes). */
  vmOff: () => boolean | null;
  /** Step 17: Plan ahead was opened for this ritual (its key). */
  aheadSeen?: (key: string) => boolean;
};

/**
 * Whether a sent notification no longer applies and can be closed (Q91): the day got to-dos, was checked in or closed
 * out, the week got work, the follow-up closed (or none due any more), the timer answered in the app, the VM started.
 * An "auto-shutdown still changed" notice from before D475 closes at once (there is nothing to restore). Meeting warnings, expiring secrets and tests stay until dismissed.
 */
export function noticeDone(n: Notice, f: DoneFacts): boolean {
  const ref = n.ref;
  switch (n.kind) {
    case "plan_day": return !!ref && f.dayHasWork(ref);
    case "checkin": return !!ref && (f.checkedIn(ref) || f.closedOut(ref));
    case "closeout": return !!ref && f.closedOut(ref);
    case "plan_week":
    case "look_ahead": return !!ref && f.weekHasWork(ref);
    case "timer": return !!ref && !f.timerWaiting(ref);
    case "plan_ahead":
    case "direction": return !!ref && !!f.aheadSeen?.(ref);
    case "followups": {
      const r = parseRoute(n.route);
      return r?.view === "followup" ? !f.followUpOpen(r.id) : f.dueCount() === 0;
    }
    case "vm": return n.key.includes("vm_changed:") || f.vmOff() === false;
    default: return false;
  }
}
