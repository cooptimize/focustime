// ED-2: the pure rules behind rename, move and bulk edit in Backlog's Grid: the move rule (ED-1's), a staged title and
// parent laid over the list without changing its order, State… over mixed types, and when Move to… fits a selection.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad } from "../test/builders/index.ts";
import { byItem, checkValue, moveProblem, moveTargets, sameValue, valueText, type AheadFilters, type MoveItem, type StagedChange } from "./ahead-edit.ts";
import { DEFAULT_FILTERS } from "./ahead-model.ts";
import { bulkDecide, bulkMoveBlock, bulkSummary, commonStates, type BulkItem } from "./backlog.ts";
import { listOf } from "./backlog-list.ts";

const epic = (id: number, order: number) => anAheadItem({ id, type: "Epic", level: "top", rung: 0, order, title: `Epic ${id}` });
const feature = (id: number, parentId: number | null, order: number, more = {}) => anAheadItem({ id, parentId, order, title: `Feature ${id}`, ...more });
const story = (id: number, parentId: number | null, order: number) => anAheadItem({ id, parentId, order, type: "User Story", level: "child", rung: 2, title: `Story ${id}` });
const items = [epic(1, 1), feature(11, 1, 1), feature(12, 1, 2), feature(13, 1, 3, { state: "Closed", stateCategory: "Completed" }), story(101, 11, 1), story(102, 11, 2), story(103, 12, 3), story(104, 12, 4)];
const change = (itemId: number, field: StagedChange["field"], value: StagedChange["value"], baseValue: StagedChange["baseValue"]): StagedChange => ({ clientKey: "Northwind", itemId, field, value, half: null, baseRev: 3, baseValue, createdAt: "2026-11-14T10:00:00Z", updatedAt: "2026-11-14T10:00:00Z" });
const all: AheadFilters = { ...DEFAULT_FILTERS, owner: { Northwind: "all" } };
const loadWith = (changes: StagedChange[]) => ({ ...anAheadLoad([anAheadClient({ items })]), changes });
const mi = (id: number): MoveItem => {
  const i = items.find((x) => x.id === id)!;
  return { id, type: i.type, title: i.title, state: i.state, rung: i.rung, open: i.stateCategory !== "Completed" };
};

