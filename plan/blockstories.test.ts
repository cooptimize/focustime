import { DEFAULT_SIZE_SCALE } from "./estimate.ts";
import { describe, expect, it } from "vitest";
import { blockLabel, blockStories, cardGroups, groupLine, isChildLevel } from "./blockstories.ts";
import { aClientWork, aFeature, aPick, aWeekFeature, aWorkItem, TYPE_LOOKS, WEEK } from "../test/builders/index.ts";

const at = { weekStart: WEEK, date: WEEK, half: "AM" as const };
const titles = (gs: ReturnType<typeof blockStories>) => gs.map((g) => [g.feature?.id ?? null, g.stories.map((s) => s.item.id)]);

describe("blockStories (PV-1)", () => {
  it("lists only child-level items assigned to me, grouped by parent; features and epics only as headers", () => {
    const epic = aWorkItem({ id: 1, type: "Epic", level: "portfolio", tier: "epic" });
    const f = aFeature({ id: 10, parentId: 1 });
    const mine = aWorkItem({ id: 100, parentId: 10 });
    const bug = aWorkItem({ id: 101, parentId: 10, type: "Bug" });
    const task = aWorkItem({ id: 102, parentId: 100, type: "Task" });
    const theirs = aWorkItem({ id: 103, parentId: 10, assignedToMe: false, assignedTo: "Sam" });
    const gs = blockStories({ sizes: DEFAULT_SIZE_SCALE, ...at, work: aClientWork({ items: [epic, f, mine, bug, task], children: [theirs] }), list: [], picks: [] });
    expect(titles(gs)).toEqual([[10, [100, 101]]]);
    // A group with my stories doesn't list teammates' ones.
    expect(gs[0]!.others).toEqual([]);
    expect(gs.flatMap((g) => g.stories.map((s) => s.item.level))).toEqual(["story", "story"]);
  });

  it("ranks committed features in plan order, then others in backlog order; stories in backlog order; No feature last", () => {
    const fa = aFeature({ id: 10, order: 5 });
    const fb = aFeature({ id: 11, order: 1 });
    const fc = aFeature({ id: 12, order: 3 });
    const fd = aFeature({ id: 13, order: 2 });
    const s = (id: number, parentId: number | null, order: number | null) => aWorkItem({ id, parentId, order });
    const work = aClientWork({ items: [fa, fb, fc, fd, s(200, 12, 9), s(201, 12, 2), s(202, 10, 1), s(203, 11, null), s(204, null, 1), s(205, 13, 1), s(206, 11, 4)] });
    // The plan: fa placed first by hand, then fc (must, by rank); fd is a nice to have.
    const list = [aWeekFeature({ itemId: 12 }), aWeekFeature({ itemId: 10, position: 1 }), aWeekFeature({ itemId: 13, tier: "nice" })];
    const gs = blockStories({ sizes: DEFAULT_SIZE_SCALE, ...at, work, list, picks: [] });
    expect(titles(gs)).toEqual([
      [10, [202]],
      [12, [201, 200]],
      [13, [205]],
      [11, [206, 203]],
      [null, [204]],
    ]);
    expect(gs.map((g) => g.committed)).toEqual([true, true, true, false, false]);
  });

  it("marks stories planned elsewhere this week (kept, not hidden) and the ones in this block", () => {
    const f = aFeature({ id: 10 });
    const here = aWorkItem({ id: 100, parentId: 10 });
    const there = aWorkItem({ id: 101, parentId: 10 });
    const picks = [aPick({ id: 1, itemId: 100, size: "L" }), aPick({ id: 2, itemId: 101, date: "2026-11-05", half: "AM" }), aPick({ id: 3, itemId: 101, date: "2026-11-04", half: "PM", size: "S" })];
    const [g] = blockStories({ sizes: DEFAULT_SIZE_SCALE, ...at, work: aClientWork({ items: [f, here, there] }), list: [], picks });
    expect(g!.stories.map((r) => [r.item.id, r.here?.pickId ?? null, r.elsewhere?.pickId ?? null, r.size])).toEqual([
      [100, 1, null, "L"],
      [101, null, 3, "S"],
    ]);
    expect(blockLabel(g!.stories[1]!.elsewhere!)).toBe("Wed PM");
    expect(groupLine(g!)).toBe("2 stories · about 5h");
  });

  it("leaves out resolved and closed stories (state categories from the process)", () => {
    const f = aFeature({ id: 10 });
    const items = [f, aWorkItem({ id: 100, parentId: 10, stateCategory: "Resolved" }), aWorkItem({ id: 101, parentId: 10, stateCategory: "Completed" }), aWorkItem({ id: 102, parentId: 10, stateCategory: "Proposed" })];
    expect(titles(blockStories({ sizes: DEFAULT_SIZE_SCALE, ...at, work: aClientWork({ items }), list: [], picks: [] }))).toEqual([[10, [102]]]);
  });

  it("shows a committed feature with no stories of mine, with teammates' open stories", () => {
    const f = aFeature({ id: 10, assignedToMe: false });
    const theirs = aWorkItem({ id: 103, parentId: 10, assignedToMe: false, assignedTo: "Sam", assignedToEmail: "sam@contoso.example" });
    const closed = aWorkItem({ id: 104, parentId: 10, assignedToMe: false, stateCategory: "Completed" });
    const [g] = blockStories({ sizes: DEFAULT_SIZE_SCALE, ...at, work: aClientWork({ committed: [f], children: [theirs, closed] }), list: [aWeekFeature({ itemId: 10 })], picks: [] });
    expect(g!.committed).toBe(true);
    expect(g!.stories).toEqual([]);
    expect(g!.others.map((o) => o.id)).toEqual([103]);
  });

  it("groups a story under a parent read by id; another client's list and weeks don't count", () => {
    const f = aFeature({ id: 10, assignedToMe: false });
    const work = aClientWork({ items: [aWorkItem({ id: 100, parentId: 10 })], parents: [f] });
    const gs = blockStories({ sizes: DEFAULT_SIZE_SCALE, ...at, work, list: [aWeekFeature({ itemId: 10, clientKey: "fabrikam" }), aWeekFeature({ itemId: 10, weekStart: "2026-11-09" })], picks: [] });
    expect(titles(gs)).toEqual([[10, [100]]]);
    expect(gs[0]!.committed).toBe(false);
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
