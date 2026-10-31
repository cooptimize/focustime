// The Now strip (step 6b slice 4): one line in the top bar about right now. Pure: the UI passes the clock,
// today's day from the loaded week and today's picks; nothing is fetched for it.
import type { Day, Half, IsoDate, PlacedEvent, Slot } from "../week/types.ts";
import { capacityMinutes, fitOf, plannedMinutes } from "./rules.ts";
import type { Pick } from "./types.ts";

export type NowInput = {
  now: Temporal.ZonedDateTime;
  /** Today, when it is on the loaded week; null when another week is shown. */
  day: Day | null;
  /** Today's picks (any status). */
  picks: readonly Pick[];
  committed: boolean;
  /** Today is a PTO day (D105). */
  pto: boolean;
  /** The next day with working hours (Plan the day's target after today), for "no work today". */
  nextWorkday: IsoDate | null;
  clientName: (clientKey: string) => string;
  /** Minutes per size from Settings > Planning (defaults when absent). */
  sizes?: Readonly<Record<"S" | "M" | "L", number>>;
  /** Today has no working hours in the time model (used when today isn't on the loaded week, e.g. a quiet weekend). */
  noHoursToday?: boolean;
};

export type NowStrip = {
  /** slot: inside working time. before: before the day or a later slot starts. lunch. after: the day's work is over. */
  kind: "slot" | "before" | "lunch" | "after" | "off" | "pto" | "away";
  /** The half-day a click selects (null: nothing on today to select). */
  half: Half | null;
  title: string;
  /** "HH:MM" the current state lasts until (a window's end, or when work starts). */
  until: string | null;
  /** Minutes until `until`. */
  untilMinutes: number | null;
  /** The event under way (`now`, `at` is its end) or the next one today (`at` is its start). */
  event: { title: string; at: string; minutes: number; now: boolean } | null;
  /** Today's picks done of the ones planned or done. Before commit they are drafts (Q38, step 6c). */
  picks: { done: number; total: number } | null;
  /** Today isn't committed yet: the counts and next pick are drafts, shown dimmed. */
  draft: boolean;
  /** Minutes the current block's picks still to do exceed its free time from now. */
  overBy: number | null;
  nextPick: string | null;
  /** Inside a flex session (its time isn't a morning, afternoon or evening of the usual day). */
  flex: boolean;
  /** The next workday, for "off" and "pto". */
  next: IsoDate | null;
};

const HALF_NAMES: Record<Half, string> = { AM: "Morning", PM: "Afternoon", EVE: "Evening" };
const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
const hm = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: "minute" });

/** Timed events that take time (not free, working elsewhere or declined), once each, in start order. */
function busyEvents(day: Day): PlacedEvent["event"][] {
  const placed = [...day.early, ...day.am.events, ...day.pm.events, ...(day.eve?.events ?? []), ...day.evening];
  const seen = new Map<string, PlacedEvent["event"]>();
  for (const p of placed) {
    const e = p.event;
    if (e.allDay || e.showAs === "free" || e.showAs === "workingElsewhere" || e.responseStatus === "declined") continue;
    seen.set(`${e.source}:${e.id}`, e);
  }
  return [...seen.values()].sort((a, b) => ms(a.start) - ms(b.start));
}

const order: Half[] = ["AM", "PM", "EVE"];

