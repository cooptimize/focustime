import { describe, expect, it } from "vitest";
import { entryKey, fixQueue, gapsOf, type GapItem } from "./fixnext.ts";

const item = (o: Partial<GapItem> & { id: number }): GapItem => ({ clientKey: "k", open: true, needsBreakdown: false, openChildren: 1, startField: "S", targetField: "T", sizeField: "Z", child: false, start: "2026-11-09", target: "2026-11-20", size: null, assigneeEmail: "a@example.com", canEdit: true, ...o });

describe("Fix next (D658)", () => {
  it("finds the gaps an item has, only where the process has the field and I may edit", () => {
    expect(gapsOf(item({ id: 1, needsBreakdown: true, openChildren: 0, start: null, assigneeEmail: null }))).toEqual(["needs_stories", "no_dates", "unassigned"]);
    expect(gapsOf(item({ id: 2, child: true, start: null, target: null }))).toEqual(["unsized"]);
    expect(gapsOf(item({ id: 3, child: true, sizeField: null }))).toEqual([]);
    expect(gapsOf(item({ id: 4, assigneeEmail: null, canEdit: false }))).toEqual([]);
  });
  it("a pending change fills its gap", () => {
    const i = item({ id: 5, assigneeEmail: null });
    expect(gapsOf(i, [{ clientKey: "k", itemId: 5, field: "assignee", value: { email: "b@example.com", name: "B" } }])).toEqual([]);
    expect(gapsOf(item({ id: 6 }), [{ clientKey: "k", itemId: 6, field: "assignee", value: null }])).toEqual(["unassigned"]);
  });
  it("orders by target (soonest first, none last), then gap, then id; Skip takes one out", () => {
    const items = [item({ id: 10, target: null, start: null }), item({ id: 11, target: "2026-12-01", assigneeEmail: null }), item({ id: 12, target: "2026-11-20", assigneeEmail: null, needsBreakdown: true, openChildren: 0 })];
    const q = fixQueue(items);
    expect(q.map((e) => `${e.itemId}:${e.gap}`)).toEqual(["12:needs_stories", "12:unassigned", "11:unassigned", "10:no_dates"]);
    expect(fixQueue(items, [], new Set([entryKey("k", 12, "needs_stories")]))[0]!.key).toBe(entryKey("k", 12, "unassigned"));
  });
});
