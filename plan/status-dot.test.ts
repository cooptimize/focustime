// RF-1: the Status tab's dot, from the person's own week. The week of Nov 2, 2026; the report goes out Monday Nov 9 at
// 7:00 AM New York (the one before on Monday Nov 2).
import { describe, expect, it } from "vitest";
import { legacyHours } from "../config/schema.ts";
import { aClient, aFocusBlock, aPto, aWeek, aWeekConfig } from "../test/builders/index.ts";
import { lastKatRun, nextKatRun } from "./status-report.ts";
import { dotDays, dotSchedule, dotText, dotTone, type DotDay } from "./status-dot.ts";

const NY = "America/New_York";
const LA = "America/Los_Angeles";
const LAST = "2026-11-02T12:00:00Z"; // Mon Nov 2, 7:00 AM ET
const NEXT = "2026-11-09T12:00:00Z"; // Mon Nov 9, 7:00 AM ET
const at = (local: string, zone = NY) => Temporal.PlainDateTime.from(local).toZonedDateTime(zone).toInstant().toString();
const northwind = aClient({ name: "Northwind" });

/** The week's days as the dot reads them, for focus blocks on these days, in this zone. */
function week(days: NonNullable<Parameters<typeof aFocusBlock>[0]>["days"], o: { zone?: string; pto?: string[]; next?: boolean; friday?: boolean } = {}) {
  const zone = o.zone ?? NY;
  const hours = legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: zone });
  const config = aWeekConfig({ hours: o.friday ? { ...hours, weekdays: { ...hours.weekdays, fri: hours.weekdays.mon } } : hours });
  const built = (weekStart: string) => aWeek({ weekStart, config, patterns: days ? [aFocusBlock({ client: northwind, days })] : [], pto: (o.pto ?? []).map((date) => aPto({ date })) });
  return [...built("2026-11-02").days, ...(o.next ? built("2026-11-09").days : [])].flatMap((d) => dotDays([d], zone));
}
const tone = (days: DotDay[], now: string, needs = 3) => dotTone(dotSchedule(days, LAST, NEXT), needs, now);
const MON_THU = { Mon: "AM", Tue: "PM", Wed: "AllDay", Thu: "AM" } as const;

