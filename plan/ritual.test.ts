import { describe, expect, it } from "vitest";
import { ritualFor, type RitualInput } from "./ritual.ts";

// Mon Nov 2 2026: hours 09:00-17:00, morning ends 12:30.
const base: RitualInput = {
  time: "10:00",
  today: { workday: true, amEnd: "12:30", end: "17:00", committed: false, closedOut: false },
  weekNudge: false,
  closeoutLeadMinutes: 15,
};
const at = (time: string, o: Partial<RitualInput["today"]> = {}, rest: Partial<RitualInput> = {}) => ritualFor({ ...base, ...rest, time, today: { ...base.today, ...o } });

describe("which ritual Plan opens", () => {
  it("morning: Plan the day, also once committed", () => {
    expect(at("08:00")).toEqual({ ritual: "planday", reason: "morning" });
    expect(at("11:00", { committed: true })).toEqual({ ritual: "planday", reason: "morning" });
  });
  it("midday to the last hour: Check-in once today is committed, else still Plan the day", () => {
    expect(at("12:30", { committed: true })).toEqual({ ritual: "checkin", reason: "midday" });
    expect(at("15:59", { committed: true })).toEqual({ ritual: "checkin", reason: "midday" });
    expect(at("13:00")).toEqual({ ritual: "planday", reason: "not_planned" });
  });
  it("near the end of the day (last hour, or the Close out reminder if earlier): Close out", () => {
    expect(at("16:00", { committed: true })).toEqual({ ritual: "closeout", reason: "end_of_day" });
    expect(at("16:00")).toEqual({ ritual: "closeout", reason: "end_of_day" });
    expect(at("15:00", { committed: true }, { closeoutLeadMinutes: 120 })).toEqual({ ritual: "closeout", reason: "end_of_day" });
    expect(at("21:00", { committed: true })).toEqual({ ritual: "closeout", reason: "end_of_day" });
  });
  it("once closed out, or on a day off: Plan the day (the next workday)", () => {
    expect(at("16:30", { closedOut: true })).toEqual({ ritual: "planday", reason: "next_workday" });
    expect(at("10:00", { workday: false, amEnd: null, end: null })).toEqual({ ritual: "planday", reason: "next_workday" });
  });
  it("a weekly nudge that is active wins", () => {
    expect(at("10:00", {}, { weekNudge: true })).toEqual({ ritual: "planweek", reason: "week_nudge" });
    expect(at("16:30", { committed: true }, { weekNudge: true })).toEqual({ ritual: "planweek", reason: "week_nudge" });
  });
});