export function nowStrip(i: NowInput): NowStrip {
  const base: NowStrip = { kind: "away", half: null, title: "Today is on another week", until: null, untilMinutes: null, event: null, picks: null, overBy: null, nextPick: null, next: null, flex: false, draft: false };
  if (i.pto || i.day?.pto) return { ...base, kind: "pto", title: "PTO today", next: i.nextWorkday };
  const day = i.day;
  if (!day) return i.noHoursToday ? { ...base, kind: "off", title: "No work today", next: i.nextWorkday } : base;
  const tz = i.now.timeZoneId;
  const t = i.now.epochMilliseconds;
  const nowIso = i.now.toString({ timeZoneName: "never" });

  const slots = order.map((h) => (h === "AM" ? day.am : h === "PM" ? day.pm : day.eve)).filter((s): s is Slot => !!s && s.windows.length > 0);
  if (!slots.length) return { ...base, kind: "off", title: "No work today", next: i.nextWorkday };

  const live = i.picks.filter((p) => p.status === "planned" || p.status === "done");
  const picks = live.length ? { done: live.filter((p) => p.status === "done").length, total: live.length } : null;
  const draft = !i.committed && live.length > 0;
  const todo = live.filter((p) => p.status === "planned").sort((a, b) => order.indexOf(a.half) - order.indexOf(b.half) || a.position - b.position);

  const events = busyEvents(day);
  const current = events.find((e) => ms(e.start) <= t && t < ms(e.end));
  const upcoming = events.find((e) => ms(e.start) > t);
  const event = current
    ? { title: current.title, at: hm(current.end, tz), minutes: Math.ceil((ms(current.end) - t) / 60_000), now: true }
    : upcoming
      ? { title: upcoming.title, at: hm(upcoming.start, tz), minutes: Math.ceil((ms(upcoming.start) - t) / 60_000), now: false }
      : null;

  const common = { ...base, event, picks, draft };
  const nextPickFrom = (half: Half | null) => {
    const from = half ? order.indexOf(half) : 0;
    return todo.find((p) => order.indexOf(p.half) >= from)?.title ?? null;
  };

  // Inside a working window: the block, a flex session, or the evening.
  for (const s of slots) {
    const w = s.windows.find((x) => ms(x.start) <= t && t < ms(x.end));
    if (!w) continue;
    const fx = s.flex.find((f) => ms(f.start) <= t && t < ms(f.end));
    const mine = todo.filter((p) => p.half === s.half);
    const fit = mine.length ? fitOf(plannedMinutes(mine, i.sizes), capacityMinutes(s, nowIso)) : null;
    const focus = s.focus[0];
    const title = fx ? `Flex session: ${i.clientName(fx.clientKey)}` : focus ? `${focus.clientName} focus` : s.open ? "Open" : HALF_NAMES[s.half];
    return {
      ...common,
      kind: "slot",
      half: s.half,
      title,
      until: hm(fx ? fx.end : w.end, tz),
      untilMinutes: Math.ceil((ms(fx ? fx.end : w.end) - t) / 60_000),
      overBy: i.committed && fit?.kind === "over" ? fit.by : null,
      nextPick: nextPickFrom(s.half) ?? (fx ? fx.itemTitle || fx.note || null : null),
      flex: !!fx,
    };
  }

  // Between windows: the next one today, if any.
  const ahead = slots.flatMap((s) => s.windows.map((w) => ({ s, w }))).find(({ w }) => ms(w.start) > t);
  if (!ahead) {
    const last = slots.at(-1)!;
    return { ...common, kind: "after", half: last.half, title: "Done for today", nextPick: null };
  }
  const startsAt = hm(ahead.w.start, tz);
  const untilMinutes = Math.ceil((ms(ahead.w.start) - t) / 60_000);
  const first = slots[0]!.windows[0]!;
  const lunch = ahead.s.half === "PM" && day.hours.lunch && t >= ms(day.am.end) && t >= ms(first.start);
  if (lunch) return { ...common, kind: "lunch", half: "PM", title: "Lunch", until: startsAt, untilMinutes, nextPick: nextPickFrom("PM") };
  const what = ahead.s.half === "EVE" && t >= ms(first.start) ? (ahead.s.flex.some((f) => ms(f.start) === ms(ahead.w.start)) ? "Flex session" : "Evening") : "Work";
  return { ...common, kind: "before", half: ahead.s.half, title: `${what} starts`, until: startsAt, untilMinutes, nextPick: nextPickFrom(ahead.s.half) };
}
