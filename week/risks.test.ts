import { describe, expect, it } from "vitest";
import { buildWeek } from "./build";
import { allDayPersonal, meeting, noStanding, pattern, personal } from "./test-helpers";
import type { CalEvent, Risk } from "./types";

// Tue Nov 3, 2026: CSC all day. AM is 09:00-12:30 (210 min), PM is 12:30-17:00 (270 min).
const csc = pattern({ clientKey: "csc", clientName: "CSC", days: { Tue: "AllDay" } });

function risks(events: CalEvent[], half: "AM" | "PM"): Risk[] {
  const w = buildWeek({ weekStart: "2026-11-02", patterns: [csc], events, config: noStanding });
  const day = w.days[1]!;
  return (half === "AM" ? day.am : day.pm).risks;
}
const T = (hm: string) => `2026-11-03T${hm}`;
const summary = (rs: Risk[]) => rs.map((r) => `${r.rule}:${r.severity}`);

describe("rule 1: meeting load", () => {
  it.each([
    ["89 minutes", "13:59", []],
    ["90 minutes", "14:00", ["meeting_load:watch"]],
    ["149 minutes", "14:59", ["meeting_load:watch"]],
    ["150 minutes", "15:00", ["meeting_load:at_risk"]],
  ])("%s of meetings in the PM block", (_label, end, expected) => {
    // Back to back from 12:30; the free tail to 17:00 stays at 2h or more, so rule 3 stays quiet.
    const evs = [meeting(T("12:30"), T("13:00")), meeting(T("13:00"), T(end as string))];
    expect(summary(risks(evs, "PM"))).toEqual(expected);
  });

  it("names the time and the block in the reason", () => {
    const [r] = risks([meeting(T("12:30"), T("14:00"))], "PM");
    expect(r?.reason).toBe("1h 30m of meetings inside the CSC block");
  });

  it("counts overlapping meetings once", () => {
    const rs = risks([meeting(T("13:00"), T("14:00")), meeting(T("13:30"), T("14:30"))], "PM");
    expect(summary(rs)).toEqual(["meeting_load:watch"]);
    expect(rs[0]?.reason).toMatch(/^1h 30m /);
  });

  it("counts tentative, ignores free and personal events", () => {
    expect(summary(risks([meeting(T("12:30"), T("14:00"), { showAs: "tentative" })], "PM"))).toEqual(["meeting_load:watch"]);
    expect(summary(risks([meeting(T("12:30"), T("14:00"), { showAs: "free" })], "PM"))).toEqual([]);
    const personalOnly = summary(risks([personal(T("12:30"), T("14:00"))], "PM"));
    expect(personalOnly).not.toContain("meeting_load:watch");
  });

  it("only counts the part of a meeting inside the block", () => {
    // 12:00-14:00 is 30 min in AM and 90 min in PM.
    const evs = [meeting(T("12:00"), T("14:00"))];
    expect(summary(risks(evs, "AM"))).toEqual([]);
    expect(summary(risks(evs, "PM"))).toEqual(["meeting_load:watch"]);
  });

  it("reads the user-story example: 3h 15m is at risk and leaves no focus window", () => {
    const rs = risks(
      [meeting(T("13:00"), T("14:30")), meeting(T("14:30"), T("15:30"), { showAs: "tentative" }), meeting(T("15:45"), T("16:30"))],
      "PM",
    );
    expect(summary(rs)).toEqual(["meeting_load:at_risk", "no_focus_window:at_risk"]);
    expect(rs[0]?.reason).toBe("3h 15m of meetings inside the CSC block");
  });
});

describe("rule 2: personal conflict", () => {
  it("flags a timed personal event inside the block as at risk with its time", () => {
    const rs = risks([personal(T("15:30"), T("16:00"), { title: "School pickup" })], "PM");
    expect(summary(rs)).toEqual(["personal_conflict:at_risk"]);
    expect(rs[0]?.reason).toBe("School pickup 3:30–4:00 PM overlaps the CSC block");
  });

  it("does not flag an event that ends exactly when the block starts", () => {
    expect(risks([personal(T("08:30"), T("09:00"), { title: "Preschool drop-off" })], "AM")).toEqual([]);
  });

  it("does not flag an event that starts exactly when the block ends", () => {
    expect(risks([personal(T("17:00"), T("17:30"))], "PM")).toEqual([]);
  });

  it("flags a one-minute overlap", () => {
    expect(summary(risks([personal(T("08:30"), T("09:01"))], "AM"))).toEqual(["personal_conflict:at_risk"]);
  });

  it("ignores personal events marked free", () => {
    expect(risks([personal(T("10:00"), T("10:30"), { showAs: "free" })], "AM")).toEqual([]);
  });

  it("flags an all-day personal event as watch on both halves", () => {
    const evs = [allDayPersonal("2026-11-03", "2026-11-04", "Early release day")];
    expect(summary(risks(evs, "AM"))).toEqual(["personal_conflict:watch"]);
    expect(summary(risks(evs, "PM"))).toEqual(["personal_conflict:watch"]);
    expect(risks(evs, "AM")[0]?.reason).toBe("All-day personal event: Early release day");
  });

  it("formats a range across noon with both meridiems", () => {
    const [r] = risks([personal(T("11:30"), T("12:15"), { title: "Dentist" })], "AM");
    expect(r?.reason).toBe("Dentist 11:30 AM–12:15 PM overlaps the CSC block");
  });
});

describe("rule 3: no focus window", () => {
  it("flags a block with no free stretch of 90 minutes", () => {
    // AM gaps: 9:00-10:00 (60), 10:30-11:30 (60), 12:00-12:30 (30)
    const rs = risks([meeting(T("10:00"), T("10:30")), meeting(T("11:30"), T("12:00"))], "AM");
    expect(summary(rs)).toEqual(["no_focus_window:at_risk"]);
    expect(rs[0]?.reason).toBe("Longest free stretch is 1h, under 1h 30m, in the CSC block");
  });

  it("accepts a free stretch of exactly 90 minutes", () => {
    // AM gaps: 9:00-10:30 (90), 11:00-12:00 (60)
    expect(risks([meeting(T("10:30"), T("11:00")), meeting(T("12:00"), T("12:30"))], "AM")).toEqual([]);
  });

  it("flags 89 minutes", () => {
    // AM gaps: 9:00-10:29 (89), 10:59-12:00 (61)
    const rs = risks([meeting(T("10:29"), T("10:59")), meeting(T("12:00"), T("12:30"))], "AM");
    expect(summary(rs)).toEqual(["no_focus_window:at_risk"]);
  });

  it("counts a meeting that starts before the block only from the block start", () => {
    // 08:00-10:30 occupies 9:00-10:30; the gap 10:30-12:00 is exactly 90.
    const rs = risks([meeting(T("08:00"), T("10:30")), meeting(T("12:00"), T("12:30"))], "AM");
    expect(summary(rs)).not.toContain("no_focus_window:at_risk");
  });

  it("treats personal events as busy time", () => {
    const rs = risks([personal(T("10:00"), T("11:00")), meeting(T("11:30"), T("12:00"))], "AM");
    expect(summary(rs)).toEqual(["personal_conflict:at_risk", "no_focus_window:at_risk"]);
  });

  it("ignores free events when looking for a window", () => {
    expect(risks([meeting(T("10:00"), T("11:00"), { showAs: "free" }), meeting(T("11:30"), T("12:00"), { showAs: "free" })], "AM")).toEqual([]);
  });
});
