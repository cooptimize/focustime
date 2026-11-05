// Step 17.6: the day's calendar for Today and Plan the day. Every timed event once, in time order, with its full
// times inside the day (the week build clips an event into each card it overlaps; here the pieces are joined),
// all-day events apart, and which one is under way and which is next. Pure. Declined meetings and FocusTime's own
// timebox events never reach here: the week build drops declined ones and week.load drops FocusTime's own events.
import type { CalEvent, Day, PlacedEvent } from "../week/types.ts";

export type DayEventKind = "meeting" | "personal" | "unavailable";
/** past: ended; now: under way; next: the first one still ahead that takes time; later: the rest (and any other day). */
export type DayEventWhen = "past" | "now" | "next" | "later";
export type DayEvent = { event: CalEvent; start: string; end: string; kind: DayEventKind; when: DayEventWhen };
export type DayCalendar = { allDay: CalEvent[]; timed: DayEvent[] };

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
/** Shown as free or working elsewhere: on the calendar, but it leaves the time free. */
export const takesTime = (e: CalEvent) => e.showAs !== "free" && e.showAs !== "workingElsewhere";

export function dayCalendar(day: Day, now?: string): DayCalendar {
  const pieces: PlacedEvent[] = [...day.early, ...day.am.events, ...day.pm.events, ...(day.eve?.events ?? []), ...day.evening];
  const byId = new Map<string, { event: CalEvent; start: string; end: string }>();
  for (const p of pieces) {
    const seen = byId.get(p.event.id);
    if (!seen) byId.set(p.event.id, { event: p.event, start: p.clipStart, end: p.clipEnd });
    else {
      if (ms(p.clipStart) < ms(seen.start)) seen.start = p.clipStart;
      if (ms(p.clipEnd) > ms(seen.end)) seen.end = p.clipEnd;
    }
  }
  const list = [...byId.values()]
    .filter((x) => x.event.responseStatus !== "declined" && !x.event.allDay)
    .sort((a, b) => ms(a.start) - ms(b.start) || ms(a.end) - ms(b.end));
  const t = now ? ms(now) : null;
  let nextGiven = false;
  const timed = list.map(({ event, start, end }): DayEvent => {
    const kind: DayEventKind = event.unavailable ? "unavailable" : event.isPersonal ? "personal" : "meeting";
    let when: DayEventWhen = "later";
    if (t !== null) {
      if (ms(end) <= t && ms(start) < t) when = "past";
      else if (ms(start) <= t) when = "now";
      else if (!nextGiven && kind !== "unavailable" && takesTime(event)) {
        when = "next";
        nextGiven = true;
      }
    }
    return { event, start, end, kind, when };
  });
  return { allDay: day.allDay.filter((e) => e.responseStatus !== "declined"), timed };
}

export type BlockSpan = { key: string; start: string; end: string };
export type SplitCalendar = { before: DayEvent[]; within: Map<string, DayEvent[]>; after: DayEvent[] };

/**
 * The day's timed events by the blocks on screen: each event in the first block it overlaps (an event across the
 * morning and afternoon stays with the morning, once), the rest before the first block or after (evening, or a
 * gap between blocks). With no blocks, everything is "before".
 */
export function splitByBlocks(timed: readonly DayEvent[], blocks: readonly BlockSpan[]): SplitCalendar {
  const within = new Map<string, DayEvent[]>(blocks.map((b) => [b.key, []]));
  const out: SplitCalendar = { before: [], within, after: [] };
  const first = blocks.length ? Math.min(...blocks.map((b) => ms(b.start))) : Infinity;
  for (const e of timed) {
    const [s, en] = [ms(e.start), ms(e.end)];
    const home = blocks.find((b) => (s === en ? s >= ms(b.start) && s < ms(b.end) : s < ms(b.end) && en > ms(b.start)));
    if (home) within.get(home.key)!.push(e);
    else if (s < first) out.before.push(e);
    else out.after.push(e);
  }
  return out;
}

/** CV-1: my promises on Today: timed ones by the blocks (before, in one, after), the rest (a due date only) apart. */
export type PromiseSpots<P> = { before: P[]; within: Map<string, P[]>; after: P[]; untimed: P[] };
export function placePromises<P extends { dueAt: string | null; dueDate: string }>(ps: readonly P[], blocks: readonly BlockSpan[], date: string): PromiseSpots<P> {
  const out: PromiseSpots<P> = { before: [], within: new Map(blocks.map((b) => [b.key, []])), after: [], untimed: [] };
  const first = blocks.length ? Math.min(...blocks.map((b) => ms(b.start))) : Infinity;
  for (const p of ps) {
    // An overdue one from an earlier day, or one due today with no time: the follow-ups row.
    if (!p.dueAt || p.dueDate !== date) {
      if (p.dueDate <= date) out.untimed.push(p);
      continue;
    }
    const t = ms(p.dueAt);
    const home = blocks.find((b) => t >= ms(b.start) && t < ms(b.end));
    if (home) out.within.get(home.key)!.push(p);
    else if (t < first) out.before.push(p);
    else out.after.push(p);
  }
  return out;
}
