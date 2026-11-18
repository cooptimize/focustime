import { describe, expect, it } from "vitest";
import { DAY_EXAMPLE, LUNCH_EXAMPLE, readDay, readLunch, readSpan, ZERO_LUNCH } from "./hours-text.ts";

describe("SA-2: working hours as typed", () => {
  it("reads the three forms people type as the app's one format", () => {
    for (const t of ["9:00 to 13:00", "9:00-13:00", "09:00–13:00", " 9:00 — 13:00 ", "9:00 TO 13:00"]) expect(readSpan(t)).toEqual({ start: "09:00", end: "13:00" });
    expect(readDay("9:00 to 12:00, 13:00-17:00")).toEqual({ value: "09:00-12:00, 13:00-17:00" });
    expect(readDay("")).toEqual({ value: "" });
    expect(readSpan("20:00-24:00")).toEqual({ start: "20:00", end: "24:00" });
  });

  it("refuses anything else with an example", () => {
    for (const t of ["9-5", "9am-5pm", "nine to five", "13:00-9:00", "25:00-26:00", "9:00", "24:30-24:45"]) expect(readDay(t)).toEqual({ problem: DAY_EXAMPLE });
    expect(DAY_EXAMPLE).toMatch(/9:00-17:00/);
    expect(readLunch("noon", "")).toEqual({ problem: LUNCH_EXAMPLE });
  });

  it("refuses a zero-length lunch, but keeps one that is already saved", () => {
    expect(readLunch("12:30-12:30", "")).toEqual({ problem: ZERO_LUNCH });
    expect(readLunch("12:30 to 12:30", "12:00-12:00")).toEqual({ problem: ZERO_LUNCH });
    expect(readLunch("12:00-12:00", "12:00-12:00")).toEqual({ value: "12:00-12:00" });
    expect(readLunch("12:30 to 13:00", "")).toEqual({ value: "12:30-13:00" });
    expect(readLunch(" ", "12:00-12:30")).toEqual({ value: "" });
  });
});
