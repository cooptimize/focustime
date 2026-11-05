// AH-1: Ahead's shared model: my pending values over DevOps's, the owner filter (Mine by default, All for a lead,
// remembered per client), ancestors kept as context, gaps a pending change fills, stories only where asked.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad, anAssignee } from "../../test/builders/index.ts";
import { buildRows, DEFAULT_FILTERS, filterRows, groups, ownerOf } from "./model.ts";

const ME = "you@cooptimize.example";
const me = { name: "Alex Rivera", email: ME };
const items = [
  anAheadItem({ id: 100, type: "Epic", level: "top", rung: 0, assignee: me }),
  anAheadItem({ id: 110, parentId: 100, assignee: anAssignee("Dana Reyes"), target: "2026-12-04" }),
  anAheadItem({ id: 111, type: "User Story", level: "child", rung: 2, parentId: 110, assignee: anAssignee("Dana Reyes") }),
  anAheadItem({ id: 200, type: "Epic", level: "top", rung: 0, assignee: anAssignee("Lee Park") }),
  anAheadItem({ id: 210, parentId: 200, assignee: anAssignee("Lee Park") }),
  anAheadItem({ id: 211, type: "User Story", level: "child", rung: 2, parentId: 210, assignee: me }),
  anAheadItem({ id: 300, assignee: anAssignee("Lee Park") }),
];
const client = anAheadClient({ me: ME, items });

describe("Ahead's model", () => {
  it("tree order, pending values over DevOps's, conflicts marked", () => {
    const load = anAheadLoad([{ ...client, editable: [100, 110, 111] }], { changes: [{ clientKey: "Northwind", itemId: 110, field: "target", value: "2026-12-11", half: "AM", baseRev: 3, baseValue: "2026-12-04", theirs: "2027-01-08", createdAt: "x", updatedAt: "x" }] });
    const rows = buildRows(load, load.clients[0]!);
    expect(rows.map((r) => [r.item.id, r.depth])).toEqual([[100, 0], [110, 1], [111, 2], [200, 0], [210, 1], [211, 2], [300, 0]]);
    const f = rows.find((r) => r.item.id === 110)!;
    expect([f.eff.target, f.targetHalf, f.conflict]).toEqual(["2026-12-11", "AM", true]);
  });
  it("Mine: mine and what's under my features and epics; Contributing: what my stories are under; All: everything; ancestors as context", () => {
    const load = anAheadLoad([client]);
    const c = load.clients[0]!;
    const rows = buildRows(load, c);
    const shown = (owner: "mine" | "contributing" | "all") => filterRows(rows, c, { ...DEFAULT_FILTERS, owner: { Northwind: owner } }, { stories: true }).map((r) => `${r.item.id}${r.context ? "c" : ""}`);
    expect(ownerOf(DEFAULT_FILTERS, c)).toBe("mine");
    expect(ownerOf(DEFAULT_FILTERS, { ...c, lead: true })).toBe("all");
    expect(shown("mine")).toEqual(["100", "110", "111", "200c", "210c", "211"]);
    expect(shown("contributing")).toEqual(["200", "210", "211"]);
    expect(shown("all")).toHaveLength(7);
    // The Gantt has no stories.
    expect(filterRows(rows, c, { ...DEFAULT_FILTERS, owner: { Northwind: "all" } }, { stories: false }).some((r) => r.tier === "story")).toBe(false);
  });
  it("gaps on items I may change; a pending change fills one; date and text filters", () => {
    const load = anAheadLoad([{ ...client, editable: [110, 111] }], { changes: [{ clientKey: "Northwind", itemId: 111, field: "size", value: 3, half: null, baseRev: 3, baseValue: null, createdAt: "x", updatedAt: "x" }] });
    const rows = buildRows(load, load.clients[0]!);
    expect(rows.find((r) => r.item.id === 110)!.gaps).toEqual(["no_dates"]);
    expect(rows.find((r) => r.item.id === 111)!.gaps).toEqual([]);
    expect(rows.find((r) => r.item.id === 300)!.gaps).toEqual([]);
    const g = groups(load, { ...DEFAULT_FILTERS, owner: { Northwind: "all" }, from: "2026-12-01", to: "2026-12-31" }, { stories: true })[0]!;
    expect(g.rows.filter((r) => !r.context).map((r) => r.item.id)).toEqual([110]);
    expect(groups(load, { ...DEFAULT_FILTERS, owner: { Northwind: "all" }, q: "#300" }, { stories: true })[0]!.rows.map((r) => r.item.id)).toEqual([300]);
  });
});