describe("ED-2: the move rule is ED-1's", () => {
  it("only open items exactly one level up, never itself; No parent is fine; the top level has no parent to change", () => {
    expect(moveTargets(items.map((i) => mi(i.id)), mi(101), "Portal").map((x) => x.id)).toEqual([11, 12]);
    expect(moveProblem(mi(101), null, "Portal")).toBeNull();
    expect(moveProblem(mi(101), mi(13), "Portal")).toBe("#13 is Closed; FocusTime moves items only under open parents");
    expect(moveProblem(mi(101), mi(1), "Portal")).toMatch(/^In Portal's process, Epic isn't the level above /);
    expect(moveProblem(mi(101), mi(102), "Portal")).toMatch(/isn't the level above/);
    // A feature under its own story (a loop) is a wrong level, like every loop.
    expect(moveProblem(mi(11), mi(101), "Portal")).toMatch(/isn't the level above/);
    expect(moveProblem(mi(11), mi(11), "Portal")).toBe("An item can't be its own parent");
    expect(moveProblem(mi(1), mi(11), "Portal")).toMatch(/is the top level, so it has no parent to change/);
    expect(moveProblem({ ...mi(101), rung: null }, mi(11), "Portal")).toMatch(/isn't a level/);
  });
  it("values: a title by its words, a parent by its id; checked the way ED-1's are", () => {
    expect(sameValue("title", "Fix  the typo ", "Fix the typo")).toBe(true);
    expect(sameValue("title", "fix the typo", "Fix the typo")).toBe(false);
    expect(sameValue("parent", { id: 11, title: "a" }, { id: 11, title: "b" })).toBe(true);
    expect(sameValue("parent", null, { id: 11, title: "" })).toBe(false);
    expect(sameValue("parent", null, null)).toBe(true);
    expect(checkValue("title", "  Two   spaces ")).toBe("Two spaces");
    expect(() => checkValue("title", "")).toThrow("Type a title");
    expect(() => checkValue("title", "x".repeat(256))).toThrow(/at most 255/);
    expect(checkValue("parent", { id: 11, title: " Import " })).toEqual({ id: 11, title: "Import" });
    expect(checkValue("parent", null)).toBeNull();
    expect(() => checkValue("parent", { id: -1 })).toThrow();
    expect(() => checkValue("parent", 11)).toThrow();
    expect(valueText("parent", { id: 11, title: "Import" })).toBe("#11 Import");
    expect(valueText("parent", null)).toBe("No parent");
    expect(valueText("title", "New words")).toBe("New words");
    // In the review an item's title and parent come first.
    expect(byItem([change(101, "size", 3, null), change(101, "parent", null, { id: 11, title: "" }), change(101, "title", "x", "y")])[0]!.changes.map((c) => c.field)).toEqual(["title", "parent", "size"]);
  });
});

describe("ED-2: a staged rename and move on the list", () => {
  const rows = (changes: StagedChange[], level: "story" | "feature") => listOf(loadWith(changes), loadWith(changes).clients[0]!, all, { level }).rows;
  it("a moved story keeps its rank and its place; its parent label is the new parent; DevOps's values are kept beside", () => {
    const before = rows([], "story");
    const after = rows([change(101, "parent", { id: 12, title: "Feature 12" }, { id: 11, title: "Feature 11" }), change(102, "title", "Renamed", "Story 102")], "story");
    expect(after.map((r) => [r.item.id, r.rank])).toEqual(before.map((r) => [r.item.id, r.rank]));
    expect(after.map((r) => [r.item.id, r.rank])).toEqual([[101, 1], [102, 2], [103, 3], [104, 4]]);
    expect(after[0]!.parent).toMatchObject({ id: 12, title: "Feature 12" });
    expect(after[0]!.saved).toEqual({ title: "Story 101", parentId: 11 });
    expect(after[1]!.item.title).toBe("Renamed");
    expect(after[1]!.saved).toEqual({ title: "Story 102", parentId: 11 });
    expect(after[2]!.saved).toBeUndefined();
  });
  it("opened under features, the moved story shows under its new parent, in that level's order", () => {
    const after = rows([change(101, "parent", { id: 12, title: "Feature 12" }, { id: 11, title: "Feature 11" })], "feature");
    expect(after.map((r) => `${r.depth}:${r.item.id}`)).toEqual(["0:11", "1:102", "0:12", "1:101", "1:103", "1:104", "0:13"]);
    // The features themselves didn't move.
    expect(after.filter((r) => r.depth === 0).map((r) => r.rank)).toEqual([1, 2, null]);
  });
  it("moved to No parent it is listed after the ranked rows as not under any feature; a parent not among the items leaves it where it is", () => {
    const none = rows([change(101, "parent", null, { id: 11, title: "Feature 11" })], "feature");
    expect(none.at(-1)).toMatchObject({ depth: 0, item: { id: 101, parentId: null } });
    const gone = rows([change(101, "parent", { id: 999, title: "?" }, { id: 11, title: "Feature 11" })], "feature");
    expect(gone.find((r) => r.item.id === 101)).toMatchObject({ depth: 1, item: { parentId: 11 } });
  });
});

describe("ED-2: bulk", () => {
  const base: BulkItem = { id: 1, type: "User Story", editable: true, note: "", hasTarget: false, target: null, mine: false, assignee: null, state: "New", states: ["New", "Active", "Closed"], hasSize: true, size: null, parentId: 11, moveProblem: null };
  it("each new action decides per item", () => {
    expect(bulkDecide({ ...base, editable: false, note: "Only leads" }, { kind: "size", value: 3 }, "Portal")).toEqual({ ok: false, reason: "Only leads" });
    expect(bulkDecide(base, { kind: "assign", email: "dana@cooptimize.example", name: "Dana" }, "Portal")).toEqual({ ok: true, step: { field: "assignee", value: { email: "dana@cooptimize.example", name: "Dana" } } });
    expect(bulkDecide({ ...base, assignee: "Dana@cooptimize.example" }, { kind: "assign", email: "dana@cooptimize.example", name: "Dana" }, "Portal")).toEqual({ ok: false, reason: "Already assigned to Dana" });
    expect(bulkDecide(base, { kind: "assign", email: null, name: "Nobody" }, "Portal")).toEqual({ ok: false, reason: "Already unassigned" });
    expect(bulkDecide(base, { kind: "state", state: "active" }, "Portal")).toEqual({ ok: true, step: { field: "state", value: "Active" } });
    expect(bulkDecide(base, { kind: "state", state: "Done" }, "Portal")).toEqual({ ok: false, reason: "Done isn't a state of User Story in Portal's process" });
    expect(bulkDecide({ ...base, hasSize: false }, { kind: "size", value: 3 }, "Portal")).toEqual({ ok: false, reason: "User Story has no size in Portal's process" });
    expect(bulkDecide({ ...base, size: 3 }, { kind: "size", value: 3 }, "Portal")).toEqual({ ok: false, reason: "Already that size" });
    expect(bulkDecide(base, { kind: "parent", parentId: 12, title: "x" }, "Portal")).toEqual({ ok: true, step: { field: "parent", value: 12 } });
    expect(bulkDecide(base, { kind: "parent", parentId: 11, title: "x" }, "Portal")).toEqual({ ok: false, reason: "Already under it" });
    expect(bulkDecide({ ...base, moveProblem: "No." }, { kind: "parent", parentId: 12, title: "x" }, "Portal")).toEqual({ ok: false, reason: "No." });
  });
  it("the line after says Staged N, skipped M and that nothing is written", () => {
    expect(bulkSummary({ kind: "assign", email: "d@x.example", name: "Dana Reyes" }, 3, 2)).toBe("Assign to Dana Reyes: staged 3, skipped 2. Nothing is written until you save.");
    expect(bulkSummary({ kind: "parent", parentId: 12, title: "Loyalty" }, 2, 0)).toBe("Move under Loyalty: staged 2, skipped 0. Nothing is written until you save.");
    // The four older actions keep their words.
    expect(bulkSummary({ kind: "push", weeks: 2 }, 3, 1)).toBe("3 target dates pushed by 2 weeks, ready to save · 1 skipped");
  });
  it("State… on mixed types: the states every row's type takes, and the rest with the types they fit", () => {
    const rows = [{ type: "User Story", states: ["New", "Active", "Closed"] }, { type: "User Story", states: ["New", "Active", "Closed"] }, { type: "Bug", states: ["New", "Active", "Resolved", "Closed"] }, { type: "Feature", states: ["New", "Active", "Done"] }];
    expect(commonStates(rows)).toEqual({ common: ["New", "Active"], partial: [{ state: "Closed", types: ["User Story", "Bug"], fits: 3 }, { state: "Resolved", types: ["Bug"], fits: 1 }, { state: "Done", types: ["Feature"], fits: 1 }] });
    expect(commonStates(rows.slice(0, 2))).toEqual({ common: ["New", "Active", "Closed"], partial: [] });
  });
  it("Move to… needs one level in one client, and says why otherwise", () => {
    expect(bulkMoveBlock([{ clientKey: "A", rung: 2 }, { clientKey: "A", rung: 2 }])).toBeNull();
    expect(bulkMoveBlock([{ clientKey: "A", rung: 2 }, { clientKey: "B", rung: 2 }])).toMatch(/one client/);
    expect(bulkMoveBlock([{ clientKey: "A", rung: 2 }, { clientKey: "A", rung: 1 }])).toMatch(/one level/);
    expect(bulkMoveBlock([{ clientKey: "A", rung: 0 }])).toMatch(/no level above/);
  });
});

describe("UC-2: the move rule's words need no article before a type's name", () => {
  const at = (id: number, type: string, rung: number) => ({ id, type, title: `#${id}`, state: "Active", rung, open: true });
  it("reads right for the demo's types and for a made-up type starting with a vowel", () => {
    const said = [
      moveProblem(at(1, "Epic", 0), null, "Portal"),
      moveProblem(at(2, "User Story", 2), at(3, "Epic", 0), "Portal"),
      moveProblem(at(4, "Feature", 1), at(5, "User Story", 2), "Portal"),
      moveProblem(at(6, "Item of work", 2), at(7, "Objective", 0), "Portal"),
      moveProblem(at(8, "Objective", 0), null, "Portal"),
    ];
    expect(said).toEqual([
      "In Portal's process, Epic is the top level, so it has no parent to change",
      "In Portal's process, Epic isn't the level above User Story",
      "In Portal's process, User Story isn't the level above Feature",
      "In Portal's process, Objective isn't the level above Item of work",
      "In Portal's process, Objective is the top level, so it has no parent to change",
    ]);
    for (const s of said) expect(s).not.toMatch(/\b(a|an|An|A) [A-Z]/);
  });
});
