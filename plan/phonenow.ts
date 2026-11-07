// MB-1: what the phone's Now card says, from today's blocks, today's calendar and the clock. Pure.
// - in a block: its client, until when and how long is left; the meeting under way (with how long it has left) or the
//   next meeting today (with how long until it);
// - before the first block: when the day starts and with whom; the next meeting today;
// - between blocks: "Free until 1:00" and the next block's client;
// - after the last block: "Day done".
// Meetings are calendar events with others on them: never personal events, unavailable time, my own solo events or
// FocusTime's timeboxes (those are mine, not meetings).

export type NowBlock = { half: string; clientKey: string | null; start: string; end: string };
export type NowEvent = { id: string; title: string; start: string; end: string; isPersonal: boolean; unavailable?: unknown; notMeeting?: string | undefined; allDay?: boolean };
export type NowMeeting = { id: string; title: string; start: string; end: string; underWay: boolean; /** Minutes left (under way) or until it starts. */ minutes: number };

export type NowCard =
  | { kind: "none" }
  | { kind: "block"; block: NowBlock; leftMinutes: number; meeting: NowMeeting | null }
  | { kind: "before"; block: NowBlock; meeting: NowMeeting | null }
  | { kind: "between"; block: NowBlock; meeting: NowMeeting | null }
  | { kind: "after" };

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));
const mins = (a: number, b: number) => Math.max(0, Math.ceil((b - a) / 60_000));

export const isMeeting = (e: NowEvent) => !e.allDay && !e.isPersonal && !e.unavailable && !e.notMeeting;

/** The meeting under way now, else the next one today (after now). */
export function meetingNow(events: readonly NowEvent[], now: string): NowMeeting | null {
  const t = ms(now);
  const ms_ = events.filter(isMeeting).sort((a, b) => ms(a.start) - ms(b.start));
  const on = ms_.find((e) => ms(e.start) <= t && t < ms(e.end));
  if (on) return { id: on.id, title: on.title, start: on.start, end: on.end, underWay: true, minutes: mins(t, ms(on.end)) };
  const next = ms_.find((e) => ms(e.start) > t);
  return next ? { id: next.id, title: next.title, start: next.start, end: next.end, underWay: false, minutes: mins(t, ms(next.start)) } : null;
}

export function nowCard(blocks: readonly NowBlock[], events: readonly NowEvent[], now: string): NowCard {
  if (!blocks.length) return { kind: "none" };
  const t = ms(now);
  const sorted = [...blocks].sort((a, b) => ms(a.start) - ms(b.start));
  const meeting = meetingNow(events, now);
  const on = sorted.find((b) => ms(b.start) <= t && t < ms(b.end));
  if (on) return { kind: "block", block: on, leftMinutes: mins(t, ms(on.end)), meeting };
  const next = sorted.find((b) => ms(b.start) > t);
  if (!next) return { kind: "after" };
  return { kind: next === sorted[0] ? "before" : "between", block: next, meeting };
}
