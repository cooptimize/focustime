// Step 16.2: ✓ and due dots on the mode switches (Today: Plan, Check-in, Close out; Week: Plan the week).
import { describe, expect, it } from "vitest";
import { dayModeStatus, weekModeStatus, type DayFacts } from "./modes.ts";

const base: DayFacts = {
  date: "2026-11-02",
  today: "2026-11-02",
  time: "09:30",
  workday: true,
  amEnd: "12:00",
  pmStart: "13:00",
  end: "17:00",
  committed: false,
  checkedIn: false,
  closedOut: false,
  checkinOffsetMinutes: 0,
  closeoutLeadMinutes: 30,
};
const at = (time: string, over: Partial<DayFacts> = {}) => dayModeStatus({ ...base, time, ...over });

describe("Today's modes", () => {
  it("Plan: due in the morning while not planned, ✓ once committed, no dot in the afternoon", () => {
    expect(at("08:00").plan).toBe("due");
    expect(at("11:59").plan).toBe("due");
    expect(at("12:00").plan).toBeNull();
    expect(at("09:00", { committed: true }).plan).toBe("done");
    expect(at("15:00", { committed: true }).plan).toBe("done");
  });

  it("Check-in: due from the end of lunch on a planned day until Close out is due; ✓ once done", () => {
    expect(at("12:59", { committed: true }).checkin).toBeNull();
    expect(at("13:00", { committed: true }).checkin).toBe("due");
    expect(at("15:59", { committed: true }).checkin).toBe("due");
    expect(at("16:00", { committed: true }).checkin).toBeNull();
    expect(at("13:30").checkin).toBeNull(); // not planned: nothing to check in on
    expect(at("13:10", { committed: true, checkinOffsetMinutes: 15 }).checkin).toBeNull();
    expect(at("13:15", { committed: true, checkinOffsetMinutes: 15 }).checkin).toBe("due");
    expect(at("14:00", { committed: true, checkedIn: true }).checkin).toBe("done");
    expect(at("17:30", { closedOut: true }).checkin).toBe("done");
  });

  it("Close out: due from an hour before the end (or the reminder's lead when longer), ✓ once closed out", () => {
    expect(at("15:59").closeout).toBeNull();
    expect(at("16:00").closeout).toBe("due");
    expect(at("19:00").closeout).toBe("due");
    expect(at("15:00", { closeoutLeadMinutes: 120 }).closeout).toBe("due");
    expect(at("16:30", { closedOut: true }).closeout).toBe("done");
  });

  it("no dots on another day, a day off or a day without hours; ✓ still shows", () => {
    expect(at("09:00", { date: "2026-11-03" })).toEqual({ plan: null, checkin: null, closeout: null });
    expect(at("09:00", { date: "2026-11-03", committed: true }).plan).toBe("done");
    expect(at("16:30", { date: "2026-10-30", closedOut: true }).closeout).toBe("done");
    expect(at("09:00", { workday: false })).toEqual({ plan: null, checkin: null, closeout: null });
    expect(at("16:30", { workday: false, amEnd: null, pmStart: null, end: null })).toEqual({ plan: null, checkin: null, closeout: null });
  });
});

describe("Plan the week", () => {
  it("✓ when that week is committed, due while a nudge asks for it, else nothing", () => {
    expect(weekModeStatus(true, "2026-11-09", "2026-11-09")).toBe("done");
    expect(weekModeStatus(false, "2026-11-09", "2026-11-09")).toBe("due");
    expect(weekModeStatus(false, "2026-11-09", "2026-11-16")).toBeNull();
    expect(weekModeStatus(false, null, "2026-11-09")).toBeNull();
  });
});

// NV-1: Today's card for the moment of the day.
import { momentCard } from "./modes.ts";
describe("Today's moment card", () => {
  const m = (time: string, over: Partial<DayFacts> = {}) => momentCard({ ...base, time, ...over });
  it("Plan today in the morning while today isn't committed, gone once committed or at the afternoon's start", () => {
    expect(m("08:00")).toEqual({ kind: "plan", done: false });
    expect(m("12:59")).toEqual({ kind: "plan", done: false });
    expect(m("10:00", { committed: true })).toBeNull();
    expect(m("13:05", { checkinOffsetMinutes: 15 })).toBeNull();
    expect(m("13:00")).toEqual({ kind: "checkin", done: false });
  });
  it("Midday check-in from the afternoon's start plus the offset until Close out is due; done is a small line", () => {
    expect(m("13:10", { committed: true, checkinOffsetMinutes: 15 })).toBeNull();
    expect(m("13:15", { committed: true, checkinOffsetMinutes: 15 })).toEqual({ kind: "checkin", done: false });
    expect(m("15:59", { committed: true })).toEqual({ kind: "checkin", done: false });
    expect(m("14:00", { committed: true, checkedIn: true })).toEqual({ kind: "checkin", done: true });
  });
  it("Close out from the end of the day minus its window (an hour, or the reminder when earlier); closed out shows done, even early", () => {
    expect(m("16:00")).toEqual({ kind: "closeout", done: false });
    expect(m("18:30")).toEqual({ kind: "closeout", done: false });
    expect(m("15:00", { closeoutLeadMinutes: 120 })).toEqual({ kind: "closeout", done: false });
    expect(m("14:00", { closedOut: true })).toEqual({ kind: "closeout", done: true });
  });
  it("nothing on another day, a day off or a day without hours", () => {
    expect(m("09:00", { date: "2026-11-03" })).toBeNull();
    expect(m("09:00", { workday: false })).toBeNull();
    expect(m("09:00", { pmStart: null, end: null, committed: true })).toBeNull();
    expect(m("09:00", { pmStart: null, end: null })).toEqual({ kind: "plan", done: false });
  });
});
