import { DEFAULT_SIZE_SCALE } from "./estimate.ts";
import { describe, expect, it } from "vitest";
import { dayFocus, focusLabel, liveFocused } from "./focus.ts";
import type { Pick } from "./types.ts";

const pick = (id: number, size: Pick["size"], status: Pick["status"] = "planned") => ({ id, size, status }) as Pick;
const SIZES = { XS: 30, S: 60, M: 120, L: 210, unsized: 60 };

describe("focused time on picks (step 6d)", () => {
  it("adds the running stretch of a live session on that pick to what is logged", () => {
    const timer = { pickId: 7, runningSince: "2026-11-02T15:00:00Z" };
    const now = Temporal.Instant.from("2026-11-02T15:10:30Z").epochMilliseconds;
    expect(liveFocused(7, { 7: 1500 }, timer, now)).toBe(1500 + 630);
    expect(liveFocused(8, { 7: 1500 }, timer, now)).toBe(0);
    // Paused or ended: only the log counts.
    expect(liveFocused(7, { 7: 1500 }, { pickId: 7, runningSince: null }, now)).toBe(1500);
    expect(liveFocused(7, {}, null, now)).toBe(0);
  });

  it("labels it next to the size, from a whole minute on", () => {
    expect(focusLabel(2700, "M", DEFAULT_SIZE_SCALE)).toBe("45m of M");
    expect(focusLabel(4500, "S", DEFAULT_SIZE_SCALE)).toBe("1h 15m of S");
    expect(focusLabel(59, "S", DEFAULT_SIZE_SCALE)).toBeNull();
    expect(focusLabel(0, "L", DEFAULT_SIZE_SCALE)).toBeNull();
  });

  it("totals a day: focused over every pick, planned over picks not dropped", () => {
    const picks = [pick(1, "M"), pick(2, "S", "done"), pick(3, "L", "dropped")];
    expect(dayFocus(picks, { 1: 1800, 2: 3600, 3: 600 }, SIZES)).toEqual({ focusedMinutes: 100, plannedMinutes: 180 });
    expect(dayFocus([], {}, SIZES)).toEqual({ focusedMinutes: 0, plannedMinutes: 0 });
  });
});
