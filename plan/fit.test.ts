import { describe, expect, it } from "vitest";
import { capacityMinutes } from "./rules.ts";
import { dayTotals, fitWords, planFit, trimCandidates } from "./fit.ts";

const SIZES = { S: 60, M: 120, L: 210 };
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

describe("fitWords thresholds (plain words, step 16.4)", () => {
  it("nothing planned says nothing", () => expect(fitWords({ kind: "empty" }).text).toBe(""));
  it("under 45m spare is Fits", () => {
    expect(fitWords({ kind: "tight", spare: 0 })).toEqual({ kind: "fits", text: "Fits", tone: "neutral" });
    expect(fitWords({ kind: "fits", spare: 44 }).text).toBe("Fits");
  });
  it("more spare is room in whole hours", () => {
    expect(fitWords({ kind: "fits", spare: 45 }).text).toBe("Room for about an hour more");
    expect(fitWords({ kind: "fits", spare: 135 })).toEqual({ kind: "room", text: "Room for about 2 hours more", tone: "neutral" });
  });
  it("over by 10m or less still Fits", () => expect(fitWords({ kind: "over", by: 10 }).text).toBe("Fits"));
  it("over by more is amber, in plain words", () => {
    expect(fitWords({ kind: "over", by: 11 })).toEqual({ kind: "over", text: "A little over", tone: "watch" });
    expect(fitWords({ kind: "over", by: 60 }).text).toBe("About an hour over");
    expect(fitWords({ kind: "over", by: 195 }).text).toBe("About 3 hours over");
  });
  it("never uses red", () => {
    for (const f of [{ kind: "over", by: 500 }, { kind: "fits", spare: 5 }] as const) expect(fitWords(f).tone).not.toBe("risk");
  });
});

describe("trimCandidates", () => {
  const picks = [pick(1, "S"), pick(2, "L"), pick(3, "M"), pick(4, "M", "done")];
  it("takes the fewest, largest planned picks that cover the overage", () => {
    expect(trimCandidates(picks, 100, SIZES)).toEqual([2]);
    expect(trimCandidates(picks, 250, SIZES)).toEqual([2, 3]);
  });
  it("keeps musts for last and skips timed ones when it can", () => {
    expect(trimCandidates(picks, 100, SIZES, { musts: new Set([2]) })).toEqual([3]);
    expect(trimCandidates([pick(1, "M"), pick(2, "M")], 60, SIZES, { timed: new Set([2]) })).toEqual([1]);
  });
  it("nothing when within the grace", () => expect(trimCandidates(picks, 10, SIZES)).toEqual([]));
});

describe("dayTotals", () => {
  it("reads work then free, in whole hours", () => expect(dayTotals([{ planned: 240, free: 210 }, { planned: 180, free: 165 }])).toBe("About 7 hours of work · about 6 hours free"));
  it("says nothing planned yet", () => expect(dayTotals([{ planned: 0, free: 120 }])).toBe("Nothing planned yet · about 2 hours free"));
});
