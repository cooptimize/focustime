import { describe, expect, it } from "vitest";
import { nextWorkday, planTarget } from "./target.ts";

const at = (s: string) => Temporal.ZonedDateTime.from(`${s}[America/New_York]`);

describe("next workday targeting", () => {
  it("a workday before the usual end plans today", () => {
    expect(planTarget(at("2026-11-03T08:00"), "17:00")).toEqual({ date: "2026-11-03", isToday: true });
    expect(planTarget(at("2026-11-03T16:59"), "17:00").date).toBe("2026-11-03");
  });
  it("after the end of a Mon–Wed day plans tomorrow", () => {
    expect(planTarget(at("2026-11-03T17:00"), "17:00")).toEqual({ date: "2026-11-04", isToday: false });
  });
  it("Thursday evening, Friday and the weekend plan Monday", () => {
    expect(planTarget(at("2026-11-05T18:30"), "17:00").date).toBe("2026-11-09");
    expect(planTarget(at("2026-11-06T10:00"), "17:00").date).toBe("2026-11-09");
    expect(planTarget(at("2026-10-31T12:00"), "17:00")).toEqual({ date: "2026-11-02", isToday: false });
    expect(planTarget(at("2026-11-01T23:59"), "17:00").date).toBe("2026-11-02");
  });
  it("crosses month and year ends", () => {
    expect(nextWorkday("2026-12-31")).toBe("2027-01-04");
    expect(nextWorkday("2026-11-30")).toBe("2026-12-01");
  });
});
