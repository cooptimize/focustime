// IB-2: the one way FocusTime says when something happened, the way Teams does: "Today 4:07 PM", "Yesterday 6:58 PM",
// otherwise "Fri, Nov 6, 4:07 PM" (with the year only when it isn't this year). Always in the person's time zone, so
// Today and Yesterday follow their midnight. Pure: `today` comes from the caller where the server's date is known.
import type { IsoDate } from "../week/types.ts";

const BRACKET = /\[.*\]$/;

/** A stored stamp (an instant, or the plan store's zoned "…-05:00[Region/City]") in a zone; null when unreadable. */
export function zonedStamp(stamp: string, tz: string): Temporal.ZonedDateTime | null {
  try {
    return stamp.includes("[") ? Temporal.ZonedDateTime.from(stamp).withTimeZone(tz) : Temporal.Instant.from(stamp).toZonedDateTimeISO(tz);
  } catch {
    return null;
  }
}

const clockOf = (z: Temporal.ZonedDateTime) => `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
const DATE_WORDS = new Map<string, string>();
const todayIn = (tz: string): IsoDate => Temporal.Now.plainDateISO(tz).toString();

/** "Fri, Nov 6" and, in another year, "Fri, Nov 6, 2025". */
function dateWords(d: Temporal.PlainDate, year: number): string {
  const key = `${d.toString()}|${year}`;
  let w = DATE_WORDS.get(key);
  if (w === undefined) {
    w = d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.year === year ? {} : { year: "numeric" }) });
    DATE_WORDS.set(key, w);
  }
  return w;
}

/** The day heading: "Today", "Yesterday", else "Fri, Nov 6" (with the year only when it isn't this year). */
export function dayHeading(date: IsoDate, today: IsoDate): string {
  const t = Temporal.PlainDate.from(today);
  const d = Temporal.PlainDate.from(date);
  if (d.equals(t)) return "Today";
  if (d.equals(t.subtract({ days: 1 }))) return "Yesterday";
  return dateWords(d, t.year);
}

/** The day a stamp falls on in the zone; null when unreadable. */
export function stampDay(stamp: string, tz: string): IsoDate | null {
  return zonedStamp(stamp, tz)?.toPlainDate().toString() ?? null;
}

/**
 * When it happened: "Today 4:07 PM", "Yesterday 6:58 PM", "Fri, Nov 6, 4:07 PM". With `dateOnlyIfOld`, for lists where
 * space is tight, something older than a week is its date alone.
 */
export function stampText(stamp: string, tz: string, today: IsoDate = todayIn(tz), o: { dateOnlyIfOld?: boolean } = {}): string {
  const z = zonedStamp(stamp, tz);
  if (!z) return "Unknown time";
  const d = z.toPlainDate();
  const t = Temporal.PlainDate.from(today);
  const clock = clockOf(z);
  if (d.equals(t)) return `Today ${clock}`;
  if (d.equals(t.subtract({ days: 1 }))) return `Yesterday ${clock}`;
  const date = dateWords(d, t.year);
  return o.dateOnlyIfOld && d.until(t).days > 7 ? date : `${date}, ${clock}`;
}

const FULL = new Map<string, Intl.DateTimeFormat>();

/** The full date and time with seconds and time zone, for the tooltip. */
export function stampFull(stamp: string, tz: string): string {
  const z = zonedStamp(stamp, tz);
  if (!z) return "Unknown time";
  let f = FULL.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
    FULL.set(tz, f);
  }
  return f.format(new Date(z.epochMilliseconds)).replace(/ /g, " ");
}

/** The stamp as an instant, for `<time dateTime>`. */
export const stampInstant = (stamp: string): string => stamp.replace(BRACKET, "");
