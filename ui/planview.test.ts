import { describe, expect, it } from "vitest";
import type { Pick, PlanWeek, Size } from "../plan/types.ts";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import type { WorkItem } from "../week/types.ts";
import { cardPlan } from "./planview.ts";
import { fitLabel } from "./planday.ts";

// Mon Nov 2 AM, 9:00–12:30 with no meetings: 3h 30m free. The clock is before the block starts.
const slot = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [], config }).days[0]!.am;
const NOW = "2026-11-02T13:00:00Z"; // 8:00 New York
const item = (id: number): WorkItem => ({ id, title: `Item ${id}`, type: "User Story", state: "New", stateCategory: "Proposed", level: "story", order: id, parentId: null, changedAt: "", url: `https://dev.azure.com/org/P/_workitems/edit/${id}` });
const ITEMS = [1, 2, 3, 4, 5].map(item);
let nextId = 1;
const pick = (over: Partial<Pick> & { size?: Size } = {}): Pick => ({ id: nextId++, date: "2026-11-02", half: "AM", clientKey: "CSC", kind: "item", itemId: 1, draftId: null, title: "Item 1", itemType: "User Story", itemUrl: null, size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, position: 1, createdAt: "", updatedAt: "", ...over });
const plan = (picks: Pick[], committed = true): PlanWeek => ({ "2026-11-02": { committedAt: committed ? "2026-11-02T08:10:00-05:00[America/New_York]" : null, picks } });

describe("a card's plan (step 6.1)", () => {
  it("before commit: no picks, every item, not collapsed (the step 6 card)", () => {
    const cp = cardPlan(plan([pick({ itemId: 2 })], false), slot, "CSC", ITEMS, NOW);
    expect(cp).toEqual({ picks: [], fit: null, items: ITEMS, collapsed: false });
    expect(cardPlan(null, slot, "CSC", ITEMS, NOW).collapsed).toBe(false);
  });

  it("committed: the picks, their fit against the block's free time, and the list collapsed", () => {
    const cp = cardPlan(plan([pick({ itemId: 2, size: "M" }), pick({ kind: "intention", itemId: null, size: "S" })]), slot, "CSC", ITEMS, NOW);
    expect(cp.picks).toHaveLength(2);
    expect(cp.fit).toEqual({ kind: "fits", spare: 30 }); // 210 free − (120 + 60)
    expect(fitLabel(cp.fit!)).toBe("fits · 30m spare");
    expect(cp.collapsed).toBe(true);
  });

  it("tight under 30 minutes spare, over by the excess", () => {
    expect(fitLabel(cardPlan(plan([pick({ size: "L" })]), slot, "CSC", ITEMS, NOW).fit!)).toBe("tight · full"); // 210 of 210
    expect(fitLabel(cardPlan(plan([pick({ size: "L" }), pick({ itemId: 3, size: "S" })]), slot, "CSC", ITEMS, NOW).fit!)).toBe("over by 1h");
  });

  it("an item picked here is not listed again; another client's pick with the same id is", () => {
    const cp = cardPlan(plan([pick({ itemId: 2 }), pick({ itemId: 4, clientKey: "W&C" })]), slot, "CSC", ITEMS, NOW);
    expect(cp.items.map((i) => i.id)).toEqual([1, 3, 4, 5]);
  });

  it("done picks still count as picked; dropped and moved ones do not show", () => {
    const cp = cardPlan(plan([pick({ itemId: 2, status: "done" }), pick({ itemId: 3, status: "dropped" }), pick({ itemId: 5, status: "moved" })]), slot, "CSC", ITEMS, NOW);
    expect(cp.picks.map((p) => p.itemId)).toEqual([2]);
    expect(cp.items.map((i) => i.id)).toEqual([1, 3, 4, 5]);
    expect(cp.fit).toBeNull(); // nothing left to do, so no fit to show
  });

  it("committed with no picks in this half: no fit, the list still collapses", () => {
    const cp = cardPlan(plan([pick({ half: "PM" })]), slot, "CSC", ITEMS, NOW);
    expect(cp).toMatchObject({ picks: [], fit: null, collapsed: true, items: ITEMS });
  });
});
