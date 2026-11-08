// TY-1: timeboxing on Today's timeline: drops snap to 15 minutes and stay inside their block, the keyboard's nudges,
// the next free slot, the phone's list, and where a placeholder may go.
import { describe, expect, it } from "vitest";
import type { Slot } from "../week/types.ts";
import type { AgendaTimebox } from "./agenda.ts";
import { clampSpan, dropSpan, nextFreeSpan, nudgeSpan, placeholderFits, quarterStarts } from "./timeline.ts";
import { SIZE_MINUTES } from "./types.ts";

const TZ = "America/Chicago";
const at = (t: string) => `2026-11-02T${t}:00-06:00`;
const view = { start: at("09:00"), end: at("12:30") };
const gap = (a: string, b: string, minutes: number) => ({ start: at(a), end: at(b), minutes });
// 9:00 to 12:30 with a meeting 10:00 to 11:00: free 9:00 to 10:00 and 11:00 to 12:30.
const slot = { date: "2026-11-02", start: view.start, end: view.end, view, half: "AM", freeGaps: [gap("09:00", "10:00", 60), gap("11:00", "12:30", 90)] } as unknown as Slot;
const box = (id: number, a: string, b: string, pickId: number | null = id): AgendaTimebox & { outlook: boolean } => ({ id, date: "2026-11-02", start: at(a), end: at(b), title: "t", clientKey: "c", pickId, removedAt: null, outlook: false });
const clock = (s: { start: string; end: string }) => `${s.start.slice(11, 16)}-${s.end.slice(11, 16)}`;

describe("dropSpan", () => {
  it("snaps to the nearest 15 minutes with the to-do's length", () => {
    // 9:00 + 0.33 of 3.5h = about 10:09, so 10:15; 60 minutes long.
    expect(clock(dropSpan(view, 0.33, 60, TZ))).toBe("10:15-11:15");
  });
  it("slides up from the block's bottom edge rather than cutting the to-do", () => {
    expect(clock(dropSpan(view, 1, 120, TZ))).toBe("10:30-12:30");
  });
  it("is cut only when longer than the block", () => {
    expect(clock(dropSpan(view, 0, 480, TZ))).toBe("09:00-12:30");
  });
});

describe("clampSpan and nudgeSpan", () => {
  it("a move past the edge slides back whole; a resize is cut", () => {
    expect(clock(clampSpan(view, { start: at("12:00"), end: at("13:00") }, "move"))).toBe("11:30-12:30");
    expect(clock(clampSpan(view, { start: at("08:30"), end: at("09:30") }, "move"))).toBe("09:00-10:00");
    expect(clock(clampSpan(view, { start: at("12:00"), end: at("13:00") }, "end"))).toBe("12:00-12:30");
  });
  it("moves and resizes by 15 minutes, and stops at the edge", () => {
    const s = { start: at("09:00"), end: at("10:00") };
    expect(clock(nudgeSpan(view, s, 1, false)!)).toBe("09:15-10:15");
    expect(clock(nudgeSpan(view, s, 1, true)!)).toBe("09:00-10:15");
    expect(clock(nudgeSpan(view, s, -1, true)!)).toBe("09:00-09:45");
    expect(nudgeSpan(view, s, -1, false)).toBeNull();
    expect(nudgeSpan(view, { start: at("12:15"), end: at("12:30") }, -1, true)).toBeNull();
  });
});

describe("nextFreeSpan", () => {
  it("takes the first free stretch that fits, skipping timeboxes", () => {
    expect(clock(nextFreeSpan(slot, [], { id: 1, size: "M" }, SIZE_MINUTES)!)).toBe("09:00-10:00");
    expect(clock(nextFreeSpan(slot, [box(9, "09:00", "10:00")], { id: 1, size: "S" }, SIZE_MINUTES)!)).toBe("11:00-12:00");
  });
  it("says nothing when no free stretch fits", () => {
    expect(nextFreeSpan(slot, [box(8, "09:00", "10:00"), box(9, "11:00", "12:30")], { id: 1, size: "S" }, SIZE_MINUTES)).toBeNull();
  });
});

describe("quarterStarts", () => {
  it("lists each quarter hour the to-do fits whole, never over a meeting", () => {
    const list = quarterStarts(slot, [], null, 60, TZ).map(clock);
    expect(list).toEqual(["09:00-10:00", "11:00-12:00", "11:15-12:15", "11:30-12:30"]);
  });
  it("counts its own timebox as free", () => {
    const own = box(1, "11:00", "12:00");
    expect(quarterStarts(slot, [own], own, 60, TZ).map(clock)).toContain("11:15-12:15");
  });
  it("starts from now on today", () => {
    expect(quarterStarts(slot, [], null, 30, TZ, at("11:40")).map(clock)).toEqual(["11:45-12:15", "12:00-12:30"]);
  });
});

describe("placeholderFits", () => {
  it("fits in free time, and never over a meeting or another timebox", () => {
    expect(placeholderFits(slot, [], { start: at("09:00"), end: at("10:00") })).toBe(true);
    expect(placeholderFits(slot, [], { start: at("09:30"), end: at("10:30") })).toBe(false);
    expect(placeholderFits(slot, [box(9, "11:00", "11:30")], { start: at("11:15"), end: at("11:45") })).toBe(false);
  });
});
