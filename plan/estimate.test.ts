import { describe, expect, it } from "vitest";
import { aboutText, blocksToMinutes, budgetWords, estimate, hoursText, loadText, overLine, parseHours, plannedMinutesOf, progressWords, sizeChipText, sourceWords, stepHours, storyMinutes, tierOf, validEstimateHours, validEstimateMinutes, type EstItem } from "./estimate.ts";

const H = 60;
const f = (itemId: number, hours: number | null, o: Partial<EstItem> = {}): EstItem => ({ clientKey: "T&W", itemId, level: "feature", tier: "must", estimate: hours === null ? null : hours * H, ...o });
const s = (itemId: number, size: "S" | "M" | "L" | null, parentId: number | null, o: Partial<EstItem> = {}): EstItem => ({ clientKey: "T&W", itemId, level: "story", tier: "must", estimate: null, size, parentId, ...o });
const load = (items: EstItem[]) => estimate(items).envelopes[0]!;

describe("one unit: hours (E2)", () => {
  it("S, M and L are 1h, 2h and 4h; unsized counts as M", () => {
    expect([storyMinutes("S"), storyMinutes("M"), storyMinutes("L"), storyMinutes(null)]).toEqual([60, 120, 240, 120]);
  });
  it("an estimate is whole hours, 1 to 80", () => {
    expect([1, 6, 8, 80].every(validEstimateHours)).toBe(true);
    expect([0, 0.5, 1.5, 81, NaN, "4"].some(validEstimateHours)).toBe(false);
    expect([60, 480, 4800].every(validEstimateMinutes)).toBe(true);
    expect([0, 30, 90, 4860].some(validEstimateMinutes)).toBe(false);
  });
  it("words are whole hours: no fractions, no decimals, no blocks", () => {
    expect([0, 20, 30, 60, 90, 150, 420].map(hoursText)).toEqual(["0h", "under 1h", "1h", "1h", "2h", "3h", "7h"]);
    expect(aboutText(360)).toBe("about 6h");
    for (let m = 0; m <= 6000; m += 7) expect(`${hoursText(m)} ${aboutText(m)}`).not.toMatch(/[.,]\d|½|¼|¾|block/);
  });
  it("size chips: M · 2h, and Size? · 2h when unsized", () => {
    expect(["S", "M", "L", null].map((z) => sizeChipText(z as "S" | null))).toEqual(["S · 1h", "M · 2h", "L · 4h", "Size? · 2h"]);
  });
});

describe("a feature's load", () => {
  it("2 M is 4h; S + M + L is 7h", () => {
    expect(load([f(10, null), s(11, "M", 10), s(12, "M", 10)])).toMatchObject({ minutes: 4 * H, derived: true });
    expect(load([f(10, null), s(11, "S", 10), s(12, "M", 10), s(13, "L", 10)])).toMatchObject({ minutes: 7 * H, derived: true });
  });
  it("a sized and an unsized story: the size plus 2h", () => {
    expect(load([f(10, null), s(11, "L", 10), s(12, null, 10)])).toMatchObject({ minutes: 6 * H, derived: true });
    expect(load([f(10, null), s(11, "S", 10), s(12, null, 10)]).minutes).toBe(3 * H);
  });
  it("no sized stories: its estimate (4h when none was set)", () => {
    expect(load([f(10, 6)])).toMatchObject({ minutes: 6 * H, derived: false, unsized: false });
    expect(load([f(10, null)])).toMatchObject({ minutes: 4 * H, derived: false });
    expect(load([f(10, 9), s(11, null, 10), s(12, null, 10)])).toMatchObject({ minutes: 9 * H, derived: false, unsized: true });
  });
  it("the estimate is ignored once one sized story is planned", () => {
    expect(load([f(10, 20), s(11, "M", 10)])).toMatchObject({ minutes: 2 * H, derived: true });
  });
  it("where it comes from: from stories, or estimate · stories not sized when most aren't sized", () => {
    expect(sourceWords(load([f(10, null), s(11, "S", 10), s(12, "M", 10)]))).toBe("from stories");
    expect(sourceWords(load([f(10, null), s(11, "S", 10), s(12, null, 10), s(13, null, 10)]))).toBe("estimate · stories not sized");
    expect(sourceWords(load([f(10, 6), s(11, null, 10)]))).toBe("estimate · stories not sized");
    expect(sourceWords(load([f(10, 6)]))).toBeNull();
  });
  it("about where estimated; exact only when every story is sized", () => {
    expect(loadText(load([f(10, 6)]))).toBe("about 6h");
    expect(loadText(load([f(10, null), s(11, "S", 10), s(12, null, 10)]))).toBe("about 3h");
    expect(loadText(load([f(10, null), s(11, "S", 10), s(12, "L", 10)]))).toBe("5h");
  });
  it("progress in hours", () => {
    expect(progressWords(load([f(10, null), s(11, "M", 10, { done: "devops" }), s(12, "L", 10)]))).toBe("2h of 6h done");
    expect(progressWords(load([f(10, 8, { done: "local" })]))).toBe("8h of about 8h done");
  });
});

