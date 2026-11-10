// CAL-1: the feed parser on built feeds (no network): recurrences with EXDATE and overrides, VTIMEZONE across a DST
// change, all-day events, cancelled instances, and Busy only keeping no titles.
import { describe, expect, it } from "vitest";
import { anIcsCalendar, anIcsEvent, EASTERN_VTIMEZONE } from "../../test/builders/ics.ts";
import { IcsParseError, parseIcs } from "./parse.ts";

const TZ = "America/New_York";
const window = { start: Temporal.Instant.from("2026-10-01T00:00:00Z"), end: Temporal.Instant.from("2027-01-31T00:00:00Z") };
const parse = (text: string, titles = true, w = window) => parseIcs(text, { window: w, timeZone: TZ, titles });

describe("parseIcs (CAL-1)", () => {
  it("expands a weekly RRULE, drops an EXDATE and uses an overridden instance", () => {
    const text = anIcsCalendar({
      timezones: [EASTERN_VTIMEZONE()],
      events: [
        anIcsEvent({ uid: "swim@example.com", tzid: "Eastern Standard Time", start: "20261103T163000", end: "20261103T173000", rrule: "FREQ=WEEKLY;COUNT=4", exdates: ["20261110T163000"] }),
        anIcsEvent({ uid: "swim@example.com", tzid: "Eastern Standard Time", recurrenceId: "20261117T163000", start: "20261117T150000", end: "20261117T160000", summary: "Swim lessons (early)" }),
      ],
    });
    const got = parse(text).map((e) => [e.start, e.end, e.title]);
    expect(got).toEqual([
      ["2026-11-03T16:30:00-05:00", "2026-11-03T17:30:00-05:00", "Swim lessons"],
      ["2026-11-17T15:00:00-05:00", "2026-11-17T16:00:00-05:00", "Swim lessons (early)"],
      ["2026-11-24T16:30:00-05:00", "2026-11-24T17:30:00-05:00", "Swim lessons"],
    ]);
  });

  it("keeps wall-clock time across a DST change with the feed's VTIMEZONE, and with an IANA TZID", () => {
    for (const [tz, zones] of [["Custom Eastern", [EASTERN_VTIMEZONE("Custom Eastern")]], ["America/New_York", []]] as const) {
      const text = anIcsCalendar({ timezones: [...zones], events: [anIcsEvent({ tzid: tz, start: "20261026T090000", end: "20261026T100000", rrule: "FREQ=WEEKLY;COUNT=3" })] });
      const got = parse(text);
      // Oct 26 is daylight time (UTC-4), Nov 2 and 9 are standard time (UTC-5): 9:00 local every week.
      expect(got.map((e) => e.startUtc), tz).toEqual(["2026-10-26T13:00:00Z", "2026-11-02T14:00:00Z", "2026-11-09T14:00:00Z"]);
      expect(got.map((e) => e.start.slice(11, 16)), tz).toEqual(["09:00", "09:00", "09:00"]);
    }
  });

  it("reads UTC times and floating times (in the person's zone)", () => {
    const text = anIcsCalendar({ events: [anIcsEvent({ start: "20261104T150000Z", end: "20261104T160000Z" }), anIcsEvent({ start: "20261105T090000", end: "20261105T093000" })] });
    expect(parse(text).map((e) => e.start)).toEqual(["2026-11-04T10:00:00-05:00", "2026-11-05T09:00:00-05:00"]);
  });

  it("keeps all-day events as dates with an exclusive end, one day when there is no end", () => {
    const text = anIcsCalendar({ events: [anIcsEvent({ start: "20261106", end: "20261107", summary: "No school", transparent: true }), anIcsEvent({ start: "20261111" }), anIcsEvent({ start: "20261123", end: "20261125" })] });
    const got = parse(text);
    expect(got.map((e) => [e.start, e.end, e.allDay, e.showAs])).toEqual([
      ["2026-11-06", "2026-11-07", true, "free"],
      ["2026-11-11", "2026-11-12", true, "busy"],
      ["2026-11-23", "2026-11-25", true, "busy"],
    ]);
    expect(got[0]!.startUtc).toBe("2026-11-06T05:00:00Z");
  });

  it("drops a cancelled instance (an override with STATUS:CANCELLED) and a cancelled event", () => {
    const text = anIcsCalendar({
      events: [
        anIcsEvent({ uid: "pickup@example.com", tzid: TZ, start: "20261102T150000", end: "20261102T153000", rrule: "FREQ=WEEKLY;COUNT=3" }),
        anIcsEvent({ uid: "pickup@example.com", tzid: TZ, recurrenceId: "20261109T150000", start: "20261109T150000", end: "20261109T153000", status: "CANCELLED" }),
        anIcsEvent({ uid: "gone@example.com", tzid: TZ, start: "20261104T120000", end: "20261104T130000", status: "CANCELLED" }),
      ],
    });
    expect(parse(text).map((e) => e.start.slice(0, 10))).toEqual(["2026-11-02", "2026-11-16"]);
  });

  it("reads tentative and free, and only the window", () => {
    const text = anIcsCalendar({ events: [anIcsEvent({ start: "20261103T150000Z", end: "20261103T160000Z", status: "TENTATIVE" }), anIcsEvent({ start: "20250103T150000Z", end: "20250103T160000Z" }), anIcsEvent({ start: "20261103T170000Z", end: "20261103T180000Z", rrule: "FREQ=DAILY" })] });
    const w = { start: Temporal.Instant.from("2026-11-02T00:00:00Z"), end: Temporal.Instant.from("2026-11-06T00:00:00Z") };
    const got = parse(text, true, w);
    expect(got[0]!.showAs).toBe("tentative");
    // The 2025 event is outside; the daily series stops at the window.
    expect(got.length).toBe(1 + 3);
  });

  it("Busy only: no title is read into the result, and nothing of the location or description", () => {
    const text = anIcsCalendar({ events: [anIcsEvent({ start: "20261103T150000Z", end: "20261103T160000Z", summary: "SECRET-TITLE dentist", location: "SECRET-PLACE", description: "SECRET-NOTE" })] });
    const got = parse(text, false);
    expect(got).toHaveLength(1);
    expect(got[0]!.title).toBeNull();
    expect(JSON.stringify(got)).not.toMatch(/SECRET/);
  });

  it("refuses what isn't a calendar", () => {
    expect(() => parse("<html><body>Sign in</body></html>")).toThrow(IcsParseError);
    expect(() => parse("")).toThrow(IcsParseError);
  });
});
