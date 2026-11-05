import { describe, expect, it } from "vitest";
import { aPto, aWeek } from "../test/builders/index.ts";
import { agendaNowIndex, nowClock, nowSpot, ownsNow, pillSpot, railAt, type Box } from "./nowline.ts";

const NY = "America/New_York";
const at = (t: string, tz = NY) => Temporal.PlainDateTime.from(t).toZonedDateTime(tz).toInstant().toString();
const week = aWeek({ pto: [aPto({ date: "2026-11-05" })] });
const tue = week.days.find((d) => d.date === "2026-11-03")!;
const thu = week.days.find((d) => d.date === "2026-11-05")!;

describe("now line (UI-B)", () => {
  it("sits at a block's start, middle and end on its rail", () => {
    const am = tue.am.view;
    expect(railAt(am, am.start)).toBe(0);
    expect(railAt(am, am.end)).toBeNull();
    const s = nowSpot(tue, at("2026-11-03T10:45"), NY, false);
    expect(s).toMatchObject({ kind: "rail", half: "AM" });
    expect((s as { at: number }).at).toBeCloseTo((10.75 - 9) / (12.5 - 9));
    // The AM rail's end is the PM rail's start.
    expect(nowSpot(tue, am.end, NY, false)).toEqual({ kind: "rail", half: "PM", at: 0 });
  });

  it("sits in the gap before or after the day", () => {
    expect(nowSpot(tue, at("2026-11-03T07:10"), NY, false)).toEqual({ kind: "before" });
    expect(nowSpot(tue, at("2026-11-03T21:30"), NY, false)).toEqual({ kind: "after" });
  });

  it("shows on a PTO day drawn as one cell, and only on today", () => {
    expect(nowSpot(thu, at("2026-11-05T13:00"), NY, true)).toMatchObject({ kind: "whole", edge: null });
    expect(nowSpot(thu, at("2026-11-05T06:00"), NY, true)).toEqual({ kind: "whole", at: 0, edge: "before" });
    expect(nowSpot(tue, at("2026-11-05T13:00"), NY, false)).toBeNull();
  });

  it("uses the person's zone for today and the time", () => {
    // 01:30 in London on Wednesday is still Tuesday 20:30 in New York.
    const now = at("2026-11-04T01:30", "Europe/London");
    expect(nowSpot(tue, now, NY, false)).toEqual({ kind: "after" });
    expect(nowSpot(tue, now, "Europe/London", false)).toBeNull();
    expect(nowClock(now, NY)).toBe("8:30");
  });

  it("goes into the agenda before the first row that starts at or after now", () => {
    const rows = [at("2026-11-03T09:00"), Temporal.Instant.from(at("2026-11-03T11:00")).epochMilliseconds];
    expect(agendaNowIndex(rows, at("2026-11-03T10:00"), "2026-11-03", NY)).toBe(1);
    expect(agendaNowIndex(rows, at("2026-11-03T12:00"), "2026-11-03", NY)).toBe(2);
    expect(agendaNowIndex(rows, at("2026-11-03T08:00"), "2026-11-03", NY)).toBe(0);
    // A free gap from now on starts at now: the line goes before it.
    expect(agendaNowIndex(rows, at("2026-11-03T11:00"), "2026-11-03", NY)).toBe(1);
    expect(agendaNowIndex(rows, at("2026-11-03T10:00"), "2026-11-04", NY)).toBeNull();
  });

  it("is in one block's agenda only: the one under way, or the morning before the day", () => {
    expect(ownsNow(tue.am.view, "AM", at("2026-11-03T07:00"))).toBe(true);
    expect(ownsNow(tue.pm.view, "PM", at("2026-11-03T07:00"))).toBe(false);
    expect(ownsNow(tue.am.view, "AM", at("2026-11-03T14:00"))).toBe(false);
    expect(ownsNow(tue.pm.view, "PM", at("2026-11-03T14:00"))).toBe(true);
  });
});

describe("the now pill on a compact rail (HK-3)", () => {
  // A 200 px rail, 60 px wide; hour labels 14 px tall just under each hour line, at the left.
  const label = (y: number): Box => ({ top: y + 1, bottom: y + 15, left: 3, right: 17 });
  const base = { pill: { width: 30, height: 16 }, left: 6, rail: { width: 60, height: 200 } };
  it("stays on the line away from the marks", () => {
    expect(pillSpot({ ...base, line: 40, labels: [label(0), label(100)] })).toEqual({ spot: "center", top: 32 });
  });
  it("moves just above or below the mark it would cover, whichever is nearer the line", () => {
    // Just above the 10:00 line: above the label.
    expect(pillSpot({ ...base, line: 98, labels: [label(0), label(100)] })).toEqual({ spot: "above", top: 84 });
    // Just after it: below the label.
    expect(pillSpot({ ...base, line: 110, labels: [label(0), label(100)] })).toEqual({ spot: "below", top: 116 });
  });
  it("goes to the rail's right end when neither fits (marks close together on a short card)", () => {
    const tight = [label(0), label(30), label(60)];
    expect(pillSpot({ ...base, rail: { width: 60, height: 90 }, line: 33, labels: tight })).toEqual({ spot: "end", top: 25 });
  });
});
