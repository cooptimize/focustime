// Microsoft Graph calendarView events → CalEvent. Pure.
import type { CalEvent, ShowAs } from "../../week/types.ts";

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
};

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
    events.push(ev);
  }
  return { events, skipped };
}
