import { formatTime } from "../week/format.ts";

/** "8:02 AM" today, otherwise "Oct 30 8:02 AM", in the given time zone. */
export function formatFetchedAt(iso: string, timeZone: string, now: Temporal.Instant): string {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone);
  const today = now.toZonedDateTimeISO(timeZone).toPlainDate();
  const time = formatTime(z);
  if (z.toPlainDate().equals(today)) return time;
  return `${z.toPlainDate().toLocaleString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

/** Mon 00:00 to the next Mon 00:00 of the week, in the given time zone. */
export function weekRange(weekStart: string, timeZone: string): { start: string; end: string } {
  const mon = Temporal.PlainDate.from(weekStart).toZonedDateTime({ timeZone });
  const opts = { timeZoneName: "never", smallestUnit: "second" } as const;
  // The whole week, Saturday and Sunday too: weekend columns show when something is planned on them (step 6b).
  return { start: mon.toString(opts), end: mon.add({ days: 7 }).toString(opts) };
}
