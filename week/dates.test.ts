import { describe, expect, it } from "vitest";
import { defaultWeekStart, mondayOf, todayTarget, weekDates } from "./dates";
import { config } from "./test-helpers";

describe("week dates", () => {
  it("lists Mon to Fri for a Monday", () => {
    expect(weekDates("2026-11-02")).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  });

  it("rejects a week start that is not a Monday", () => {
    expect(() => weekDates("2026-11-03")).toThrow(/Monday/);
  });

  it("finds the Monday of any date", () => {
    expect(mondayOf("2026-11-05")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
  });

  it("shows the current week on weekdays and the coming week on weekends", () => {
    expect(defaultWeekStart("2026-10-29")).toBe("2026-10-26");
    expect(defaultWeekStart("2026-10-30")).toBe("2026-10-26");
    expect(defaultWeekStart("2026-10-31")).toBe("2026-11-02");
    expect(defaultWeekStart("2026-11-01")).toBe("2026-11-02");
  });
});

describe("today target", () => {
  const shape = config.dayShape;
  it("picks AM before the split and PM from the split on", () => {
    expect(todayTarget("2026-11-03T12:29:00-05:00", shape)).toEqual({ weekStart: "2026-11-02", dayIndex: 1, half: "AM" });
    expect(todayTarget("2026-11-03T12:30:00-05:00", shape)).toEqual({ weekStart: "2026-11-02", dayIndex: 1, half: "PM" });
  });

  it("uses the configured time zone, not the instant's offset", () => {
    // 17:10 UTC on Nov 3 is 12:10 in New York.
    expect(todayTarget("2026-11-03T17:10:00Z", shape)).toEqual({ weekStart: "2026-11-02", dayIndex: 1, half: "AM" });
  });

  it("jumps to the coming Monday AM on a weekend", () => {
    expect(todayTarget("2026-10-31T15:00:00-04:00", shape)).toEqual({ weekStart: "2026-11-02", dayIndex: 0, half: "AM" });
  });
});
