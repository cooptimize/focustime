// Step 17, slice 4: when the Plan ahead rituals are due.
import { describe, expect, it } from "vitest";
import { aheadRitualsDue, directionOccasion, lookAheadOccasion, nextRituals, type RitualFacts } from "./rituals.ts";

const base: RitualFacts = { today: "2026-11-05", time: "09:00", workStart: "08:30", pto: false, weekCommitted: () => true, seen: () => false };
const due = (f: Partial<RitualFacts>) => aheadRitualsDue({ ...base, ...f }).map((r) => r.key);
/** Look ahead only (Nov 5 is also November's first Thursday). */
const la = (f: Partial<RitualFacts>) => due(f).filter((k) => k.startsWith("plan_ahead:"));

describe("Look ahead 4 weeks: every other Thursday, after Done in Plan the week", () => {
  it("the look-ahead week runs Thursday to Wednesday, every other week", () => {
    expect(lookAheadOccasion("2026-11-05")).toBe("2026-11-05");
    expect(lookAheadOccasion("2026-11-11")).toBe("2026-11-05");
    expect(lookAheadOccasion("2026-11-12")).toBeNull();
    expect(lookAheadOccasion("2026-11-19")).toBe("2026-11-19");
    expect(lookAheadOccasion("2026-11-04")).toBeNull();
  });
  it("due once next week is committed, from work start; not before", () => {
    expect(la({ today: "2026-11-05", time: "08:00" })).toEqual([]);
    expect(la({ today: "2026-11-05", weekCommitted: (w) => w !== "2026-11-09" })).toEqual([]);
    expect(la({ today: "2026-11-05", weekCommitted: (w) => w === "2026-11-09" })).toEqual(["plan_ahead:2026-11-05"]);
    // Done in Plan the week on Friday: it is offered then.
    expect(la({ today: "2026-11-06" })).toEqual(["plan_ahead:2026-11-05"]);
  });
  it("a PTO Thursday moves it to the next working day's start; opening Plan ahead ends it", () => {
    expect(la({ today: "2026-11-05", pto: true })).toEqual([]);
    expect(la({ today: "2026-11-06", time: "08:30" })).toEqual(["plan_ahead:2026-11-05"]);
    expect(la({ today: "2026-11-06", workStart: null })).toEqual([]);
    expect(la({ today: "2026-11-06", seen: (k) => k === "plan_ahead:2026-11-05" })).toEqual([]);
  });
});

describe("the direction review: first Thursday of each month", () => {
  it("from the first Thursday to the end of the month", () => {
    expect(directionOccasion("2026-12-02")).toBeNull();
    expect(directionOccasion("2026-12-03")).toBe("2026-12-03");
    expect(directionOccasion("2026-12-31")).toBe("2026-12-03");
    expect(directionOccasion("2027-01-01")).toBeNull();
    expect(directionOccasion("2027-01-07")).toBe("2027-01-07");
  });
  it("due at work start on a working day, once seen no more; PTO waits for the next working day", () => {
    expect(due({ today: "2026-12-03", weekCommitted: () => false })).toEqual(["direction:2026-12"]);
    expect(due({ today: "2026-12-03", pto: true, weekCommitted: () => false })).toEqual([]);
    expect(due({ today: "2026-12-04", weekCommitted: () => false })).toEqual(["direction:2026-12"]);
    expect(due({ today: "2026-12-04", weekCommitted: () => false, seen: (k) => k === "direction:2026-12" })).toEqual([]);
  });
  it("Nov 5 is both: a look-ahead Thursday and November's first Thursday", () => {
    expect(due({ today: "2026-11-05" })).toEqual(["plan_ahead:2026-11-05", "direction:2026-11"]);
  });
});

describe("Settings > Planning: the next dates", () => {
  it("the next look-ahead Thursday and direction review on or after a day", () => {
    expect(nextRituals("2026-11-02")).toEqual({ lookAhead: "2026-11-05", direction: "2026-11-05" });
    expect(nextRituals("2026-11-06")).toEqual({ lookAhead: "2026-11-19", direction: "2026-12-03" });
    expect(nextRituals("2026-11-19")).toEqual({ lookAhead: "2026-11-19", direction: "2026-12-03" });
  });
});
