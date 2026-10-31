// Sample data for step 1. Mirrors the shape of the real data; no real accounts, names or meetings.
// Week of Mon Nov 2, 2026 (first week of EST after fall back on Nov 1), America/New_York (-05:00).
import type { CalEvent, FocusPattern } from "../week/types.ts";

export const SAMPLE_WEEK = "2026-11-02";

/** Four ongoing Focus Time patterns, as they would look after normalizing Dataverse rows. */
export const samplePatterns: FocusPattern[] = [
  // Mon AM collides with the standing Monday AM Internal block: double-booked.
  { id: "ft-quiddity", clientKey: "quiddity", clientName: "Quiddity", startDate: "2026-03-02", endDate: null, active: true, days: { Mon: "AM" } },
  { id: "ft-csc", clientKey: "csc", clientName: "CSC", startDate: "2026-01-05", endDate: null, active: true, days: { Mon: "PM", Tue: "PM" } },
  { id: "ft-internal", clientKey: "internal", clientName: "Internal", startDate: "2026-06-01", endDate: null, active: true, days: { Tue: "AM" } },
  { id: "ft-wc", clientKey: "wc", clientName: "Woodard & Curran", startDate: "2025-09-08", endDate: null, active: true, days: { Wed: "AllDay", Thu: "AM" } },
  // An old pattern that ended before this week: must not show.
  { id: "ft-old", clientKey: "csc", clientName: "CSC", startDate: "2025-01-06", endDate: "2026-02-26", active: true, days: { Thu: "PM" } },
];

const o = (id: string, title: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: `outlook-${id}`, source: "outlook", title, start: `2026-11-${start}:00-05:00`, end: `2026-11-${end}:00-05:00`,
  allDay: false, showAs: "busy", isPersonal: false, responseStatus: "accepted", ...extra,
});
const g = (id: string, title: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: `google-${id}`, source: "google", title, start: `2026-11-${start}:00-05:00`, end: `2026-11-${end}:00-05:00`,
  allDay: false, showAs: "busy", isPersonal: true, ...extra,
});

export const sampleOutlook: CalEvent[] = [
  // Mon: Quiddity AM (double-booked with standing Internal), CSC PM (90 min of meetings: watch)
  o("1", "Cooptimize weekly standup", "02T09:00", "02T09:30"),
  o("2", "Quiddity sprint planning", "02T10:00", "02T11:00"),
  o("3", "CSC data model review", "02T13:00", "02T14:00"),
  o("4", "Sales pipeline sync", "02T15:00", "02T15:30", { showAs: "tentative", responseStatus: "tentative" }),
  // Tue: Internal AM (healthy), CSC PM (3h 15m of meetings, no focus window: at risk)
  o("5", "1:1 with Dana", "03T09:30", "03T10:00"),
  o("6", "CSC Power BI walkthrough", "03T13:00", "03T14:30"),
  o("7", "CSC backlog refinement", "03T14:30", "03T15:30", { showAs: "tentative", responseStatus: "tentative" }),
  o("8", "Quiddity stakeholder sync", "03T15:45", "03T16:30"),
  // Wed: WC all day. Lunch and learn spans the AM/PM split.
  o("9", "WC weekly status", "04T09:00", "04T10:00"),
  o("10", "Lunch and learn: Copilot Studio", "04T12:00", "04T13:00", { showAs: "tentative", responseStatus: "tentative" }),
  o("11", "WC model review", "04T13:30", "04T14:30"),
  // Thu: WC AM, PM Open
  o("12", "WC Dataverse migration workshop", "05T09:00", "05T10:30"),
  o("13", "Quiddity invoice question", "05T14:00", "05T14:30"),
  o("14", "Hold: expense reports", "05T16:00", "05T16:30", { showAs: "free", responseStatus: "organizer" }),
  // Fri: overflow day
  o("15", "Cooptimize all hands", "06T11:00", "06T11:30"),
  o("16", "Vendor webinar", "06T14:00", "06T15:00", { responseStatus: "declined" }), // excluded
];

export const sampleGoogle: CalEvent[] = [
  g("d1", "Preschool drop-off", "02T08:30", "02T08:50"),
  g("d2", "Preschool drop-off", "03T08:30", "03T08:50"),
  g("d3", "Preschool drop-off", "04T08:30", "04T08:50"),
  g("d4", "Preschool drop-off", "05T08:30", "05T08:50"),
  g("d5", "Preschool drop-off", "06T08:30", "06T08:50"),
  g("p1", "School pickup", "04T15:30", "04T16:00"), // inside the WC PM block: at risk
  g("p2", "School pickup (early release)", "05T13:00", "05T13:30"), // Open PM: no risk
  g("p3", "School pickup", "06T15:30", "06T16:00"),
  { id: "google-er", source: "google", title: "Early release day", start: "2026-11-05", end: "2026-11-06", allDay: true, showAs: "busy", isPersonal: true },
  g("e1", "School open house", "05T18:30", "05T20:00"), // evening, kept visible
];
