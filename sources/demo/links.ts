// CAL-1, demo: calendar links answered in memory, never from the network. Three fictional links on the reserved
// example.com domain: a family calendar (recurring weekday events with an exception and a cancelled one), a school
// calendar (an all-day day off), and one that works once and then stops (the error state). Anything else is refused
// with a demo sentence.
import { IcsFetchError, type IcsGet } from "../ics/fetch.ts";
import { DEMO_TZ } from "./data.ts";

export const DEMO_LINK_HOST = "calendar.example.com";
export const DEMO_LINKS = {
  family: `webcal://${DEMO_LINK_HOST}/u/demo-family/basic.ics`,
  school: `https://${DEMO_LINK_HOST}/u/demo-school/basic.ics`,
  stops: `https://${DEMO_LINK_HOST}/u/demo-stops/basic.ics`,
} as const;

const stamp = (d: Temporal.PlainDate, t: string) => `${d.toString().replaceAll("-", "")}T${t.replace(":", "")}00`;

/** A fictional family calendar for the demo week (Monday's date first). */
export function familyIcs(monday: Temporal.PlainDate): string {
  const tue = monday.add({ days: 1 });
  const wed = monday.add({ days: 2 });
  const thu = monday.add({ days: 3 });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FocusTime demo//Family//EN",
    "BEGIN:VEVENT",
    "UID:demo-swim@example.com",
    `DTSTART;TZID=${DEMO_TZ}:${stamp(tue, "16:30")}`,
    `DTEND;TZID=${DEMO_TZ}:${stamp(tue, "17:30")}`,
    "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=16",
    `EXDATE;TZID=${DEMO_TZ}:${stamp(thu.add({ days: 7 }), "16:30")}`,
    "SUMMARY:Swim lessons",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:demo-swim@example.com",
    `RECURRENCE-ID;TZID=${DEMO_TZ}:${stamp(thu, "16:30")}`,
    `DTSTART;TZID=${DEMO_TZ}:${stamp(thu, "15:00")}`,
    `DTEND;TZID=${DEMO_TZ}:${stamp(thu, "16:00")}`,
    "SUMMARY:Swim lessons (early)",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:demo-dentist@example.com",
    `DTSTART;TZID=${DEMO_TZ}:${stamp(wed, "11:30")}`,
    `DTEND;TZID=${DEMO_TZ}:${stamp(wed, "12:30")}`,
    "SUMMARY:Dentist",
    "LOCATION:Main Street",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:demo-pickup@example.com",
    `DTSTART;TZID=${DEMO_TZ}:${stamp(monday, "15:00")}`,
    `DTEND;TZID=${DEMO_TZ}:${stamp(monday, "15:30")}`,
    "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8",
    "SUMMARY:School pickup",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function schoolIcs(monday: Temporal.PlainDate): string {
  const fri = monday.add({ days: 4 }).toString().replaceAll("-", "");
  const sat = monday.add({ days: 5 }).toString().replaceAll("-", "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FocusTime demo//School//EN", "BEGIN:VEVENT", "UID:demo-noschool@example.com", `DTSTART;VALUE=DATE:${fri}`, `DTEND;VALUE=DATE:${sat}`, "SUMMARY:No school", "TRANSP:TRANSPARENT", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

/** The demo's getter: the three fictional links, nothing else. */
export function createDemoIcsGet(now: () => string): IcsGet {
  let stopsCalls = 0;
  return async (url) => {
    const monday = (() => {
      const d = Temporal.Instant.from(now()).toZonedDateTimeISO(DEMO_TZ).toPlainDate();
      return d.subtract({ days: d.dayOfWeek - 1 });
    })();
    const ok = (body: string) => ({ status: 200, location: null, etag: `"demo-${monday}"`, lastModified: null, contentType: "text/calendar; charset=utf-8", body });
    if (url.hostname !== DEMO_LINK_HOST) throw new IcsFetchError("demo");
    if (url.pathname === "/u/demo-family/basic.ics") return ok(familyIcs(monday));
    if (url.pathname === "/u/demo-school/basic.ics") return ok(schoolIcs(monday));
    if (url.pathname === "/u/demo-stops/basic.ics") {
      // Works for the check and the save, then stops (Replace link).
      if (++stopsCalls <= 2) return ok(familyIcs(monday));
      return { status: 404, location: null, etag: null, lastModified: null, contentType: "text/html", body: null };
    }
    return { status: 404, location: null, etag: null, lastModified: null, contentType: "text/html", body: null };
  };
}