describe("the Status dot", () => {
  it("Monday to Thursday with Friday as catch-up: no dot Monday and Tuesday, amber Wednesday, red from Thursday", () => {
    const days = week(MON_THU);
    expect(tone(days, at("2026-11-03T16:00"))).toBe("none");
    expect(tone(days, at("2026-11-04T08:59"))).toBe("none");
    expect(tone(days, at("2026-11-04T09:00"))).toBe("amber");
    expect(tone(days, at("2026-11-04T23:00"))).toBe("amber");
    expect(tone(days, at("2026-11-05T09:00"))).toBe("red");
    // Red through the catch-up day and the weekend, until the report goes out.
    expect(tone(days, at("2026-11-06T12:00"))).toBe("red");
    expect(tone(days, at("2026-11-08T20:00"))).toBe("red");
    expect(tone(days, at("2026-11-09T06:59"))).toBe("red");
  });

  it("goes once the report is sent, and starts again on the next week's own days", () => {
    const days = week(MON_THU, { next: true });
    expect(tone(days, at("2026-11-09T07:00"))).toBe("none");
    // The next window: Nov 9 7:00 to Nov 16 7:00.
    const s = dotSchedule(days, NEXT, "2026-11-16T12:00:00Z");
    expect(s).toEqual({ amberFrom: at("2026-11-11T09:00"), redFrom: at("2026-11-12T09:00"), until: "2026-11-16T12:00:00Z" });
  });

  it("no dot when nothing needs my update", () => {
    expect(tone(week(MON_THU), at("2026-11-05T10:00"), 0)).toBe("none");
  });

  it("Monday to Friday working hours: Friday is the catch-up day (focus blocks are Monday to Thursday), so Thursday is the last", () => {
    const days = week({ Mon: "AM", Tue: "AM", Wed: "AM", Thu: "AM" }, { friday: true });
    const friday = days.find((d) => d.date === "2026-11-06")!;
    expect(friday.start).not.toBeNull();
    expect([friday.working, friday.scheduled]).toEqual([false, false]);
    expect(tone(days, at("2026-11-04T10:00"))).toBe("amber");
    expect(tone(days, at("2026-11-05T10:00"))).toBe("red");
  });

  it("a week whose days are all scheduled up to Friday: amber Thursday, red Friday (the rule reads the days, not weekday names)", () => {
    const d = (date: string, scheduled = true): DotDay => ({ date, start: at(`${date}T09:00`), working: true, scheduled });
    const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((x) => d(x));
    expect(tone(days, at("2026-11-04T10:00"))).toBe("none");
    expect(tone(days, at("2026-11-05T10:00"))).toBe("amber");
    expect(tone(days, at("2026-11-06T10:00"))).toBe("red");
  });

  it("PTO on the last scheduled day moves red to the day before it", () => {
    const days = week(MON_THU, { pto: ["2026-11-05"] });
    expect(tone(days, at("2026-11-03T10:00"))).toBe("amber");
    expect(tone(days, at("2026-11-04T10:00"))).toBe("red");
  });

  it("a week that is all PTO has no dot", () => {
    const days = week(MON_THU, { pto: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"] });
    expect(dotSchedule(days, LAST, NEXT)).toBeNull();
    expect(tone(days, at("2026-11-08T10:00"))).toBe("none");
  });

  it("no focus blocks at all: the working days stand in (catch-up still excluded)", () => {
    const days = week(undefined);
    expect(tone(days, at("2026-11-04T10:00"))).toBe("amber");
    expect(tone(days, at("2026-11-05T10:00"))).toBe("red");
  });

  it("one scheduled day: red from its start, never amber", () => {
    const days = week({ Tue: "AM" });
    expect(dotSchedule(days, LAST, NEXT)).toEqual({ amberFrom: null, redFrom: at("2026-11-03T09:00"), until: NEXT });
    expect(tone(days, at("2026-11-02T10:00"))).toBe("none");
  });

  it("in Los Angeles: the days start at 9:00 there; the report goes out at 4:00 AM there", () => {
    const days = week(MON_THU, { zone: LA, next: true });
    expect(tone(days, at("2026-11-04T08:59", LA))).toBe("none");
    expect(tone(days, at("2026-11-04T09:00", LA))).toBe("amber");
    expect(tone(days, at("2026-11-05T09:00", LA))).toBe("red");
    expect(tone(days, at("2026-11-09T03:59", LA))).toBe("red");
    expect(tone(days, at("2026-11-09T04:00", LA))).toBe("none");
    // Monday Nov 9 starts after the send, so it belongs to the next report.
    expect(dotSchedule(days, LAST, NEXT)?.redFrom).toBe(at("2026-11-05T09:00", LA));
  });

  it("a Monday whose working hours start before the send (far east) counts for that report", () => {
    const tokyo = "Asia/Tokyo";
    const days = week(MON_THU, { zone: tokyo, next: true });
    // Monday Nov 9 9:00 in Tokyo is Sunday 7:00 PM in New York: before the 7:00 AM send.
    expect(dotSchedule(days, LAST, NEXT)?.redFrom).toBe(at("2026-11-09T09:00", tokyo));
  });

  it("review: a Monday that starts before the 7:00 AM ET send is the next report's, never this week's last day", () => {
    const early = (zone: string, start: string) => {
      const hours = legacyHours({ start, split: "12:30", end: "17:00", timeZone: zone });
      const config = aWeekConfig({ hours });
      const built = (weekStart: string) => aWeek({ weekStart, config, patterns: [aFocusBlock({ client: northwind, days: MON_THU })] });
      return [...built("2026-11-02").days, ...built("2026-11-09").days].flatMap((d) => dotDays([d], zone));
    };
    for (const [zone, start] of [[NY, "06:30"], ["America/Chicago", "05:30"], ["Europe/London", "09:00"]] as const) {
      const s = dotSchedule(early(zone, start), LAST, NEXT)!;
      expect([s.amberFrom, s.redFrom], zone).toEqual([at(`2026-11-04T${start}`, zone), at(`2026-11-05T${start}`, zone)]);
    }
  });

  it("the send instants come from the report's own schedule", () => {
    expect(lastKatRun(Temporal.Instant.from(at("2026-11-04T10:00")))).toEqual(Temporal.Instant.from(LAST));
    expect(nextKatRun(Temporal.Instant.from(at("2026-11-04T10:00")))).toEqual(Temporal.Instant.from(NEXT));
  });

  it("says why, with the send time in my zone", () => {
    expect(dotText(3, NEXT, NY)).toBe("3 features you worked on have no update. The report goes out Monday 7:00 AM.");
    expect(dotText(1, NEXT, LA)).toBe("1 feature you worked on has no update. The report goes out Monday 7:00 AM ET.");
    expect(dotText(2, NEXT, "Pacific/Auckland")).toBe("2 features you worked on have no update. The report goes out Monday 7:00 AM ET.");
  });
});
