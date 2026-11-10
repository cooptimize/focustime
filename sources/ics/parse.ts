// CAL-1: an iCalendar (RFC 5545) feed into the event instances FocusTime keeps, through ical.js (Mozilla's parser;
// D: CAL-1 library choice). Recurrences (RRULE, RDATE, EXDATE) are expanded inside a window; a RECURRENCE-ID override
// replaces its instance; a cancelled event or instance is dropped. Times: a VTIMEZONE in the feed first, then an IANA
// TZID, else the person's own zone (floating times). All-day events stay dates (end exclusive). Pure apart from ical.js'
// time zone registry, which is filled and emptied inside one synchronous call.
import ICAL from "ical.js";
import type { ShowAs } from "../../week/types.ts";

/** One instance as kept. Busy-only links never carry a title. */
export type IcsInstance = {
  /** Stable per instance: the UID and the instance's original start. */
  key: string;
  /** Timed: ISO date-time with offset. All-day: ISO date. */
  start: string;
  /** Timed: ISO date-time with offset. All-day: ISO date, exclusive. */
  end: string;
  allDay: boolean;
  showAs: ShowAs;
  title: string | null;
  /** UTC bounds for range queries (all-day: the dates' midnights in the person's zone). */
  startUtc: string;
  endUtc: string;
};

export class IcsParseError extends Error {}

/** At most this many instances from one feed, and this many steps through one rule. */
export const MAX_INSTANCES = 5000;
const MAX_STEPS = 20_000;

type Window = { start: Temporal.Instant; end: Temporal.Instant };

const isIana = (tz: string) => {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
};

/** Whether the text is a calendar at all (before the full parse). */
export const looksLikeCalendar = (text: string) => /^﻿?\s*BEGIN:VCALENDAR/i.test(text);

/**
 * The instances overlapping the window. Throws IcsParseError when the text isn't a calendar. titles: whether to keep
 * titles (Show titles); otherwise none is read into the result.
 */
export function parseIcs(text: string, o: { window: Window; timeZone: string; titles: boolean }): IcsInstance[] {
  if (!looksLikeCalendar(text)) throw new IcsParseError("not a calendar");
  let root: ICAL.Component;
  try {
    const jcal = ICAL.parse(text);
    root = new ICAL.Component(Array.isArray(jcal[0]) ? (jcal[0] as unknown as ICAL.Component["jCal"]) : (jcal as ICAL.Component["jCal"]));
  } catch {
    throw new IcsParseError("unreadable");
  }
  if (root.name !== "vcalendar") throw new IcsParseError("not a calendar");

  const registered: string[] = [];
  try {
    for (const tz of root.getAllSubcomponents("vtimezone")) {
      const id = tz.getFirstPropertyValue("tzid");
      if (typeof id !== "string" || ICAL.TimezoneService.has(id)) continue;
      ICAL.TimezoneService.register(tz);
      registered.push(id);
    }
    return expand(root, o);
  } finally {
    for (const id of registered) ICAL.TimezoneService.remove(id);
  }
}

