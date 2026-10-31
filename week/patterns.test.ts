import { describe, expect, it } from "vitest";
import { expandPatterns } from "./patterns";
import { pattern } from "./test-helpers";

const slots = (blocks: { date: string; half: string }[]) => blocks.map((b) => `${b.date} ${b.half}`);

describe("expandPatterns", () => {
  it("emits one block per weekday half for an ongoing pattern", () => {
    const blocks = expandPatterns([pattern({ days: { Mon: "PM", Tue: "PM" } })], "2026-11-02");
    expect(slots(blocks)).toEqual(["2026-11-02 PM", "2026-11-03 PM"]);
    expect(blocks[0]).toMatchObject({ clientKey: "wc", source: "dataverse", patternId: "p1" });
  });

  it("expands All Day into both halves", () => {
    const blocks = expandPatterns([pattern({ days: { Wed: "AllDay", Thu: "AM" } })], "2026-11-02");
    expect(slots(blocks)).toEqual(["2026-11-04 AM", "2026-11-04 PM", "2026-11-05 AM"]);
  });

  it("treats a blank end date as ongoing, years later", () => {
    const blocks = expandPatterns([pattern({ startDate: "2024-01-01", endDate: null, days: { Mon: "AM" } })], "2029-06-04");
    expect(slots(blocks)).toEqual(["2029-06-04 AM"]);
  });

  it("includes start and end dates and excludes days outside the range", () => {
    // Range Tue Nov 3 to Wed Nov 4, inclusive. Mon and Thu fall outside.
    const p = pattern({ startDate: "2026-11-03", endDate: "2026-11-04", days: { Mon: "AM", Tue: "AM", Wed: "AM", Thu: "AM" } });
    expect(slots(expandPatterns([p], "2026-11-02"))).toEqual(["2026-11-03 AM", "2026-11-04 AM"]);
  });

  it("skips patterns that start after or ended before the week", () => {
    const future = pattern({ id: "f", startDate: "2026-11-09", days: { Mon: "AM" } });
    const past = pattern({ id: "p", startDate: "2026-01-05", endDate: "2026-10-30", days: { Mon: "AM" } });
    expect(expandPatterns([future, past], "2026-11-02")).toEqual([]);
  });

  it("ignores inactive patterns", () => {
    expect(expandPatterns([pattern({ active: false, days: { Mon: "AM" } })], "2026-11-02")).toEqual([]);
  });

  it("never emits Friday blocks", () => {
    const blocks = expandPatterns([pattern({ days: { Mon: "AllDay", Tue: "AllDay", Wed: "AllDay", Thu: "AllDay" } })], "2026-11-02");
    expect(blocks).toHaveLength(8);
    expect(blocks.some((b) => b.date === "2026-11-06")).toBe(false);
  });

  describe("across DST changes", () => {
    const p = pattern({ startDate: "2026-01-05", days: { Mon: "AM", Thu: "PM" } });

    it("expands the same weekdays the week before and after fall back (Nov 1, 2026)", () => {
      expect(slots(expandPatterns([p], "2026-10-26"))).toEqual(["2026-10-26 AM", "2026-10-29 PM"]);
      expect(slots(expandPatterns([p], "2026-11-02"))).toEqual(["2026-11-02 AM", "2026-11-05 PM"]);
    });

    it("expands the week after spring forward (Mar 14, 2027)", () => {
      expect(slots(expandPatterns([p], "2027-03-15"))).toEqual(["2027-03-15 AM", "2027-03-18 PM"]);
    });

    it("keeps a pattern ending on the DST Sunday out of the following week", () => {
      const ending = pattern({ endDate: "2026-11-01", days: { Mon: "AM" } });
      expect(expandPatterns([ending], "2026-10-26")).toHaveLength(1);
      expect(expandPatterns([ending], "2026-11-02")).toHaveLength(0);
    });
  });
});
