import { legacyHours } from "../config/schema.ts";
import type { CalEvent, FocusPattern, WeekConfig } from "./types.ts";

export const NY = "America/New_York";

export const config: WeekConfig = {
  hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: NY }),
  thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 },
  standingBlocks: [{ day: "Mon", half: "AM", clientKey: "internal", clientName: "Internal" }],
};

export const noStanding: WeekConfig = { ...config, standingBlocks: [] };

export function pattern(over: Partial<FocusPattern> & Pick<FocusPattern, "days">): FocusPattern {
  return {
    id: "p1",
    clientKey: "wc",
    clientName: "Tailspin & Sons",
    startDate: "2026-01-05",
    endDate: null,
    active: true,
    ...over,
  };
}

let n = 0;
/** Timed Outlook meeting. Times are "YYYY-MM-DDTHH:MM" local New York unless an offset is given. */
export function meeting(start: string, end: string, over: Partial<CalEvent> = {}): CalEvent {
  return {
    id: `m${++n}`,
    source: "outlook",
    title: "Meeting",
    start: withOffset(start),
    end: withOffset(end),
    allDay: false,
    showAs: "busy",
    isPersonal: false,
    ...over,
  };
}

export function personal(start: string, end: string, over: Partial<CalEvent> = {}): CalEvent {
  return meeting(start, end, { source: "google", title: "Personal", isPersonal: true, ...over });
}

export function allDayPersonal(date: string, endExclusive: string, title = "All day thing"): CalEvent {
  return { id: `a${++n}`, source: "google", title, start: date, end: endExclusive, allDay: true, isPersonal: true, showAs: "busy" };
}

function withOffset(local: string): string {
  if (/[zZ]|[+-]\d\d:\d\d$/.test(local)) return local;
  return Temporal.PlainDateTime.from(local).toZonedDateTime(NY).toString({ timeZoneName: "never" });
}
