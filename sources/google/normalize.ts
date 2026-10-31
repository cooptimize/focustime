// Google Calendar events.list items → CalEvent. Pure. Only title, times, all-day, busy/free and my own reply.
import type { CalEvent } from "../../week/types.ts";

export type GoogleTime = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start: GoogleTime;
  end: GoogleTime;
  /** Requested with fields=attendees(self,responseStatus) only: no names or emails. */
  attendees?: { self?: boolean; responseStatus?: string }[];
};

export function normalizeGoogleEvents(items: readonly GoogleEvent[], calendarId: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const e of items) {
    if (e.status === "cancelled") continue;
    const mine = e.attendees?.find((a) => a.self)?.responseStatus;
    if (mine === "declined") continue;
    const allDay = !!e.start.date;
    const start = allDay ? e.start.date : e.start.dateTime;
    const end = allDay ? e.end.date : e.end.dateTime;
    if (!start || !end) continue;
    out.push({
      id: `google:${calendarId}:${e.id}`,
      source: "google",
      title: e.summary?.trim() || "(No title)",
      start,
      end,
      allDay,
      showAs: e.transparency === "transparent" ? "free" : mine === "tentative" ? "tentative" : "busy",
      isPersonal: true,
    });
  }
  return out;
}
