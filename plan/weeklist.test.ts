import { DEFAULT_SIZE_SCALE } from "./estimate.ts";
import { describe, expect, it } from "vitest";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { devopsStateFrom, headsUpKey, pickDoneFrom, weekList, itemDone, otherStoriesLine, orderList, stackRank, validHours, type ListItem } from "./weeklist.ts";

const item = (o: Partial<ListItem> & { itemId: number }): ListItem => ({ clientKey: "Adatum", level: "feature", estimate: 240, position: null, doneAt: null, slots: [], createdAt: "2026-11-05T10:00:00-05:00[America/New_York]", ...o });
const wi = (id: number, stateCategory = "InProgress"): WorkItem => ({ id, title: `#${id}`, type: "User Story", state: "x", stateCategory, level: "story", order: id, parentId: null, changedAt: "2026-11-01T00:00:00Z", url: "" });
const work = (o: Partial<ClientWork> = {}): ClientWork => ({ clientKey: "Adatum", clientName: "Adatum", status: "ok", fetchedAt: "x", fromCache: false, items: [], children: [], ...o });

describe("order (CF-1: backlog order, no tiers)", () => {
  it("lists in DevOps stack rank, unknown rank last; an old hand-set position no longer moves anything", () => {
    const rank = (_: string, id: number) => ({ 30: 0, 10: 1, 20: 2 })[id] ?? null;
    const list = [item({ itemId: 10 }), item({ itemId: 20 }), item({ itemId: 30 }), item({ itemId: 99 })];
    expect(orderList(list, rank).map((i) => i.itemId)).toEqual([30, 10, 20, 99]);
    const moved = [item({ itemId: 10, position: 1 }), item({ itemId: 99, position: 2 }), item({ itemId: 30 }), item({ itemId: 20 })];
    expect(orderList(moved, rank).map((i) => i.itemId)).toEqual([30, 10, 20, 99]);
  });
  it("keeps clients apart and in the order they come", () => {
    const list = [item({ itemId: 1, clientKey: "T&W" }), item({ itemId: 2 }), item({ itemId: 3, clientKey: "T&W" }), item({ itemId: 4, clientKey: "T&W" })];
    expect(orderList(list, () => null).map((i) => i.itemId)).toEqual([1, 3, 4, 2]);
  });
  it("stack rank comes from the portfolio's and the work read's board order", () => {
    const r = stackRank([work({ items: [wi(7), wi(5)], children: [wi(9)] })], [{ clientKey: "Adatum", items: [{ id: 40, order: 3 }, { id: 41, order: 1 }] }]);
    expect([40, 41, 7, 5, 9].map((id) => r("Adatum", id))).toEqual([0, 1, 1_000_000, 1_000_001, 1_000_002]);
    expect(r("Adatum", 1)).toBeNull();
  });
  it("an estimate is whole hours, 1 to 80 (E2)", () => {
    expect([1, 6, 80].every(validHours)).toBe(true);
    expect([0, 0.5, 1.5, 81, Number.NaN, "1"].some(validHours)).toBe(false);
  });
});

describe("done against the current plan", () => {
  const devops = devopsStateFrom([work({ items: [wi(1)], watched: [wi(2, "Completed"), wi(3, "Removed")] })]);
  it("reads DevOps state from fresh results only", () => {
    expect([1, 2, 3, 4].map((id) => devops("Adatum", id))).toEqual(["open", "done", "removed", null]);
    expect(devopsStateFrom([work({ fromCache: true, watched: [wi(2, "Completed")] })])("Adatum", 2)).toBeNull();
    expect(devopsStateFrom([work({ status: "unreachable" })])("Adatum", 1)).toBeNull();
  });
  it("done is a local mark, DevOps Completed, or a story's pick ticked done", () => {
    const noPick = () => false;
    expect(itemDone(item({ itemId: 1, doneAt: "x" }), devops, noPick)).toBe("local");
    expect(itemDone(item({ itemId: 2 }), devops, noPick)).toBe("devops");
    expect(itemDone(item({ itemId: 5, level: "story" }), devops, () => true)).toBe("pick");
    expect(itemDone(item({ itemId: 5, level: "feature" }), devops, () => true)).toBeNull(); // a feature isn't done by one pick
    expect(itemDone(item({ itemId: 1 }), devops, noPick)).toBeNull();
  });
});

