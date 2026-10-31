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
  it("partial PTO caps the total; full PTO leaves nothing", () => {
    expect(freeMinutes({ ...slot, ptoMinutes: 120 })).toBe(90); // 210 - 120
    expect(longestFree({ ...slot, ptoMinutes: 180 })).toBe(30);
    expect(freeMinutes({ ...slot, ptoMinutes: 210 })).toBe(0);
  });
  it("PTO that an out-of-office event already blocks isn't counted twice", () => {
    const blocked = { ...slot, freeGaps: [], longestFreeMinutes: 0, ptoMinutes: 210 };
    expect(freeMinutes(blocked)).toBe(0);
    const pm = { start: T("12:30"), end: T("17:00"), freeGaps: [{ start: T("12:30"), end: T("13:00"), minutes: 30 }], longestFreeMinutes: 30, ptoMinutes: 240 };
    expect(freeMinutes(pm)).toBe(30); // OOO covers 13:00 to 17:00, 4 h PTO: still 30 m, not negative
  });
  it("now only counts while the half-day is under way", () => {
    expect(nowIfUnderway(slot, "2026-11-03T13:00:00Z")).toBeUndefined(); // 8:00, before
    expect(nowIfUnderway(slot, "2026-11-03T15:00:00Z")).toBe("2026-11-03T15:00:00Z");
    expect(nowIfUnderway(slot, "2026-11-03T18:00:00Z")).toBeUndefined();
  });
});
