import { describe, expect, it } from "vitest";
import { blockLabel, cardGroups, isChildLevel } from "./blockstories.ts";
import { aClientWork, aFeature, aPick, aWorkItem, TYPE_LOOKS, WEEK } from "../test/builders/index.ts";


describe("child level (PV-1)", () => {
  it("names a block in short", () => {
    expect(blockLabel({ date: WEEK, half: "PM" })).toMatch(/^Mon PM$/);
  });
  it("uses the process level when known, the backlog level otherwise", () => {
    expect(isChildLevel(aWorkItem({ type: "Task" }), TYPE_LOOKS)).toBe(false);
    expect(isChildLevel(aWorkItem({ type: "Task" }), undefined)).toBe(true);
    expect(isChildLevel(aWorkItem({ type: "Bug" }), TYPE_LOOKS)).toBe(true);
  });
});

describe("cardGroups (PV-1)", () => {
  it("puts a card's picks under their feature, in the order the picks come, No feature last", () => {
    const work = aClientWork({ items: [aFeature({ id: 10, title: "Billing" }), aWorkItem({ id: 100, parentId: 10 }), aWorkItem({ id: 101, parentId: 11 }), aWorkItem({ id: 102 })], parents: [aFeature({ id: 11, title: "Search" })] });
    const picks = [aPick({ itemId: 102 }), aPick({ itemId: 101 }), aPick({ itemId: 100 }), aPick({ itemId: null, kind: "intention" })];
    const gs = cardGroups(picks, work);
    expect(gs.map((g) => [g.feature?.title ?? null, g.picks.map((p) => p.itemId)])).toEqual([
      ["Search", [101]],
      ["Billing", [100]],
      [null, [102, null]],
    ]);
  });
});
