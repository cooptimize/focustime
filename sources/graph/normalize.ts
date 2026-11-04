// Microsoft Graph calendarView events → CalEvent. Pure.
import type { CalEvent, ShowAs } from "../../week/types.ts";
import { TIMEBOX_MARKER } from "../../plan/caltier.ts";
import { MARKER_PROP } from "./write.ts";

export type GraphDateTime = { dateTime: string; timeZone: string };
export type GraphEvent = {
  id: string;
  subject: string | null;
  isAllDay: boolean;
  isCancelled: boolean;
  showAs: string;
  responseStatus: { response: string; time?: string } | null;
  start: GraphDateTime;
  end: GraphDateTime;
  /** Read for the risk rules only (notMeeting): whether I organize it and how many attendees; addresses are never kept. */
  isOrganizer?: boolean;
  attendees?: unknown[];
  /** FocusTime's marker, when the read token may expand it (Calendars.Read or more). */
  singleValueExtendedProperties?: { id?: unknown; value?: unknown }[];
};

/** "timebox" for FocusTime's time box (its tb- marker), "solo" for my event with no attendees; else a meeting. */
export function notMeetingOf(e: Pick<GraphEvent, "isOrganizer" | "attendees" | "singleValueExtendedProperties">): CalEvent["notMeeting"] {
  const marker = (e.singleValueExtendedProperties ?? []).find((p) => typeof p.id === "string" && p.id.toLowerCase() === MARKER_PROP.toLowerCase())?.value;
  if (typeof marker === "string" && TIMEBOX_MARKER.test(marker)) return "timebox";
  // The same rule as the editing tier "Mine" (plan/caltier.ts): I organize it and no one else is on it.
  if (e.isOrganizer === true && Array.isArray(e.attendees) && e.attendees.length === 0) return "solo";
  return undefined;
}

const SHOW_AS: Record<string, ShowAs> = {
  free: "free",
  tentative: "tentative",
  busy: "busy",
  oof: "oof",
  // Working elsewhere is an availability note, not time taken (treated like free for capacity).
  workingElsewhere: "workingElsewhere",
  unknown: "unknown",
};

const RESPONSE: Record<string, NonNullable<CalEvent["responseStatus"]>> = {
  none: "none",
  organizer: "organizer",
  accepted: "accepted",
  tentativelyAccepted: "tentative",
  declined: "declined",
  notResponded: "notResponded",
};

function zoned(dt: GraphDateTime, timeZone: string): Temporal.ZonedDateTime {
  // Graph returns e.g. "2026-11-04T09:00:00.0000000" plus a zone name; trim to millisecond precision.
  const local = Temporal.PlainDateTime.from(dt.dateTime.replace(/(\.\d{3})\d*$/, "$1"));
  return local.toZonedDateTime(dt.timeZone).withTimeZone(timeZone);
}

export function normalizeGraphEvents(items: readonly GraphEvent[], timeZone: string): { events: CalEvent[]; skipped: number } {
  const events: CalEvent[] = [];
  let skipped = 0;
  for (const e of items) {
    const response = e.responseStatus ? RESPONSE[e.responseStatus.response] : undefined;
    if (e.isCancelled || response === "declined") continue;
    let start: string;
    let end: string;
    try {
      if (e.isAllDay) {
        start = e.start.dateTime.slice(0, 10);
        end = e.end.dateTime.slice(0, 10);
        Temporal.PlainDate.from(start);
        Temporal.PlainDate.from(end);
      } else {
        const opts = { timeZoneName: "never", smallestUnit: "second" } as const;
        start = zoned(e.start, timeZone).toString(opts);
        end = zoned(e.end, timeZone).toString(opts);
      }
    } catch {
      skipped++;
      continue;
    }
    const ev: CalEvent = {
      id: `outlook:${e.id}`,
      source: "outlook",
      title: e.subject?.trim() || "(No title)",
      start,
      end,
      allDay: e.isAllDay,
      showAs: SHOW_AS[e.showAs] ?? "unknown",
      isPersonal: false,
    };
    if (response) ev.responseStatus = response;
    const notMeeting = notMeetingOf(e);
    if (notMeeting) ev.notMeeting = notMeeting;
    events.push(ev);
  }
  return { events, skipped };
}
