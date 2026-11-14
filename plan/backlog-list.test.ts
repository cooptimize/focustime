// BL-2: Backlog lists the chosen level in that level's own backlog rank order, never grouped by the level above.
// STEP 0.4's proof (two epics, the first-ranked epic holding the feature ranked third, the second-ranked epic holding the
// features ranked first and second) failed against the old tree; this file now checks the one rule (plan/backlog-list.ts)
// the Grid and the Gantt both read.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad } from "../test/builders/index.ts";
import { DEFAULT_FILTERS, groups } from "./ahead-model.ts";
import { expandAll, tree, visible, type Fold } from "./gantt-tree.ts";
import { listCount, listGroups, listOf, type ListRow } from "./backlog-list.ts";
import type { AheadFilters } from "./ahead-edit.ts";
import type { Tier } from "./ahead-model.ts";

const epic = (id: number, order: number) => anAheadItem({ id, type: "Epic", level: "top", rung: 0, order, title: `Epic ranked ${order}` });
const feature = (id: number, parentId: number | null, order: number, start: string) => anAheadItem({ id, parentId, order, start, target: start, title: `Feature ranked ${order}` });
const story = (id: number, parentId: number | null, order: number) => anAheadItem({ id, parentId, order, type: "User Story", level: "child", rung: 2, title: `Story ranked ${order}` });

const items = [
  epic(1, 1),
  epic(2, 2),
  // Under the first-ranked epic: the feature ranked third. Its start is the earliest, so a start-date order puts it first.
  feature(13, 1, 3, "2026-11-02"),
  // Under the second-ranked epic: the features ranked first and second.
  feature(11, 2, 1, "2026-12-07"),
  feature(12, 2, 2, "2026-11-16"),
  // Stories under features ranked differently from the features.
  story(103, 11, 3),
  story(104, 11, 4),
  story(101, 13, 1),
  story(102, 12, 2),
];
const load = anAheadLoad([anAheadClient({ items })]);
const all: AheadFilters = { ...DEFAULT_FILTERS, owner: { Northwind: "all" } };
const list = (level: Tier, f: Partial<AheadFilters> = {}, l = load) => listOf(l, l.clients[0]!, { ...all, ...f }, { level });
const top = (level: Tier, f: Partial<AheadFilters> = {}, l = load) => list(level, f, l).rows.filter((r) => r.depth === 0);
const ids = (rows: readonly Pick<ListRow, "item">[]) => rows.map((r) => r.item.id);
/** The rows on screen as the Gantt draws them: the list as a tree (in the order given), folded. */
const gantt = (level: Tier, fold: Fold = { level, rows: {} }) => visible(tree(list(level).rows), fold).map((s) => s.node.row.item.id);