function expand(root: ICAL.Component, o: { window: Window; timeZone: string; titles: boolean }): IcsInstance[] {
  const masters = new Map<string, ICAL.Event>();
  const overrides: ICAL.Event[] = [];
  for (const v of root.getAllSubcomponents("vevent")) {
    let e: ICAL.Event;
    try {
      e = new ICAL.Event(v);
    } catch {
      continue;
    }
    if (!e.startDate) continue;
    if (e.isRecurrenceException()) overrides.push(e);
    else if (e.uid && !masters.has(e.uid)) masters.set(e.uid, e);
    else if (!e.uid) masters.set(`#${masters.size}`, e);
  }
  // Overrides join their series; one whose series isn't in the feed stands alone.
  const loose: ICAL.Event[] = [];
  for (const x of overrides) {
    const m = masters.get(x.uid);
    if (m && m.isRecurring()) m.relateException(x);
    else loose.push(x);
  }

  const out: IcsInstance[] = [];
  const push = (key: string, s: ICAL.Time, e: ICAL.Time, item: ICAL.Event) => {
    if (out.length >= MAX_INSTANCES) return;
    if (cancelled(item)) return;
    const inst = instance(key, s, e, item, o);
    if (!inst) return;
    if (Temporal.Instant.compare(Temporal.Instant.from(inst.endUtc), o.window.start) <= 0) return;
    if (Temporal.Instant.compare(Temporal.Instant.from(inst.startUtc), o.window.end) >= 0) return;
    out.push(inst);
  };

  for (const [uid, ev] of masters) {
    if (cancelled(ev) && !ev.isRecurring()) continue;
    if (!ev.isRecurring()) {
      push(`${uid}|${ev.startDate.toString()}`, ev.startDate, endOf(ev.startDate, ev.endDate), ev);
      continue;
    }
    if (cancelled(ev)) continue;
    const it = ev.iterator();
    let steps = 0;
    for (let next = it.next(); next; next = it.next()) {
      if (++steps > MAX_STEPS || out.length >= MAX_INSTANCES) break;
      const d = ev.getOccurrenceDetails(next);
      // Rules run in order: once an original start is past the window (with a day of slack for moved instances), stop.
      if (Temporal.Instant.compare(toInstant(next, o.timeZone), o.window.end.add({ hours: 24 * 31 })) > 0) break;
      push(`${uid}|${d.recurrenceId.toString()}`, d.startDate, endOf(d.startDate, d.endDate), d.item);
    }
  }
  for (const x of loose) push(`${x.uid}|${x.recurrenceId?.toString() ?? x.startDate.toString()}`, x.startDate, endOf(x.startDate, x.endDate), x);
  return out;
}

const cancelled = (e: ICAL.Event) => String(e.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";

/** An end that exists: a missing DTEND is one day for a date and the start itself for a time (RFC 5545 3.6.1). */
function endOf(start: ICAL.Time, end: ICAL.Time | null | undefined): ICAL.Time {
  if (end && end.compare(start) > 0) return end;
  const e = start.clone();
  if (start.isDate) e.day += 1;
  return e;
}

/** A time as an instant: its own zone (a VTIMEZONE, or a UTC time), else an IANA TZID, else the person's zone. */
function toInstant(t: ICAL.Time, timeZone: string): Temporal.Instant {
  const zone = t.zone?.tzid;
  if (zone && zone !== "floating") return Temporal.Instant.fromEpochMilliseconds(t.toUnixTime() * 1000);
  // ical.js keeps a TZID it has no VTIMEZONE for on the time (not in its types).
  const named = (t as unknown as { timezone?: unknown }).timezone;
  const tzid = typeof named === "string" && isIana(named) ? named : timeZone;
  return Temporal.ZonedDateTime.from({ timeZone: tzid, year: t.year, month: t.month, day: t.day, hour: t.isDate ? 0 : t.hour, minute: t.isDate ? 0 : t.minute, second: t.isDate ? 0 : Math.min(59, t.second) }).toInstant();
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const dateOf = (t: ICAL.Time) => `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;

function instance(key: string, s: ICAL.Time, e: ICAL.Time, item: ICAL.Event, o: { timeZone: string; titles: boolean }): IcsInstance | null {
  const transp = String(item.component.getFirstPropertyValue("transp") ?? "").toUpperCase();
  const status = String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase();
  const showAs: ShowAs = transp === "TRANSPARENT" ? "free" : status === "TENTATIVE" ? "tentative" : "busy";
  const title = o.titles ? (String(item.summary ?? "").trim().slice(0, 200) || "(No title)") : null;
  if (s.isDate) {
    const start = dateOf(s);
    const end = e.isDate ? dateOf(e) : Temporal.PlainDate.from(start).add({ days: 1 }).toString();
    if (end <= start) return null;
    const z = (d: string) => Temporal.PlainDate.from(d).toZonedDateTime({ timeZone: o.timeZone }).toInstant().toString();
    return { key, start, end, allDay: true, showAs, title, startUtc: z(start), endUtc: z(end) };
  }
  const a = toInstant(s, o.timeZone);
  const b = toInstant(e, o.timeZone);
  if (Temporal.Instant.compare(b, a) < 0) return null;
  const local = (i: Temporal.Instant) => i.toZonedDateTimeISO(o.timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
  return { key, start: local(a), end: local(b), allDay: false, showAs, title, startUtc: a.toString(), endUtc: b.toString() };
}
