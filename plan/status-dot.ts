// RF-1: the Status tab's dot. It shows only while features I worked on have no update of mine (SR-3's Needs your
// update), and its color comes from my own week, not from fixed weekdays:
//   red   from the start of my last scheduled workday before the report goes out, until it goes out
//   amber on the scheduled workday before that
//   none  earlier in the week, and once the report is sent
// A scheduled workday is a working day (not the catch-up day, not a weekend, not PTO) with a focus block on a half
// that isn't PTO. Someone with no such day in the window (no focus blocks at all) falls back to their working days;
// someone off for the whole window gets no dot. Pure: no I/O, no clock.
import type { Day, IsoDate } from "../week/types.ts";

/** One local date as the dot reads it: when its working hours start (null: no working hours) and what kind it is. */
export type DotDay = {
  date: IsoDate;
  /** The instant its first working segment starts, or null when the day has no working hours. */
  start: string | null;
  /** A working day (not catch-up, not a weekend) that isn't a whole PTO day. */
  working: boolean;
  /** A working day with a focus block on a half that isn't PTO. */
  scheduled: boolean;
};

/** When the dot turns amber and red, and when it goes (the report's send). Null: no dot this week. */
export type DotSchedule = { amberFrom: string | null; redFrom: string; until: string };
export type DotTone = "none" | "amber" | "red";

const ms = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

/** One built week's days as the dot reads them. `zone` is the person's own time zone. */
export function dotDays(days: readonly Day[], zone: string): DotDay[] {
  return days.map((d) => {
    const first = d.hours.segments[0];
    const start = first ? Temporal.PlainDate.from(d.date).toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from(first.start) }).toInstant().toString() : null;
    const working = d.kind === "work" && !d.pto && !!first;
    const halfWorks = (s: Day["am"]) => s.focus.length > 0 && !s.pto && !s.off;
    return { date: d.date, start, working, scheduled: working && (halfWorks(d.am) || halfWorks(d.pm)) };
  });
}

/**
 * The dot's schedule for the report that goes out at `nextSend` (the one before went out at `lastSend`): the days whose
 * working hours start inside that window, the last scheduled one red and the one before it amber.
 */
export function dotSchedule(days: readonly DotDay[], lastSend: string, nextSend: string): DotSchedule | null {
  const [from, to] = [ms(lastSend), ms(nextSend)];
  const inWindow = days.filter((d) => d.start !== null && ms(d.start) >= from && ms(d.start) < to).sort((a, b) => ms(a.start!) - ms(b.start!));
  const scheduled = inWindow.filter((d) => d.scheduled);
  const pool = scheduled.length ? scheduled : inWindow.filter((d) => d.working);
  const red = pool.at(-1);
  if (!red) return null;
  const amber = pool.at(-2);
  return { amberFrom: amber ? amber.start : null, redFrom: red.start!, until: nextSend };
}

/** The dot's tone now: none while nothing needs my update, before amber, or once the report is out. */
export function dotTone(s: DotSchedule | null | undefined, needs: number, now: string | number): DotTone {
  if (!s || needs <= 0) return "none";
  const t = typeof now === "number" ? now : ms(now);
  if (t >= ms(s.until)) return "none";
  if (t >= ms(s.redFrom)) return "red";
  if (s.amberFrom && t >= ms(s.amberFrom)) return "amber";
  return "none";
}

/** The dot's words, for its tooltip and screen readers: "3 features you worked on have no update. The report goes out Monday 7:00 AM." */
export function dotText(needs: number, sendsAt: string, zone: string): string {
  const z = Temporal.Instant.from(sendsAt).toZonedDateTimeISO(zone);
  const day = z.toPlainDate().toLocaleString("en-US", { weekday: "long" });
  const time = `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
  return `${needs === 1 ? "1 feature you worked on has" : `${needs} features you worked on have`} no update. The report goes out ${day} ${time}.`;
}
