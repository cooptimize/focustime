import { describe, expect, it } from "vitest";
import { carryTarget, dayRule, stepDay, upcomingStart } from "./days.ts";
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

  it("is the earliest upcoming day that can be planned and isn't committed", () => {
    const committed = new Set<string>();
    const c = (d: string) => committed.has(d);
    expect(carryTarget(TUE, c)).toBe(TUE);
    committed.add(TUE);
    expect(carryTarget(TUE, c)).toBe("2026-11-04");
    committed.add("2026-11-04");
    expect(carryTarget(TUE, c, new Set(["2026-11-05"]))).toBe("2026-11-09");
    // From a Saturday: Monday.
    expect(carryTarget("2026-11-07", () => false)).toBe("2026-11-09");
  });
});
