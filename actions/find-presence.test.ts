// BL-1: Find item's Backlog line follows what the Grid shows: Needs attention keeps only its list's items, and one
// level as a list only that level; each relaxed alone names the filter that hides the item.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad } from "../test/builders/index.ts";
import { DEFAULT_FILTERS } from "../plan/ahead-model.ts";
import type { AheadFilters } from "../plan/ahead-edit.ts";
import { aheadPresence } from "./devops-fresh-actions.ts";

const me = { name: "Alex Rivera", email: "you@cooptimize.example" };
const items = [
  anAheadItem({ id: 100, type: "Epic", level: "top", rung: 0, assignee: me, target: "2026-12-18", start: "2026-11-02" }),
  // A feature under my epic with no target and no owner: on Needs attention.
  anAheadItem({ id: 110, parentId: 100, title: "Loyalty points" }),
  anAheadItem({ id: 111, type: "User Story", level: "child", rung: 2, parentId: 110, assignee: me, size: 3 }),
  // Ready: dated, assigned, with a sized story.
  anAheadItem({ id: 120, parentId: 100, title: "Store locator", assignee: me, start: "2026-11-09", target: "2026-11-13" }),
  anAheadItem({ id: 121, type: "User Story", level: "child", rung: 2, parentId: 120, assignee: me, size: 2 }),
];
const load = anAheadLoad([{ ...anAheadClient({ items }), editable: items.map((i) => i.id) }], { today: "2026-11-02" });
const f = (x: Partial<AheadFilters>): AheadFilters => ({ ...DEFAULT_FILTERS, owner: { Northwind: "all" }, ...x });

describe("BL-1: Find item's Backlog line", () => {
  it("with no filters both are shown", () => {
    expect(aheadPresence(load, f({}), "Northwind", 110)).toEqual({ kind: "shown" });
    expect(aheadPresence(load, f({}), "Northwind", 120)).toEqual({ kind: "shown" });
  });
  it("Needs attention hides a ready item and says so; it shows an item with a gap", () => {
    expect(aheadPresence(load, f({ gaps: true }), "Northwind", 110)).toEqual({ kind: "shown" });
    expect(aheadPresence(load, f({ gaps: true }), "Northwind", 120)).toEqual({ kind: "filtered", filter: "ready" });
  });
  it("one level as a list hides the other levels and says so", () => {
    expect(aheadPresence(load, f({ flat: "story" }), "Northwind", 111)).toEqual({ kind: "shown" });
    expect(aheadPresence(load, f({ flat: "story" }), "Northwind", 110)).toEqual({ kind: "filtered", filter: "flat" });
  });
});
