// CAL-1: iCalendar (RFC 5545) text for the calendar link tests. Fictional events on the reserved example.com domain;
// each builder takes only what a test is about. Lines end in CRLF, as feeds do.

export type IcsEventSpec = {
  uid?: string;
  /** "20261103T090000" (with tzid or floating), "20261103T140000Z" (UTC) or "20261103" (a date). */
  start: string;
  end?: string;
  tzid?: string;
  summary?: string;
  location?: string;
  description?: string;
  rrule?: string;
  exdates?: string[];
  recurrenceId?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  transparent?: boolean;
};

let n = 0;
const when = (prop: string, v: string, tzid?: string) => (/^\d{8}$/.test(v) ? `${prop};VALUE=DATE:${v}` : tzid && !v.endsWith("Z") ? `${prop};TZID=${tzid}:${v}` : `${prop}:${v}`);

export function anIcsEvent(e: IcsEventSpec): string {
  const lines = ["BEGIN:VEVENT", `UID:${e.uid ?? `event-${++n}@example.com`}`, "DTSTAMP:20261101T000000Z"];
  if (e.recurrenceId) lines.push(when("RECURRENCE-ID", e.recurrenceId, e.tzid));
  lines.push(when("DTSTART", e.start, e.tzid));
  if (e.end) lines.push(when("DTEND", e.end, e.tzid));
  if (e.rrule) lines.push(`RRULE:${e.rrule}`);
  for (const x of e.exdates ?? []) lines.push(when("EXDATE", x, e.tzid));
  lines.push(`SUMMARY:${e.summary ?? "Swim lessons"}`);
  if (e.location) lines.push(`LOCATION:${e.location}`);
  if (e.description) lines.push(`DESCRIPTION:${e.description}`);
  if (e.status) lines.push(`STATUS:${e.status}`);
  if (e.transparent) lines.push("TRANSP:TRANSPARENT");
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

/** A VTIMEZONE for US Eastern rules under a name that isn't an IANA zone (as Outlook writes them). */
export const EASTERN_VTIMEZONE = (tzid = "Eastern Standard Time") =>
  [
    "BEGIN:VTIMEZONE", `TZID:${tzid}`,
    "BEGIN:STANDARD", "DTSTART:16010101T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11", "END:STANDARD",
    "BEGIN:DAYLIGHT", "DTSTART:16010101T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3", "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n");

export function anIcsCalendar(o: { events: string[]; timezones?: string[] } = { events: [] }): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FocusTime tests//EN", ...(o.timezones ?? []), ...o.events, "END:VCALENDAR", ""].join("\r\n");
}
