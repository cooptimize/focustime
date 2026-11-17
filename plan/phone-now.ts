// PH-1: what the phone's Day says, pure. The words live here, in one place (docs/design/wording.md lists them).
// - The Now card's block line: how much of the block has gone, the time left and the meeting that matters.
// - Next: at most two lines, the next meeting today and the next block (with its risk in a few words).
// - The one thing that needs you: the most pressing of the Inbox's own rows for today, by a fixed order, with "1 of N",
//   N being the count on the bar's Inbox.
import type { InboxItemView } from "./inbox-items.ts";
import type { NowMeeting } from "./phonenow.ts";

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));

/** "2h", "45 min", "1h 30m": how long, in the app's words. */
export function span(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** How much of the block has gone, 0 to 1. */
export function blockGone(start: string, end: string, now: string): number {
  const a = ms(start);
  const b = ms(end);
  const t = ms(now);
  if (!(b > a)) return 0;
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

/**
 * The Now card's one line in a block: "In Sprint planning until 11:30" while a meeting is under way; else the time
 * left and the next meeting when it starts before the block ends ("2h left · a 30 min meeting at 11:00"); else the
 * time left alone.
 */
export function blockLine(leftMinutes: number, blockEnd: string, meeting: NowMeeting | null, clock: (iso: string) => string): string {
  if (meeting?.underWay) return PHONE_TEXT.inMeeting(meeting.title, clock(meeting.end));
  const left = PHONE_TEXT.left(span(leftMinutes));
  if (meeting && ms(meeting.start) < ms(blockEnd)) return `${left} · ${PHONE_TEXT.meetingAt(span((ms(meeting.end) - ms(meeting.start)) / 60_000), clock(meeting.start))}`;
  return left;
}

export type NextEvent = { title: string; start: string; end: string };
export type NextBlock = { start: string; name: string; risk: string | null };
export type NextLine = { kind: "meeting" | "block"; at: string; text: string; detail: string | null };

/** Next: the next meeting today that hasn't started and the next block that hasn't started, in time order; two lines at most. */
export function nextLines(meetings: readonly NextEvent[], blocks: readonly NextBlock[], now: string, clock: (iso: string) => string): NextLine[] {
  const t = ms(now);
  const out: NextLine[] = [];
  const m = [...meetings].filter((e) => ms(e.start) > t).sort((a, b) => ms(a.start) - ms(b.start))[0];
  if (m) out.push({ kind: "meeting", at: clock(m.start), text: m.title, detail: span((ms(m.end) - ms(m.start)) / 60_000) });
  const b = [...blocks].filter((x) => ms(x.start) > t).sort((a, b) => ms(a.start) - ms(b.start))[0];
  if (b) out.push({ kind: "block", at: clock(b.start), text: b.name, detail: b.risk });
  // In time order.
  if (m && b && ms(b.start) < ms(m.start)) out.reverse();
  return out;
}

/** Why the one thing comes first, in the order it is picked. */
export type OneWhy = "late" | "due_today" | "from_chat" | "other";
export type OneThing = { key: string; why: OneWhy; title: string; who: string | null; of: number };

const rank = (r: InboxItemView, today: string): OneWhy | null => {
  if (r.done) return null;
  if (r.kind === "promise" && r.late) return "late";
  if (r.kind === "promise" && r.due === today) return "due_today";
  if (r.kind === "conversation") return "from_chat";
  return "other";
};
const ORDER: readonly OneWhy[] = ["late", "due_today", "from_chat", "other"];

/**
 * The most pressing thing that needs me: a late promise, then one due today, then a suggestion from a chat, then
 * anything else the Inbox lists for today. Inside one kind, the Inbox's own order. None when the Needs you count is 0
 * or nothing is listed. A client call to review (MC-1) isn't one of the Inbox's rows or in its count, so it isn't here
 * (docs/open-questions.md); it is on More's Client calls line.
 */
export function oneThing(rows: readonly InboxItemView[], needsYou: number, today: string): OneThing | null {
  if (needsYou <= 0) return null;
  const all: { key: string; why: OneWhy; title: string; who: string | null }[] = [
    ...rows.flatMap((r) => {
      const why = rank(r, today);
      return why ? [{ key: r.key, why, title: r.title, who: r.who }] : [];
    }),
  ];
  const first = [...all].sort((a, b) => ORDER.indexOf(a.why) - ORDER.indexOf(b.why))[0];
  return first ? { ...first, of: needsYou } : null;
}

/** Every word the phone's bar, Day and More say (PH-1). */
export const PHONE_TEXT = {
  tabs: { day: "Day", week: "Week", capture: "Capture", inbox: "Inbox", more: "More" },
  ask: "Ask",
  askLabel: "Ask the assistant",
  barLabel: "Tabs",
  moreDot: "More: a source needs attention",
  dayHeading: "Day",
  nowTag: "Now",
  until: (t: string) => `until ${t}`,
  left: (s: string) => `${s} left`,
  inMeeting: (title: string, end: string) => `In ${title} until ${end}`,
  meetingAt: (len: string, at: string) => `a ${len} meeting at ${at}`,
  goneLabel: (pct: number) => `${pct}% of the block has gone`,
  startFocus: "Start focus",
  done: "Done",
  stop: "Stop",
  doneBox: (title: string) => `Done: ${title}`,
  nothingPlanned: "Nothing planned for this block.",
  add: "Add",
  addTo: (name: string) => `Add to ${name}`,
  focusing: "Focusing",
  timesUp: "Time's up",
  openFocus: "Open the focus screen",
  next: "Next",
  needsYouHead: "Needs you",
  of: (n: number) => `1 of ${n}`,
  why: { late: "Late", due_today: "Due today", from_chat: "From a chat", other: "Needs you" } as Record<OneWhy, string>,
  today: "Today",
  more: "More",
  rows: {
    backlog: "Backlog",
    status: "Status",
    statusLine: (n: number) => `${n} ${n === 1 ? "feature needs" : "features need"} your update`,
    calls: "Client calls",
    callsLine: (n: number) => `${n} ${n === 1 ? "call" : "calls"} to review`,
    code: "Code",
    vm: "My VM",
    vmNone: "Not set up",
    settings: "Settings",
    guide: "Guide",
    everything: "Everything else",
    desktop: "Desktop version",
    desktopLine: "The whole app as on a computer",
  },
  else: {
    title: "Everything else",
    back: "Back to More",
    notifications: "Notifications",
    notificationsLine: (n: number) => `${n} new`,
    sources: "Sources",
    sourcesLine: { live: "All sources live", stale: "Some data is older", trouble: "A source needs attention" },
    focus: "Focus",
    focusLine: "Start a session or a break",
    focusScreen: "Focus screen",
    checkin: "Midday check-in",
    closeout: "Close out",
    install: "Install app",
    docs: "Technical docs",
    about: "About",
    admin: "Admin",
  },
} as const;
