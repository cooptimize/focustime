// TY-1: one timeline: Week and Today draw the same component, and Timebox my day's popup is gone.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("the shared timeline", () => {
  it("Week and Today both draw ui/Timeline.tsx", () => {
    for (const f of ["./WeekGrid.tsx", "./TodayTimeline.tsx"]) {
      expect(read(f)).toMatch(/import \{[^}]*\bTimeline\b[^}]*\} from "\.\/Timeline\.tsx"/);
      expect(read(f)).toMatch(/<Timeline\b/);
    }
  });
  it("only ui/Timeline.tsx lays out a half-day's hours and events", () => {
    expect(read("./Timeline.tsx")).toMatch(/layoutEvents/);
    expect(read("./TodayTimeline.tsx")).not.toMatch(/layoutEvents|hourMarks/);
  });
  it("the Timebox my day popup is gone", () => {
    expect(read("./PlanDay.tsx")).not.toMatch(/TimeboxMyDay|MyDayBlock/);
    expect(read("./styles.css")).not.toMatch(/\.myday\b/);
  });
});
