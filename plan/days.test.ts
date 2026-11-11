import { describe, expect, it } from "vitest";
import { canAddWork, carryTarget, dayRule, planButton, stepDay, upcomingStart } from "./days.ts";
import { planTarget } from "./target.ts";

const at = (s: string) => Temporal.ZonedDateTime.from(`${s}[America/New_York]`);
const TUE = "2026-11-03";

describe("which days Plan the day opens", () => {
  it("the default target is unchanged: today before the end of day, else the next workday", () => {
    expect(planTarget(at("2026-11-03T08:00"), "17:00")).toEqual({ date: TUE, isToday: true });
    expect(planTarget(at("2026-11-05T18:00"), "17:00")).toEqual({ date: "2026-11-09", isToday: false });
  });

  it("today and later days plan fully; earlier days are past; PTO and days without hours are refused", () => {
    expect(dayRule(TUE, TUE, null)).toEqual({ ok: true, access: "plan" });
    expect(dayRule("2026-12-10", TUE, null)).toEqual({ ok: true, access: "plan" });
    expect(dayRule("2026-11-02", TUE, null)).toEqual({ ok: true, access: "past" });
    expect(dayRule("2026-11-05", TUE, { titles: ["Watch Kids"] })).toMatchObject({ ok: false, kind: "pto", reason: "Thu, Nov 5 is a PTO day (Watch Kids). Nothing can be planned on it" });
    for (const d of ["2026-11-06", "2026-11-07", "2026-11-08"]) expect(dayRule(d, TUE, null)).toMatchObject({ ok: false, kind: "no_hours" });
    // PTO wins over past: a past PTO day is still refused.
    expect(dayRule("2026-10-29", TUE, { titles: [] })).toMatchObject({ ok: false, kind: "pto", reason: "Thu, Oct 29 is a PTO day. Nothing can be planned on it" });
  });

  it("stepping by day skips Fridays, weekends and known PTO, across weeks", () => {
    expect(stepDay(TUE, 1)).toBe("2026-11-04");
    expect(stepDay("2026-11-04", 1, new Set(["2026-11-05"]))).toBe("2026-11-09");
    expect(stepDay("2026-11-09", -1)).toBe("2026-11-05");
    expect(stepDay("2026-11-09", -1, new Set(["2026-11-05"]))).toBe("2026-11-04");
    expect(stepDay("2026-12-31", 1)).toBe("2027-01-04");
  });
});

describe("the carry-over day", () => {
  it("starts today until the usual end of day, then tomorrow", () => {
    expect(upcomingStart(at("2026-11-03T16:59"), "17:00")).toBe(TUE);
    expect(upcomingStart(at("2026-11-03T17:00"), "17:00")).toBe("2026-11-04");
  });

  it("CF-1: is the next day that can take work (hours, not PTO); a day with work on it is no reason to skip it", () => {
    expect(carryTarget(TUE)).toBe(TUE);
    expect(carryTarget(TUE, new Set([TUE, "2026-11-04", "2026-11-05"]))).toBe("2026-11-09");
    // From a Saturday: Monday.
    expect(carryTarget("2026-11-07")).toBe("2026-11-09");
  });
});

describe("plannability from the time model (step 6b, D127)", () => {
  // A Friday with working hours and a Saturday with a flex session.
  const has = (d: string) => !["2026-11-08"].includes(d) && Temporal.PlainDate.from(d).dayOfWeek !== 7 && d !== "2026-11-14" && d !== "2026-11-15";
  it("a Friday or weekend day with hours or a flex session can be stepped to, planned and carried over to", () => {
    expect(stepDay("2026-11-05", 1, new Set(), has)).toBe("2026-11-06");
    expect(stepDay("2026-11-06", 1, new Set(), has)).toBe("2026-11-07");
    expect(stepDay("2026-11-07", 1, new Set(), has)).toBe("2026-11-09");
    expect(carryTarget("2026-11-07", new Set(), has)).toBe("2026-11-07");
    expect(dayRule("2026-11-07", "2026-11-03", null, true)).toEqual({ ok: true, access: "plan" });
    expect(dayRule("2026-11-08", "2026-11-03", null, false)).toMatchObject({ ok: false, kind: "no_hours" });
    expect(dayRule("2026-11-07", "2026-11-03", { titles: [] }, true)).toMatchObject({ ok: false, kind: "pto" });
  });
  it("planTarget moves to a Friday with hours instead of the next Monday", () => {
    const thuEvening = Temporal.ZonedDateTime.from("2026-11-05T18:00:00-05:00[America/New_York]");
    expect(planTarget(thuEvening, "17:00", new Set(), has).date).toBe("2026-11-06");
    expect(planTarget(thuEvening, "17:00").date).toBe("2026-11-09");
  });
  it("a day ending at midnight is still today until midnight", () => {
    expect(upcomingStart(Temporal.ZonedDateTime.from("2026-11-05T23:30:00-05:00[America/New_York]"), "24:00")).toBe("2026-11-05");
  });
});

describe("the day header Plan button (step 13.6, D240)", () => {
  const base = { date: "2026-11-02", today: "2026-11-01", pto: false, hasHours: true, hasPicks: false };
  it("says Plan with no to-dos and Planned once the day has one (CF-1: no confirm)", () => {
    expect(planButton(base)).toBe("plan");
    expect(planButton({ ...base, hasPicks: true })).toBe("planned");
  });
  it("is hidden on PTO days and days without working hours", () => {
    expect(planButton({ ...base, pto: true })).toBe("hidden");
    expect(planButton({ ...base, date: "2026-11-07", hasHours: false, hasPicks: true })).toBe("hidden");
  });
  it("on Friday: Plan with hours, the Add hours link with work and no hours, nothing otherwise", () => {
    const fri = { ...base, date: "2026-11-06" };
    expect(planButton({ ...fri, hasHours: true })).toBe("plan");
    expect(planButton({ ...fri, hasHours: false, hasPicks: true })).toBe("add_hours");
    expect(planButton({ ...fri, hasHours: false })).toBe("hidden");
  });
  it("past days show only when they were planned (a review)", () => {
    const past = { ...base, date: "2026-10-29" };
    expect(planButton(past)).toBe("hidden");
    expect(planButton({ ...past, hasPicks: true })).toBe("planned");
  });
});

describe("+ Add work on a block (step 13.6, D241)", () => {
  const base = { date: "2026-11-02", today: "2026-11-01", pto: false, off: false };
  it("is offered on a block with working time, today or later", () => {
    expect(canAddWork(base)).toBe(true);
    expect(canAddWork({ ...base, date: "2026-11-01" })).toBe(true);
  });
  it("is not offered on past days, PTO or blocks without working time (Friday without hours too)", () => {
    expect(canAddWork({ ...base, date: "2026-10-30" })).toBe(false);
    expect(canAddWork({ ...base, pto: true })).toBe(false);
    expect(canAddWork({ ...base, date: "2026-11-06", off: true })).toBe(false);
  });
});
