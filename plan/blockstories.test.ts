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

describe("cardGroups in the clock's order (WK-5)", () => {
  const work = aClientWork({ items: [aFeature({ id: 10, title: "Billing" }), aWorkItem({ id: 100, parentId: 10 }), aWorkItem({ id: 103, parentId: 10 }), aWorkItem({ id: 101, parentId: 11 })], parents: [aFeature({ id: 11, title: "Search" })] });
  const at = (t: string) => `2026-11-12T${t}:00-05:00`;
  it("orders features by their earliest timebox and to-dos inside by time, untimed after", () => {
    // Before WK-5: Billing (10:30, 11:30) then Search (9:00), so the 9:00 to-do sat under the 10:30 one.
    const picks = [aPick({ id: 1, itemId: 100 }), aPick({ id: 2, itemId: 103 }), aPick({ id: 3, itemId: 101 }), aPick({ id: 4, itemId: null, kind: "intention" })];
    const times: Record<number, string> = { 1: at("11:30"), 2: at("10:30"), 3: at("09:00") };
    const gs = cardGroups(picks, work, (p) => times[p.id] ?? null);
    expect(gs.map((g) => [g.feature?.title ?? null, g.picks.map((p) => p.id)])).toEqual([
      ["Search", [3]],
      ["Billing", [2, 1]],
      [null, [4]],
    ]);
  });
  it("keeps untimed to-dos in their order after the timed ones of their group", () => {
    const picks = [aPick({ id: 1, itemId: 100 }), aPick({ id: 2, itemId: 103 }), aPick({ id: 3, itemId: 101 })];
    const gs = cardGroups(picks, work, (p) => (p.id === 2 ? at("13:00") : null));
    expect(gs.map((g) => [g.feature?.title ?? null, g.picks.map((p) => p.id)])).toEqual([
      ["Billing", [2, 1]],
      ["Search", [3]],
    ]);
  });
  it("keeps the old order when nothing is timed", () => {
    const picks = [aPick({ id: 3, itemId: 101 }), aPick({ id: 1, itemId: 100 }), aPick({ id: 4, itemId: null, kind: "intention" })];
    expect(cardGroups(picks, work, () => null).map((g) => g.picks.map((p) => p.id))).toEqual([[3], [1], [4]]);
  });
  it("puts a timed No feature group by its time too", () => {
    const picks = [aPick({ id: 1, itemId: 100 }), aPick({ id: 4, itemId: null, kind: "intention" })];
    const gs = cardGroups(picks, work, (p) => (p.id === 4 ? at("09:00") : p.id === 1 ? at("10:00") : null));
    expect(gs.map((g) => g.feature?.title ?? null)).toEqual([null, "Billing"]);
  });
});
