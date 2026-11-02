import { describe, expect, it } from "vitest";
import { buildWeek } from "../week/build.ts";
import type { TimeModel } from "../week/hours.ts";
import { allDayPersonal, meeting, NY, pattern, personal } from "../week/test-helpers.ts";
import type { CalEvent, WeekConfig } from "../week/types.ts";
import { dayCalendar, splitByBlocks } from "./todaycal.ts";

// Step 17.6: which calendar events Today and Plan the day show for a day, in time order, with now and next.
const span = (start: string, end: string) => ({ start, end });
const model: TimeModel = {
  timeZone: NY,
  lunch: span("12:00", "12:30"),
  weekdays: { mon: [span("09:00", "17:00")], tue: [span("09:00", "17:00")], wed: [], thu: [], fri: [], sat: [], sun: [] },
  overrides: [],
};
const config: WeekConfig = { hours: model, thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 }, standingBlocks: [] };
const day = (events: CalEvent[], date = "2026-11-02", unavailable: Parameters<typeof buildWeek>[0]["unavailable"] = []) =>
  buildWeek({ weekStart: "2026-11-02", patterns: [pattern({ clientKey: "adatum", clientName: "Adatum", days: { Mon: "AM" } })], events, config, unavailable }).days.find((d) => d.date === date)!;
const at = (local: string) => Temporal.PlainDateTime.from(local).toZonedDateTime(NY).toInstant().toString();
const titles = (c: ReturnType<typeof dayCalendar>) => c.timed.map((e) => e.event.title);

describe("dayCalendar", () => {
  const events = [
    meeting("2026-11-02T14:00", "2026-11-02T15:00", { title: "Review" }),
    meeting("2026-11-02T07:30", "2026-11-02T08:00", { title: "Early call" }),
    meeting("2026-11-02T10:00", "2026-11-02T10:30", { title: "Standup" }),
    meeting("2026-11-02T11:45", "2026-11-02T13:15", { title: "Long lunch meeting" }),
    meeting("2026-11-02T19:00", "2026-11-02T19:30", { title: "Evening sync" }),
    meeting("2026-11-02T11:00", "2026-11-02T11:30", { title: "Declined one", responseStatus: "declined" }),
    meeting("2026-11-02T15:00", "2026-11-02T15:30", { title: "Maybe", showAs: "tentative", responseStatus: "tentative" }),
    meeting("2026-11-02T16:00", "2026-11-02T16:30", { title: "FYI", showAs: "free" }),
    personal("2026-11-02T12:30", "2026-11-02T12:45", { title: "Dentist" }),
    allDayPersonal("2026-11-02", "2026-11-03", "Holiday party"),
  ];

  it("lists the whole day's timed events once each, in time order, with their full times", () => {
    const c = dayCalendar(day(events));
    expect(titles(c)).toEqual(["Early call", "Standup", "Long lunch meeting", "Dentist", "Review", "Maybe", "FYI", "Evening sync"]);
    // A meeting across the morning and afternoon cards is one entry with its own start and end, not two pieces.
    const long = c.timed.find((e) => e.event.title === "Long lunch meeting")!;
    expect([long.start, long.end].map((x) => Temporal.Instant.from(x).toString())).toEqual([at("2026-11-02T11:45"), at("2026-11-02T13:15")]);
  });

  it("hides declined meetings, keeps tentative and free ones with their show-as, and puts all-day events apart", () => {
    const c = dayCalendar(day(events));
    expect(titles(c)).not.toContain("Declined one");
    expect(c.timed.find((e) => e.event.title === "Maybe")!.event.showAs).toBe("tentative");
    expect(c.timed.find((e) => e.event.title === "FYI")!.event.showAs).toBe("free");
    expect(c.allDay.map((e) => e.title)).toEqual(["Holiday party"]);
    expect(titles(c)).not.toContain("Holiday party");
    expect(c.timed.find((e) => e.event.title === "Dentist")!.kind).toBe("personal");
  });

  it("uses the configured time zone for which day an event is on", () => {
    const tz = [
      meeting("2026-11-02T10:00", "2026-11-02T10:30", { title: "Late NY", start: "2026-11-03T03:30:00Z", end: "2026-11-03T04:00:00Z" }), // 10:30 PM Mon in New York
      meeting("2026-11-02T10:00", "2026-11-02T10:30", { title: "Sunday night", start: "2026-11-02T04:30:00Z", end: "2026-11-02T04:45:00Z" }), // 11:30 PM Sun in New York
    ];
    expect(titles(dayCalendar(day(tz)))).toEqual(["Late NY"]);
  });

  it("marks the meeting under way as now and the next one that takes time as next", () => {
    const c = dayCalendar(day(events), at("2026-11-02T10:15"));
    const state = Object.fromEntries(c.timed.map((e) => [e.event.title, e.when]));
    expect(state).toMatchObject({ "Early call": "past", Standup: "now", "Long lunch meeting": "next", Review: "later" });
    // Shown as free never counts as next.
    const d = dayCalendar(day(events), at("2026-11-02T15:45"));
    expect(d.timed.filter((e) => e.when === "next").map((e) => e.event.title)).toEqual(["Evening sync"]);
    // Another day (or no clock): nothing is now or next.
    expect(dayCalendar(day(events)).timed.every((e) => e.when === "later")).toBe(true);
    expect(dayCalendar(day(events), at("2026-11-03T10:15")).timed.every((e) => e.when === "past")).toBe(true);
  });

  it("keeps unavailable time apart from meetings", () => {
    const c = dayCalendar(day([], "2026-11-02", [{ id: 4, title: "School run", start: at("2026-11-02T15:00"), end: at("2026-11-02T15:30"), note: null }]));
    expect(c.timed.map((e) => [e.event.title, e.kind])).toEqual([["School run", "unavailable"]]);
  });

  it("an empty calendar is empty, not an error", () => {
    expect(dayCalendar(day([]))).toEqual({ allDay: [], timed: [] });
  });

  it("puts each event in the first block it overlaps, the rest before or after the blocks", () => {
    const d = day(events);
    const c = dayCalendar(d);
    const s = splitByBlocks(c.timed, [{ key: "AM", start: d.am.start, end: d.am.end }, { key: "PM", start: d.pm.start, end: d.pm.end }]);
    const t = (l: typeof c.timed) => l.map((e) => e.event.title);
    expect(t(s.before)).toEqual(["Early call"]);
    expect(t(s.within.get("AM")!)).toEqual(["Standup", "Long lunch meeting"]);
    expect(t(s.within.get("PM")!)).toEqual(["Dentist", "Review", "Maybe", "FYI"]);
    expect(t(s.after)).toEqual(["Evening sync"]);
    // Only the afternoon on screen: the morning's meetings come before it.
    const pmOnly = splitByBlocks(c.timed, [{ key: "PM", start: d.pm.start, end: d.pm.end }]);
    expect(t(pmOnly.before)).toEqual(["Early call", "Standup"]);
    expect(t(pmOnly.within.get("PM")!)[0]).toBe("Long lunch meeting");
    // No blocks (a day off): everything in one list.
    expect(t(splitByBlocks(c.timed, []).before)).toEqual(t(c.timed));
  });
});
