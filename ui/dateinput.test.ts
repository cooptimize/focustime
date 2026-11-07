// AH-5: typed dates, quick picks, the Monday-first month grid and where a popover goes.
import { describe, expect, it } from "vitest";
import { monthGrid, parseTypedDate, quickPicks } from "./dateinput.ts";
import { placePopover } from "./popover-place.ts";

const TODAY = "2026-11-06"; // a Friday

describe("parseTypedDate", () => {
  it.each([
    ["nov 20", "2026-11-20"],
    ["November 20th", "2026-11-20"],
    ["20 nov", "2026-11-20"],
    ["11/20", "2026-11-20"],
    ["11/20/27", "2027-11-20"],
    ["2026-11-20", "2026-11-20"],
    ["Dec 1, 2026", "2026-12-01"],
    ["jan 5", "2027-01-05"],
    ["oct 30", "2026-10-30"],
    ["today", "2026-11-06"],
    ["tomorrow", "2026-11-07"],
  ])("%s → %s", (t, d) => expect(parseTypedDate(t, TODAY)).toBe(d));
  it.each(["", "nov 31", "13/1", "someday", "2026-02-30"])("%s can't be read", (t) => expect(parseTypedDate(t, TODAY)).toBeNull());
});

describe("quickPicks", () => {
  it("Today, Tomorrow, Next Monday, +1 week (from the value, else today) and Clear", () => {
    expect(quickPicks(TODAY, null).map((q) => [q.label, q.date])).toEqual([["Today", "2026-11-06"], ["Tomorrow", "2026-11-07"], ["Next Monday", "2026-11-09"], ["+1 week", "2026-11-13"], ["Clear", null]]);
    expect(quickPicks(TODAY, "2026-12-01").find((q) => q.key === "week")!.date).toBe("2026-12-08");
    // On a Monday, next Monday is a week on.
    expect(quickPicks("2026-11-09", null).find((q) => q.key === "monday")!.date).toBe("2026-11-16");
  });
});

describe("monthGrid", () => {
  it("six weeks starting on Monday, the month's days marked", () => {
    const g = monthGrid(2026, 11);
    expect(g).toHaveLength(6);
    expect(g[0]![0]).toEqual({ date: "2026-10-26", inMonth: false });
    expect(g[0]![6]).toEqual({ date: "2026-11-01", inMonth: true });
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(30);
    expect(g.flat().every((d) => Temporal.PlainDate.from(d.date).dayOfWeek === (g.flat().indexOf(d) % 7) + 1)).toBe(true);
  });
});

describe("placePopover", () => {
  const view = { width: 1440, height: 900 };
  it("goes under the cell, its left on the cell's", () => expect(placePopover({ left: 600, top: 200, right: 700, bottom: 230 }, { width: 320, height: 300 }, view)).toEqual({ left: 600, top: 234, above: false, maxHeight: 658 }));
  it("too tall for either side: over the cell, all of it on screen", () => {
    const p = placePopover({ left: 600, top: 440, right: 700, bottom: 470 }, { width: 320, height: 620 }, view);
    expect(p.top).toBe(900 - 8 - 620);
    expect(p.top + 620).toBeLessThanOrEqual(892);
    expect(p.maxHeight).toBe(884);
  });
  it("slides left at the right edge and flips above at the bottom", () => {
    const p = placePopover({ left: 1380, top: 820, right: 1430, bottom: 850 }, { width: 320, height: 300 }, view);
    expect(p.left).toBe(1440 - 320 - 8);
    expect(p.above).toBe(true);
    expect(p.top + 300).toBeLessThanOrEqual(816);
  });
});