describe("BL-2: the level picked is the list, in that level's rank order", () => {
  it("STEP 0.4: features list first, second, third whatever their epics, with their true rank numbers", () => {
    expect(ids(top("feature"))).toEqual([11, 12, 13]);
    expect(top("feature").map((r) => r.rank)).toEqual([1, 2, 3]);
    // Items at the level above are not rows.
    expect(list("feature").rows.some((r) => r.tier === "epic")).toBe(false);
  });
  it("stories under features ranked differently: first, second, third, fourth", () => {
    expect(ids(top("story"))).toEqual([101, 102, 103, 104]);
    expect(top("story").map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
  it("the Gantt reads the same list: features first, second, third (never by start date)", () => {
    expect(gantt("feature")).toEqual([11, 12, 13]);
    expect(gantt("story")).toEqual([101, 102, 103, 104]);
  });
  it("each row shows its parent as a label", () => {
    expect(top("feature").map((r) => r.parent?.title)).toEqual(["Epic ranked 2", "Epic ranked 2", "Epic ranked 1"]);
    expect(top("feature")[0]!.parent).toMatchObject({ key: "Northwind:2", id: 2, tier: "epic" });
  });
  it("a client with no backlog order lists by target date and says so", () => {
    const noOrder = anAheadLoad([anAheadClient({ items, orderField: null })]);
    const g = list("feature", {}, noOrder);
    expect(g.rankedBy).toBe("target");
    // Targets: 13 on Nov 2, 12 on Nov 16, 11 on Dec 7.
    expect(ids(top("feature", {}, noOrder))).toEqual([13, 12, 11]);
    expect(top("feature", {}, noOrder).map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(list("feature").rankedBy).toBe("backlog");
  });
});

describe("BL-2: a row opens to what is one level under it", () => {
  it("opening a feature lists its stories in the stories' own order; the rows start closed", () => {
    const g = list("feature");
    expect(g.rows.map((r) => [r.item.id, r.depth])).toEqual([[11, 0], [103, 1], [104, 1], [12, 0], [102, 1], [13, 0], [101, 1]]);
    // Children carry no rank number.
    expect(g.rows.filter((r) => r.depth > 0).every((r) => r.rank === null)).toBe(true);
    expect(gantt("feature")).toEqual([11, 12, 13]);
    expect(gantt("feature", { level: "feature", rows: { "Northwind:11": true } })).toEqual([11, 103, 104, 12, 13]);
  });
  it("Epics with Expand all gives the same rows as the old tree for the same data", () => {
    const old = visible(tree(groups(load, all, { stories: true })[0]!.rows), expandAll("epic")).map((s) => s.node.row.item.id);
    expect(gantt("epic", expandAll("epic"))).toEqual(old);
    expect(ids(list("epic").rows)).toEqual(old);
  });
  it("nothing on the tree is lost: a story under no feature follows the ranked features, an orphan feature follows the epics", () => {
    const more = anAheadLoad([anAheadClient({ items: [...items, story(105, 1, 5), story(106, null, 6), feature(14, null, 0, "2026-11-30")] })]);
    // 14 ranks first among features (order 0), with no epic: still in its place at Features.
    expect(ids(top("feature", {}, more))).toEqual([14, 11, 12, 13, 105, 106]);
    expect(top("feature", {}, more).map((r) => r.rank)).toEqual([1, 2, 3, 4, null, null]);
    // At Epics: the epics, then the feature with no epic, then the story with no parent.
    expect(ids(top("epic", {}, more))).toEqual([1, 2, 14, 106]);
    expect(ids(list("epic", {}, more).rows).sort()).toEqual(ids(groups(more, all, { stories: true })[0]!.rows).sort());
  });
});

describe("BL-2: filters and search remove rows, never reorder them", () => {
  it("the Epic filter narrows without reordering, keeping the true rank numbers", () => {
    const r = top("feature", { epic: "Northwind:2" });
    expect(ids(r)).toEqual([11, 12]);
    expect(r.map((x) => x.rank)).toEqual([1, 2]);
    const first = top("feature", { epic: "Northwind:1" });
    expect(ids(first)).toEqual([13]);
    expect(first.map((x) => x.rank)).toEqual([3]);
  });
  it("search keeps the rank numbers; a row kept for what's under it is context", () => {
    const r = top("feature", { q: "Feature ranked 2" });
    expect(ids(r)).toEqual([12]);
    expect(r[0]!.rank).toBe(2);
    const g = list("feature", { q: "Story ranked 4" });
    expect(g.rows.map((x) => [x.item.id, x.depth, x.context])).toEqual([[11, 0, true], [104, 1, false]]);
    expect(listCount(g)).toBe(0);
  });
  it("an item whose parent is filtered out keeps its place", () => {
    // Mine: only 12 and its story are mine; the epic above 12 isn't.
    const me = { name: "Alex Rivera", email: "you@cooptimize.example" };
    const mineLoad = anAheadLoad([anAheadClient({ items: items.map((i) => (i.id === 12 || i.id === 13 ? { ...i, assignee: me } : i)) })]);
    expect(ids(top("feature", { owner: { Northwind: "mine" } }, mineLoad))).toEqual([12, 13]);
    expect(top("feature", { owner: { Northwind: "mine" } }, mineLoad).map((r) => r.rank)).toEqual([2, 3]);
  });
  it("closed items keep their place without a rank number; the ranks count only open items", () => {
    const done = anAheadLoad([anAheadClient({ items: items.map((i) => (i.id === 11 ? { ...i, state: "Closed", stateCategory: "Completed" } : i)) })]);
    expect(top("feature", {}, done).map((r) => [r.item.id, r.rank])).toEqual([[11, null], [12, 1], [13, 2]]);
  });
  it("every client is its own group; the client filter keeps the ones chosen", () => {
    const two = anAheadLoad([anAheadClient({ items }), anAheadClient({ clientKey: "Harbor", clientName: "Harbor Health", items: [feature(900, null, 1, "2026-11-20")] })]);
    const gs = listGroups(two, { ...all, owner: { Northwind: "all", Harbor: "all" } }, { level: "feature" });
    expect(gs.map((g) => [g.client.clientKey, ids(g.rows.filter((r) => r.depth === 0))])).toEqual([["Northwind", [11, 12, 13]], ["Harbor", [900]]]);
    expect(listGroups(two, { ...all, clients: ["Harbor"], owner: { Harbor: "all" } }, { level: "feature" }).map((g) => g.client.clientKey)).toEqual(["Harbor"]);
  });
});
