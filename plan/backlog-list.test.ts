// BL-2: Backlog lists the chosen level in that level's own backlog rank order, never grouped by the level above.
// STEP 0.4's proof: two epics, the first-ranked epic holding the feature ranked third, the second-ranked epic holding
// the features ranked first and second. With Features chosen, today's Grid and Gantt list them grouped by epic.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad } from "../test/builders/index.ts";
import { DEFAULT_FILTERS, groups } from "./ahead-model.ts";
import { atLevel, tree, visible } from "./gantt-tree.ts";
import type { AheadFilters } from "./ahead-edit.ts";

const epic = (id: number, order: number) => anAheadItem({ id, type: "Epic", level: "top", rung: 0, order, title: `Epic ranked ${order}` });
const feature = (id: number, parentId: number, order: number, start: string) => anAheadItem({ id, parentId, order, start, target: start, title: `Feature ranked ${order}` });
const story = (id: number, parentId: number, order: number) => anAheadItem({ id, parentId, order, type: "User Story", level: "child", rung: 2, title: `Story ranked ${order}` });

export const rankItems = [
  epic(1, 1),
  epic(2, 2),
  // Under the first-ranked epic: the feature ranked third.
  feature(13, 1, 3, "2026-11-02"),
  // Under the second-ranked epic: the features ranked first and second.
  feature(11, 2, 1, "2026-12-07"),
  feature(12, 2, 2, "2026-11-16"),
  // Stories under features ranked differently from the features.
  story(103, 11, 3),
  story(101, 13, 1),
  story(102, 12, 2),
];
const load = anAheadLoad([anAheadClient({ items: rankItems })]);
const all: AheadFilters = { ...DEFAULT_FILTERS, owner: { Northwind: "all" } };

describe("STEP 0.4: today's Backlog groups a level by the level above", () => {
  // Today's Grid with Features chosen: the tree, epics open, features in tree order.
  const gridToday = (tier: "feature" | "story") => groups(load, all, { stories: true })[0]!.rows.filter((r) => r.tier === tier).map((r) => r.item.id);
  // Today's Gantt: the tree with siblings by start date, folded to the level.
  const ganttToday = (tier: "feature" | "story") => {
    const rows = groups(load, all, { stories: true })[0]!.rows;
    return visible(tree(rows, (a, b) => (a.eff.start ?? "9999").localeCompare(b.eff.start ?? "9999")), atLevel("story")).map((s) => s.node.row).filter((r) => r.tier === tier).map((r) => r.item.id);
  };
  it.fails("the Grid at Features lists first, second, third whatever their epics", () => {
    expect(gridToday("feature")).toEqual([11, 12, 13]);
  });
  it.fails("the Grid at Stories lists first, second, third whatever their features", () => {
    expect(gridToday("story")).toEqual([101, 102, 103]);
  });
  it.fails("the Gantt at Features lists first, second, third", () => {
    expect(ganttToday("feature")).toEqual([11, 12, 13]);
  });
  it("what today shows instead: grouped by epic", () => {
    expect(gridToday("feature")).toEqual([13, 11, 12]);
  });
});
