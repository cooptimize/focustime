import { describe, expect, it } from "vitest";
import { capacityMinutes } from "./rules.ts";
import { planFit } from "./fit.ts";

const SIZES = { XS: 30, S: 60, M: 120, L: 210, unsized: 60 };
const at = (hm: string) => `2026-11-02T${hm}:00-05:00`;
const slot = { date: "2026-11-02", start: at("09:00"), end: at("12:30"), pto: false, longestFreeMinutes: 90, freeGaps: [{ start: at("09:00"), end: at("10:00"), minutes: 60 }, { start: at("11:00"), end: at("12:30"), minutes: 90 }] };
const pick = (id: number, size: string, status = "planned") => ({ id, size, status });

describe("planFit: the whole block, not the time left", () => {
  it("compares picks with every free minute of the block, whatever the time", () => {
    // 150m free in the block; at 11:30 only 60m are left, but planning still counts the whole block.
    expect(capacityMinutes(slot, at("11:30"))).toBe(60);
    expect(planFit([pick(1, "M")], SIZES, [], slot)).toEqual({ kind: "fits", spare: 30 });
  });
  it("counts done picks too, so finishing work never makes room appear", () => {
    expect(planFit([pick(1, "M", "done"), pick(2, "S")], SIZES, [], slot)).toEqual({ kind: "over", by: 30 });
  });
  it("leaves dropped and moved picks out", () => {
    expect(planFit([pick(1, "L", "dropped"), pick(2, "L", "moved")], SIZES, [], slot)).toEqual({ kind: "empty" });
  });
  it("uses a timed pick's own minutes instead of its size", () => {
    const tb = { date: slot.date, pickId: 1, start: at("09:00"), end: at("09:30"), removedAt: null };
    expect(planFit([pick(1, "L")], SIZES, [tb], slot)).toEqual({ kind: "fits", spare: 120 });
  });
  it("a PTO block has no free time", () => {
    expect(planFit([pick(1, "S")], SIZES, [], { ...slot, pto: true })).toEqual({ kind: "over", by: 60 });
  });
});
