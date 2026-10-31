import { describe, expect, it } from "vitest";
import { freeMinutes, longestFree, nowIfUnderway } from "./free.ts";

const T = (hm: string) => `2026-11-03T${hm}:00-05:00`;
// AM 9:00 to 12:30 with meetings 10:00 to 10:45 and 11:30 to 12:00.
const slot = {
  start: T("09:00"),
  end: T("12:30"),
  freeGaps: [
    { start: T("09:00"), end: T("10:00"), minutes: 60 },
    { start: T("10:45"), end: T("11:30"), minutes: 45 },
    { start: T("12:00"), end: T("12:30"), minutes: 30 },
  ],
  longestFreeMinutes: 60,
};

describe("free time math (one number for cards, details and Plan the day)", () => {
  it("total free is the sum of the free gaps", () => {
    expect(freeMinutes(slot)).toBe(135);
    expect(longestFree(slot)).toBe(60);
  });
  it("from now on: time that has passed doesn't count", () => {
    expect(freeMinutes(slot, "2026-11-03T14:40:00Z")).toBe(20 + 45 + 30); // 9:40 New York
    expect(freeMinutes(slot, "2026-11-03T18:00:00Z")).toBe(0); // after the half-day
  });
  it("a PTO day has no free time at all (D105)", () => {
    expect(freeMinutes({ ...slot, pto: true })).toBe(0);
    expect(longestFree({ ...slot, pto: true })).toBe(0);
    expect(freeMinutes({ ...slot, pto: false })).toBe(freeMinutes(slot));
  });
  it("now only counts while the half-day is under way", () => {
    expect(nowIfUnderway(slot, "2026-11-03T13:00:00Z")).toBeUndefined(); // 8:00, before
    expect(nowIfUnderway(slot, "2026-11-03T15:00:00Z")).toBe("2026-11-03T15:00:00Z");
    expect(nowIfUnderway(slot, "2026-11-03T18:00:00Z")).toBeUndefined();
  });
});
