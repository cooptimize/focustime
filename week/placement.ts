import { dayBounds, iso, weekDates } from "./dates";
import type { CalEvent, DayShape, IsoDate, PlacedEvent } from "./types";

export type DayBuckets = {
  allDay: CalEvent[];
  early: PlacedEvent[];
  am: PlacedEvent[];
  pm: PlacedEvent[];
  evening: PlacedEvent[];
};

type BucketName = Exclude<keyof DayBuckets, "allDay">;

/** Declined events are dropped before anything else sees them. */
export function isIncluded(e: CalEvent): boolean {
  return e.responseStatus !== "declined";
}

/**
 * Place events into each day of the week (Mon to Fri): all-day list, early (midnight to day start),
 * AM (start to split), PM (split to usual end) and evening (usual end to midnight).
 * A timed event appears in every bucket it overlaps, clipped to that bucket.
 */
export function placeEvents(events: readonly CalEvent[], weekStart: IsoDate, shape: DayShape): Map<IsoDate, DayBuckets> {
  const out = new Map<IsoDate, DayBuckets>();
  const dates = weekDates(weekStart);
  for (const date of dates) out.set(date, { allDay: [], early: [], am: [], pm: [], evening: [] });

  for (const e of events) {
    if (!isIncluded(e)) continue;
    if (e.allDay) {
      const start = Temporal.PlainDate.from(e.start);
      const endRaw = Temporal.PlainDate.from(e.end);
      const end = Temporal.PlainDate.compare(endRaw, start) > 0 ? endRaw : start.add({ days: 1 });
      for (const date of dates) {
        const d = Temporal.PlainDate.from(date);
        if (Temporal.PlainDate.compare(d, start) >= 0 && Temporal.PlainDate.compare(d, end) < 0) out.get(date)!.allDay.push(e);
      }
      continue;
    }

    const s = Temporal.Instant.from(e.start).toZonedDateTimeISO(shape.timeZone);
    const en = Temporal.Instant.from(e.end).toZonedDateTimeISO(shape.timeZone);
    if (Temporal.ZonedDateTime.compare(en, s) < 0) continue;
    const point = Temporal.ZonedDateTime.compare(en, s) === 0;

    for (const date of dates) {
      const b = dayBounds(date, shape);
      const buckets: [BucketName, Temporal.ZonedDateTime, Temporal.ZonedDateTime][] = [
        ["early", b.midnight, b.start],
        ["am", b.start, b.split],
        ["pm", b.split, b.end],
        ["evening", b.end, b.nextMidnight],
      ];
      for (const [name, bs, be] of buckets) {
        const lo = Temporal.ZonedDateTime.compare(s, bs) > 0 ? s : bs;
        const hi = Temporal.ZonedDateTime.compare(en, be) < 0 ? en : be;
        const overlaps = point
          ? Temporal.ZonedDateTime.compare(s, bs) >= 0 && Temporal.ZonedDateTime.compare(s, be) < 0
          : Temporal.ZonedDateTime.compare(lo, hi) < 0;
        if (!overlaps) continue;
        out.get(date)![name].push({
          event: e,
          clipStart: iso(lo),
          clipEnd: iso(point ? lo : hi),
          minutesInside: point ? 0 : (hi.epochMilliseconds - lo.epochMilliseconds) / 60000,
          continuesBefore: Temporal.ZonedDateTime.compare(s, bs) < 0,
          continuesAfter: Temporal.ZonedDateTime.compare(en, be) > 0,
        });
      }
    }
  }

  const order = (a: PlacedEvent, b: PlacedEvent) =>
    Temporal.Instant.compare(Temporal.Instant.from(a.clipStart), Temporal.Instant.from(b.clipStart)) ||
    Temporal.Instant.compare(Temporal.Instant.from(a.clipEnd), Temporal.Instant.from(b.clipEnd));
  for (const day of out.values()) for (const k of ["early", "am", "pm", "evening"] as const) day[k].sort(order);
  return out;
}
