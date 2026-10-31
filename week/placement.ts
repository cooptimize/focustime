import { iso } from "./dates.ts";
import type { CalEvent, IsoDate, PlacedEvent } from "./types.ts";

/** Declined events are dropped before anything else sees them. */
export function isIncluded(e: CalEvent): boolean {
  return e.responseStatus !== "declined";
}

/** A named time range of one day; events are clipped into every bucket they overlap. */
export type Bucket = { name: string; start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime };

/** All-day events that cover a date (end exclusive; a zero-length all-day event covers its start date). */
export function allDayOn(events: readonly CalEvent[], date: IsoDate): CalEvent[] {
  const d = Temporal.PlainDate.from(date);
  return events.filter((e) => {
    if (!e.allDay || !isIncluded(e)) return false;
    const start = Temporal.PlainDate.from(e.start);
    const endRaw = Temporal.PlainDate.from(e.end);
    const end = Temporal.PlainDate.compare(endRaw, start) > 0 ? endRaw : start.add({ days: 1 });
    return Temporal.PlainDate.compare(d, start) >= 0 && Temporal.PlainDate.compare(d, end) < 0;
  });
}

/**
 * Places timed events into the buckets of one day (early strip, the cards' timelines, evening strip). A timed
 * event appears in every bucket it overlaps, clipped to it; a zero-length event lands where it starts.
 */
export function placeTimed(events: readonly CalEvent[], buckets: readonly Bucket[], timeZone: string): Map<string, PlacedEvent[]> {
  const out = new Map<string, PlacedEvent[]>(buckets.map((b) => [b.name, []]));
  for (const e of events) {
    if (e.allDay || !isIncluded(e)) continue;
    const s = Temporal.Instant.from(e.start).toZonedDateTimeISO(timeZone);
    const en = Temporal.Instant.from(e.end).toZonedDateTimeISO(timeZone);
    if (Temporal.ZonedDateTime.compare(en, s) < 0) continue;
    const point = Temporal.ZonedDateTime.compare(en, s) === 0;
    for (const b of buckets) {
      if (Temporal.ZonedDateTime.compare(b.end, b.start) <= 0) continue;
      const lo = Temporal.ZonedDateTime.compare(s, b.start) > 0 ? s : b.start;
      const hi = Temporal.ZonedDateTime.compare(en, b.end) < 0 ? en : b.end;
      const overlaps = point ? Temporal.ZonedDateTime.compare(s, b.start) >= 0 && Temporal.ZonedDateTime.compare(s, b.end) < 0 : Temporal.ZonedDateTime.compare(lo, hi) < 0;
      if (!overlaps) continue;
      out.get(b.name)!.push({
        event: e,
        clipStart: iso(lo),
        clipEnd: iso(point ? lo : hi),
        minutesInside: point ? 0 : (hi.epochMilliseconds - lo.epochMilliseconds) / 60000,
        continuesBefore: Temporal.ZonedDateTime.compare(s, b.start) < 0,
        continuesAfter: Temporal.ZonedDateTime.compare(en, b.end) > 0,
      });
    }
  }
  const order = (a: PlacedEvent, b: PlacedEvent) =>
    Temporal.Instant.compare(Temporal.Instant.from(a.clipStart), Temporal.Instant.from(b.clipStart)) ||
    Temporal.Instant.compare(Temporal.Instant.from(a.clipEnd), Temporal.Instant.from(b.clipEnd));
  for (const list of out.values()) list.sort(order);
  return out;
}
