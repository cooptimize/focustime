import { describe, expect, it } from "vitest";
import { atLevel, collapseAll, countText, expandAll, isOpenRow, levelNames, pluralType, rollup, setRow, tree, visible, type Span } from "./gantt-tree.ts";
import type { Tier } from "./ahead-model.ts";

const row = (id: number, tier: Tier, parentId: number | null, type = tier === "epic" ? "Epic" : tier === "feature" ? "Feature" : "User Story") => ({ key: `c:${id}`, tier, item: { id, parentId, type } });
// Epic 1 › features 2, 3 › stories 4, 5 under 2; a feature 6 with no epic; epic 7 with nothing under it.
const rows = [row(1, "epic", null), row(2, "feature", 1), row(4, "story", 2), row(5, "story", 2), row(3, "feature", 1), row(6, "feature", null), row(7, "epic", null)];
const keys = (f: ReturnType<typeof atLevel>) => visible(tree(rows), f).map((s) => s.node.row.item.id);

describe("AH-6: levels", () => {
  it("Epics shows only the top rows, Features opens epics, Stories opens everything", () => {
    expect(keys(atLevel("epic"))).toEqual([1, 6, 7]);
    expect(keys(atLevel("feature"))).toEqual([1, 2, 3, 6, 7]);
    expect(keys(atLevel("story"))).toEqual([1, 2, 4, 5, 3, 6, 7]);
    expect(keys(expandAll())).toEqual(keys(atLevel("story")));
    expect(keys(collapseAll())).toEqual(keys(atLevel("epic")));
  });

  it("carets work on top of a level, and a new level starts them over", () => {
    let f = atLevel("feature");
    f = setRow(f, rows[1]!, true);
    expect(keys(f)).toEqual([1, 2, 4, 5, 3, 6, 7]);
    f = setRow(f, rows[0]!, false);
    expect(keys(f)).toEqual([1, 6, 7]);
    // Setting a row back to what the level says drops the override.
    f = setRow(f, rows[0]!, true);
    expect(f.rows).toEqual({ "c:2": true });
    expect(keys(atLevel("epic"))).toEqual([1, 6, 7]);
    expect(isOpenRow(atLevel("epic"), rows[0]!)).toBe(false);
  });

  it("a caret only where there are children", () => {
    const s = visible(tree(rows), atLevel("story"));
    expect(s.map((x) => [x.node.row.item.id, x.kids, x.open])).toEqual([[1, 2, true], [2, 2, true], [4, 0, false], [5, 0, false], [3, 0, false], [6, 0, false], [7, 0, false]]);
  });

  it("siblings in the given order", () => {
    const start: Record<number, string> = { 2: "2026-12-01", 3: "2026-11-01", 6: "2026-10-01", 1: "2026-11-15", 7: "2026-09-01" };
    const by = (a: (typeof rows)[number], b: (typeof rows)[number]) => (start[a.item.id] ?? "9999").localeCompare(start[b.item.id] ?? "9999");
    expect(visible(tree(rows, by), atLevel("feature")).map((s) => s.node.row.item.id)).toEqual([7, 6, 1, 3, 2]);
  });
});

describe("AH-6: roll-up", () => {
  const spans: Record<number, Span | null> = { 2: { start: "2026-11-02", end: "2026-11-20" }, 3: { start: "2026-11-09", end: "2026-12-18" }, 4: { start: "2026-10-26", end: "2026-11-06" }, 5: null, 6: null };
  const of = (r: { item: { id: number } }) => spans[r.item.id] ?? null;
  it("spans the children's earliest start and latest end", () => {
    const [epic] = tree(rows);
    expect(rollup(epic!, of)).toEqual({ start: "2026-11-02", end: "2026-12-18" });
    expect(rollup(epic!.children[0]!, of)).toEqual({ start: "2026-10-26", end: "2026-11-06" });
  });
  it("a child with no dates counts with its own roll-up; nothing dated under it is null", () => {
    const only = [row(1, "epic", null), row(2, "feature", 1), row(4, "story", 2)];
    expect(rollup(tree(only)[0]!, (r) => (r.item.id === 4 ? { start: "2026-11-02", end: "2026-11-03" } : null))).toEqual({ start: "2026-11-02", end: "2026-11-03" });
    expect(rollup(tree(rows).find((n) => n.row.item.id === 7)!, of)).toBeNull();
  });
});

describe("AH-6: level names from the process", () => {
  it("plural of the most common type at each level; different processes are both named", () => {
    expect(levelNames([{ rows }])).toEqual({ epic: "Epics", feature: "Features", story: "Stories" });
    const scrum = [row(1, "epic", null), row(2, "feature", 1), row(3, "story", 2, "Product Backlog Item"), row(4, "story", 2, "Product Backlog Item"), row(5, "story", 2, "Bug")];
    expect(levelNames([{ rows: scrum }]).story).toBe("Backlog items");
    expect(levelNames([{ rows }, { rows: scrum }]).story).toBe("Stories / Backlog items");
    expect(levelNames([{ rows: [row(1, "epic", null, "Initiative")] }]).epic).toBe("Initiatives");
    expect(pluralType("Requirement")).toBe("Requirements");
    expect(pluralType("Capability")).toBe("Capabilities");
  });
  it("counts in the children's words", () => {
    expect(countText(4, "Features")).toBe("4 features");
    expect(countText(1, "Stories")).toBe("1 story");
    expect(countText(1, "Backlog items")).toBe("1 backlog item");
  });
});
