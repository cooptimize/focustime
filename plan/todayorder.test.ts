import { describe, expect, it } from "vitest";
import { blockRows } from "./todayorder.ts";

const T = (h: string) => `2026-11-02T${h}:00-05:00`;
const sizes = { S: 60, M: 120, L: 240, unsized: 60 };
const opts = {
  start: T("09:00"),
  end: T("12:30"),
  // Standup 9:00 to 9:15, a review 11:00 to 11:45.
  freeGaps: [
    { start: T("09:15"), end: T("11:00"), minutes: 105 },
    { start: T("11:45"), end: T("12:30"), minutes: 45 },
  ],
  now: T("09:30"),
  sizes,
  boxStart: () => null,
};
const ev = (id: string, start: string) => ({ id, start: T(start) });
const pick = (id: number, size: string, position: number, status = "planned") => ({ id, size, position, status });
const names = (rows: ReturnType<typeof blockRows<{ id: string; start: string }, ReturnType<typeof pick>>>) => rows.map((r) => (r.kind === "event" ? r.event.id : `#${r.pick.id}`));

describe("blockRows: one block's rows in time order", () => {
  it("puts a done pick at the start, untimed picks through the free time from now, meetings at their times", () => {
    const rows = blockRows([ev("standup", "09:00"), ev("review", "11:00")], [pick(1, "M", 0, "done"), pick(2, "S", 1), pick(3, "M", 2), pick(4, "S", 3)], opts);
    // #2 at 9:30, #3 at 10:30 (still in the first gap), #4 after the review.
    expect(names(rows)).toEqual(["standup", "#1", "#2", "#3", "review", "#4"]);
  });

  it("places a timed pick at its timebox", () => {
    const rows = blockRows([ev("standup", "09:00"), ev("review", "11:00")], [pick(2, "S", 0), pick(3, "S", 1)], { ...opts, boxStart: (id) => (id === 2 ? T("11:45") : null) });
    expect(names(rows)).toEqual(["standup", "#3", "review", "#2"]);
  });

  it("puts picks with no free time left at the end, in plan order", () => {
    const rows = blockRows([ev("standup", "09:00")], [pick(5, "S", 1), pick(6, "S", 0)], { ...opts, freeGaps: [], now: T("09:30") });
    expect(names(rows)).toEqual(["standup", "#6", "#5"]);
  });
});