describe("features as envelopes", () => {
  it("a story whose feature is on the list nests under it; others stay loose", () => {
    const e = estimate([f(10, 2), s(11, "M", 10), s(12, "L", 99), s(13, "S", null)]);
    expect(e.envelopes[0]!.stories.map((x) => x.itemId)).toEqual([11]);
    expect(e.loose.map((x) => x.itemId)).toEqual([12, 13]);
  });
  it("only nests within the same client", () => {
    expect(estimate([f(10, 1), s(11, "M", 10, { clientKey: "Other" })]).loose).toHaveLength(1);
  });
  it("loose stories count their own size (unsized as 2h); nested ones only through their feature", () => {
    const e = estimate([f(10, 8), s(11, "L", 10), s(12, "L", 10), s(20, "M", 99), s(21, null, null), s(22, "S", null)]);
    expect(plannedMinutesOf(e, "T&W", "must")).toBe(8 * H + 2 * H + 2 * H + 1 * H);
  });
  it("stories take their feature's tier; loose ones keep their own", () => {
    const items = [f(10, 3, { tier: "nice" }), s(11, "M", 10, { tier: "must" }), s(12, "M", null, { tier: "must" })];
    const e = estimate(items);
    expect(tierOf(e, items[1]!)).toBe("nice");
    expect(tierOf(e, items[2]!)).toBe("must");
    expect(plannedMinutesOf(e, "T&W", "must")).toBe(2 * H);
    expect(plannedMinutesOf(e, "T&W", "nice")).toBe(2 * H);
  });
});

describe("a client's week in words", () => {
  it("7h free · 9h planned, with the amber about 2h over", () => {
    expect(budgetWords(7 * H, 9 * H)).toEqual({ kind: "over", free: "7h free", planned: "9h planned", over: "about 2h over", text: "7h free · 9h planned" });
    expect(budgetWords(7 * H, 4 * H)).toMatchObject({ kind: "free", over: null, text: "7h free · 4h planned" });
    expect(budgetWords(7 * H, 7 * H)).toMatchObject({ kind: "all", over: null });
    expect(budgetWords(7 * H, 0)).toMatchObject({ kind: "none", text: "7h free" });
    expect(budgetWords(0, 0).text).toBe("No focus time this week");
    expect(budgetWords(7 * H, 7 * H + 20).over).toBe("a little over");
    expect(budgetWords(7 * H, 7 * H + 5).kind).not.toBe("over");
  });
  it("the over amount matches the hours shown: 8h free · 10h planned is about 2h over", () => {
    expect(budgetWords(450, 600)).toMatchObject({ free: "8h free", planned: "10h planned", over: "about 2h over" });
    expect(overLine("Northwind", 450, 600, false)).toBe("About 2h more than Northwind's free time this week. Make one a nice to have.");
    expect(budgetWords(450, 480).over).toBe("a little over");
    for (let f = 0; f <= 900; f += 25)
      for (let p = f + 15; p <= 1200; p += 35) {
        const w = budgetWords(f, p);
        if (w.over && w.over !== "a little over" && !w.free.startsWith("under")) expect(Number(w.planned!.match(/\d+/)![0]) - (f ? Number(w.free.match(/\d+/)![0]) : 0), `${f} ${p}`).toBe(Number(w.over.match(/\d+/)![0]));
      }
  });
  it("the over line names the client and the ways out; Friday only when there is one", () => {
    expect(overLine("Northwind", 7 * H, 9 * H, true)).toBe("About 2h more than Northwind's free time this week. Make one a nice to have, or borrow Friday.");
    expect(overLine("Northwind", 7 * H, 9 * H, false)).toBe("About 2h more than Northwind's free time this week. Make one a nice to have.");
    expect(overLine("Northwind", 7 * H, 7 * H, true)).toBeNull();
  });
  it("no decimals and no blocks, whatever the numbers", () => {
    for (const [a, b] of [[425, 543], [0, 120], [95, 0], [4800, 5000], [17, 400]] as const) {
      const w = budgetWords(a, b);
      expect(`${w.text} ${w.over ?? ""} ${overLine("X", a, b, true) ?? ""}`).not.toMatch(/[.,]\d|½|¼|¾|block/);
    }
  });
});

describe("the stepper", () => {
  it("1h steps up to 8h, 2h above", () => {
    expect([1, 4, 7].map((h) => stepHours(h, 1))).toEqual([2, 5, 8]);
    expect([8, 10, 9].map((h) => stepHours(h, 1))).toEqual([10, 12, 10]);
    expect([10, 9, 8, 2].map((h) => stepHours(h, -1))).toEqual([8, 8, 7, 1]);
  });
  it("stays within 1h and 80h", () => {
    expect(stepHours(1, -1)).toBe(1);
    expect(stepHours(80, 1)).toBe(80);
  });
  it("a typed value: whole hours 1 to 80, else nothing", () => {
    expect(["6", "6h", " 12 ", "80"].map(parseHours)).toEqual([6, 6, 12, 80]);
    expect(["0", "81", "1.5", "", "six", "-2"].map(parseHours)).toEqual([null, null, null, null, null, null]);
  });
});

describe("converting stored blocks (E1 half blocks, step 16.4 whole blocks)", () => {
  it("1 block = 4h, to the nearest hour, within 1h and 80h", () => {
    expect([0.5, 1, 1.5, 3, 20].map(blocksToMinutes)).toEqual([2, 4, 6, 12, 80].map((h) => h * H));
    expect(blocksToMinutes(0.1)).toBe(60);
    expect(blocksToMinutes(30)).toBe(80 * H);
  });
});
