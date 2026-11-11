// TY-1: one timeline: Week and Today draw the same component, and Timebox my day's popup is gone.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("the shared timeline", () => {
  it("Week (its block card, WD-1) and Today both draw ui/Timeline.tsx", () => {
    for (const f of ["./BlockCard.tsx", "./DayTimeline.tsx"]) {
      expect(read(f)).toMatch(/import \{[^}]*\bTimeline\b[^}]*\} from "\.\/Timeline\.tsx"/);
      expect(read(f)).toMatch(/<Timeline\b/);
    }
  });
  it("only ui/Timeline.tsx lays out a half-day's hours and events", () => {
    expect(read("./Timeline.tsx")).toMatch(/layoutEvents/);
    expect(read("./DayTimeline.tsx")).not.toMatch(/layoutEvents|hourMarks/);
  });
  it("Today draws the checklist with the list view's row, and Today alone asks for overlaps and the first hour", () => {
    expect(read("./DayTimeline.tsx")).toMatch(/<PickRow[^>]*density="today"[^>]*checklist/);
    expect(read("./DayTimeline.tsx")).toMatch(/firstHour=\{!b\.phone\} markOverlaps=\{!b\.phone\}/);
    expect(read("./WeekGrid.tsx")).not.toMatch(/firstHour|markOverlaps/);
  });
  it("the Timebox my day popup is gone", () => {
    expect(read("./Agenda.tsx")).not.toMatch(/TimeboxMyDay|MyDayBlock/);
    expect(read("./styles.css")).not.toMatch(/\.myday\b/);
  });
});