describe("an old week heads-up (CF-1 makes none)", () => {
  it("is still found by its key: one per week, client and item", () => {
    expect(headsUpKey("2026-11-09", "Adatum", 210)).toBe("slip:week:2026-11-09:Adatum:210");
  });
});

describe("weekList (every view's order, done and progress)", () => {
  it("orders by stack rank and marks done from DevOps, a local mark or a done pick", () => {
    const wi = (id: number, stateCategory = "InProgress", level: WorkItem["level"] = "story"): WorkItem => ({ id, title: `#${id}`, type: "User Story", state: "Active", stateCategory, level, order: null, parentId: null, changedAt: "x", url: "u" });
    const work: ClientWork[] = [{ clientKey: "Adatum", clientName: "Adatum", status: "ok", fetchedAt: "x", fromCache: false, items: [wi(3), wi(1)], children: [], watched: [wi(2, "Completed")], committed: [] }];
    const f = [item({ itemId: 1, level: "story" }), item({ itemId: 2, level: "story" }), item({ itemId: 3, level: "story" }), item({ itemId: 4, level: "story", doneAt: "x" }), item({ itemId: 5, level: "story" })];
    const days = { "2026-11-10": { picks: [{ clientKey: "Adatum", itemId: 5, status: "done" }] } };
    const r = weekList(f, work, DEFAULT_SIZE_SCALE, [], pickDoneFrom(days));
    expect(r.items.map((i) => [i.itemId, i.done])).toEqual([[3, null], [1, null], [2, "devops"], [4, "local"], [5, "pick"]]);
    expect(r).not.toHaveProperty("progress");
  });
});

describe("Resolved counts as done (Q65)", () => {
  it("a Resolved item is done for the week, shown as resolved; an open one isn't", () => {
    const wi = (id: number, stateCategory: string): WorkItem => ({ id, title: `#${id}`, type: "User Story", state: "x", stateCategory, level: "story", order: null, parentId: null, changedAt: "x", url: "u" });
    const work: ClientWork[] = [{ clientKey: "Adatum", clientName: "Adatum", status: "ok", fetchedAt: "x", fromCache: false, items: [wi(1, "Resolved"), wi(2, "InProgress")], children: [], watched: [], committed: [] }];
    const st = devopsStateFrom(work);
    expect([st("Adatum", 1), st("Adatum", 2)]).toEqual(["resolved", "open"]);
    expect(itemDone(item({ itemId: 1, level: "story" }), st, () => false)).toBe("resolved");
    expect(weekList([item({ itemId: 1 }), item({ itemId: 2 })], work, DEFAULT_SIZE_SCALE).items.map((i) => i.done)).toEqual(["resolved", null]);
  });
});


describe("a feature's other stories (E1): one count line, not their titles", () => {
  const c = (id: number, o: Partial<{ level: string; open: boolean; mine: boolean; assignedTo: string | null }> = {}) => ({ id, level: "story", open: true, mine: false, assignedTo: null, ...o });
  it("counts its open stories not on the list, and how many are someone else's", () => {
    const kids = [c(1, { mine: true, assignedTo: "Me" }), c(2, { assignedTo: "Sam" }), c(3, { assignedTo: "Ana" }), c(4), c(5, { mine: true, assignedTo: "Me" }), c(6, { open: false, assignedTo: "Sam" }), c(7, { level: "task" }), c(8)];
    expect(otherStoriesLine(kids, new Set([8]))).toBe("5 more stories · 2 assigned to others");
  });
  it("leaves out the second part when none are someone else's, and says nothing when there are none", () => {
    expect(otherStoriesLine([c(1), c(2, { mine: true, assignedTo: "Me" })], new Set())).toBe("2 more stories");
    expect(otherStoriesLine([c(1)], new Set())).toBe("1 more story");
    expect(otherStoriesLine([c(1)], new Set([1]))).toBeNull();
    expect(otherStoriesLine([], new Set())).toBeNull();
  });
});
