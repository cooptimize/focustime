import { describe, expect, it } from "vitest";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { freeLeft, devopsStateFrom, headsUpKey, pickDoneFrom, weekHeadsUpDraft, weekList, itemDone, moveWithin, offersHeadsUp, onTrack, otherStoriesLine, orderList, progress, progressLabel, stackRank, validHours, type ListItem } from "./weeklist.ts";

const item = (o: Partial<ListItem> & { itemId: number }): ListItem => ({ clientKey: "Adatum", level: "feature", tier: "must", estimate: 240, position: null, doneAt: null, slots: [], createdAt: "2026-11-05T10:00:00-05:00[America/New_York]", ...o });
const wi = (id: number, stateCategory = "InProgress"): WorkItem => ({ id, title: `#${id}`, type: "User Story", state: "x", stateCategory, level: "story", order: id, parentId: null, changedAt: "2026-11-01T00:00:00Z", url: "" });
const work = (o: Partial<ClientWork> = {}): ClientWork => ({ clientKey: "Adatum", clientName: "Adatum", status: "ok", fetchedAt: "x", fromCache: false, items: [], children: [], ...o });

describe("tiers and order", () => {
  it("musts come before nice-to-haves, in DevOps stack rank unless placed by hand", () => {
    const rank = (_: string, id: number) => ({ 30: 0, 10: 1, 20: 2 })[id] ?? null;
    const list = [item({ itemId: 10 }), item({ itemId: 20, tier: "nice" }), item({ itemId: 30 }), item({ itemId: 99 })];
    expect(orderList(list, rank).map((i) => i.itemId)).toEqual([30, 10, 99, 20]); // unknown rank last in its tier
    const moved = [item({ itemId: 10, position: 1 }), item({ itemId: 30, position: 2 }), item({ itemId: 99 }), item({ itemId: 20, tier: "nice" })];
    expect(orderList(moved, rank).map((i) => i.itemId)).toEqual([10, 30, 99, 20]); // placed by hand first, the rest by rank
  });
  it("keeps clients apart and in the order they come", () => {
    const list = [item({ itemId: 1, clientKey: "T&W" }), item({ itemId: 2 }), item({ itemId: 3, clientKey: "T&W", tier: "nice" }), item({ itemId: 4, clientKey: "T&W" })];
    expect(orderList(list, () => null).map((i) => i.itemId)).toEqual([1, 4, 3, 2]);
  });
  it("moving one item renumbers the whole group", () => {
    expect(moveWithin([30, 10, 99], 99, 0)).toEqual([{ itemId: 99, position: 1 }, { itemId: 30, position: 2 }, { itemId: 10, position: 3 }]);
    expect(moveWithin([30, 10, 99], 30, 9).map((x) => x.itemId)).toEqual([10, 99, 30]);
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

describe("done and progress against the current plan", () => {
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
  it("counts musts done of musts on the list now, and the minutes the open ones need", () => {
    const list = [item({ itemId: 1, doneAt: "x" }), item({ itemId: 2, estimate: 480 }), item({ itemId: 3, estimate: 120 }), item({ itemId: 4, tier: "nice" }), item({ itemId: 5, clientKey: "T&W" })];
    const p = progress(list, (i) => !!i.doneAt);
    expect(p).toEqual([
      { clientKey: "Adatum", musts: 3, done: 1, left: 2, leftMinutes: 600, nice: 1 },
      { clientKey: "T&W", musts: 1, done: 0, left: 1, leftMinutes: 240, nice: 0 },
    ]);
    expect(progressLabel(p[0]!)).toBe("1 of 3 musts done");
    // A must swapped out no longer counts: progress follows the current plan.
    expect(progress(list.filter((i) => i.itemId !== 2), (i) => !!i.doneAt)[0]).toMatchObject({ musts: 2, done: 1 });
  });
});

describe("the midweek question", () => {
  const blk = (date: string, half: "AM" | "PM", free = 210) => ({ start: `${date}T${half === "AM" ? "09:00" : "12:30"}:00-05:00`, end: `${date}T${half === "AM" ? "12:30" : "17:00"}:00-05:00`, freeMinutes: free, totalMinutes: half === "AM" ? 210 : 270, pto: false });
  it("counts the free time still ahead: no days off, what is free after meetings, the share of the one under way", () => {
    const blocks = [blk("2026-11-09", "AM"), blk("2026-11-10", "PM", 270), blk("2026-11-11", "AM", 105), { ...blk("2026-11-12", "AM"), pto: true }];
    expect(freeLeft(blocks, "2026-11-08T12:00:00Z")).toBe(210 + 270 + 105);
    expect(freeLeft(blocks, "2026-11-09T15:45:00Z")).toBe(105 + 270 + 105); // Mon 10:45, half the morning left
    expect(freeLeft(blocks, "2026-11-12T12:00:00Z")).toBe(0);
  });
  it("asks, never alarms, in hours", () => {
    expect(onTrack({ musts: 4, left: 3, leftMinutes: 720 }, 420)).toEqual({ kind: "at_risk", text: "3 musts left, about 7h free left. Still realistic?" });
    expect(onTrack({ musts: 4, left: 1, leftMinutes: 240 }, 240)).toEqual({ kind: "on_track", text: "1 must left, about 4h free left. Looks doable." });
    expect(onTrack({ musts: 2, left: 2, leftMinutes: 240 }, 0)).toEqual({ kind: "at_risk", text: "2 musts left, no free time left. Still realistic?" });
    expect(onTrack({ musts: 2, left: 0, leftMinutes: 0 }, 60).kind).toBe("done");
    expect(onTrack({ musts: 0, left: 0, leftMinutes: 0 }, 180).kind).toBe("none");
    expect(onTrack({ musts: 2, left: 2, leftMinutes: 300 }, 240).kind).toBe("at_risk");
  });
});

describe("heads-up on a dropped must", () => {
  const committed = "2026-11-06T14:00:00-05:00[America/New_York]";
  it("is offered only for a must that was on the list when the week was committed", () => {
    expect(offersHeadsUp(item({ itemId: 1 }), committed)).toBe(true);
    expect(offersHeadsUp(item({ itemId: 1, tier: "nice" }), committed)).toBe(false);
    expect(offersHeadsUp(item({ itemId: 1, createdAt: "2026-11-07T09:00:00-05:00[America/New_York]" }), committed)).toBe(false); // added after
    expect(offersHeadsUp(item({ itemId: 1 }), null)).toBe(false);
  });
});

describe("heads-up for a dropped must", () => {
  it("is one follow-up per week, client and item, with a plain draft", () => {
    expect(headsUpKey("2026-11-09", "Adatum", 210)).toBe("slip:week:2026-11-09:Adatum:210");
    expect(weekHeadsUpDraft("Adatum Steel", "2026-11-09", { itemId: 210, title: "Export" })).toBe("Hi Adatum Steel, a quick heads-up: #210 Export won't be finished the week of Mon, Nov 9 as I planned.\nI'll let you know where it lands.");
  });
});

describe("weekList (every view's order, done and progress)", () => {
  it("orders by tier, local position then stack rank, marks done from DevOps, a local mark or a done pick, and counts progress", () => {
    const wi = (id: number, stateCategory = "InProgress", level: WorkItem["level"] = "story"): WorkItem => ({ id, title: `#${id}`, type: "User Story", state: "Active", stateCategory, level, order: null, parentId: null, changedAt: "x", url: "u" });
    const work: ClientWork[] = [{ clientKey: "Adatum", clientName: "Adatum", status: "ok", fetchedAt: "x", fromCache: false, items: [wi(3), wi(1)], children: [], watched: [wi(2, "Completed")], committed: [] }];
    const f = [item({ itemId: 1, level: "story" }), item({ itemId: 2, level: "story" }), item({ itemId: 3, level: "story", tier: "nice" }), item({ itemId: 4, level: "story", doneAt: "x" }), item({ itemId: 5, level: "story" })];
    const days = { "2026-11-10": { picks: [{ clientKey: "Adatum", itemId: 5, status: "done" }] } };
    const r = weekList(f, work, [], pickDoneFrom(days));
    expect(r.items.map((i) => [i.itemId, i.done])).toEqual([[1, null], [2, "devops"], [4, "local"], [5, "pick"], [3, null]]);
    expect(r.progress).toEqual([{ clientKey: "Adatum", musts: 4, done: 3, left: 1, leftMinutes: 120, nice: 1 }]);
  });
});

describe("progress with features as envelopes (step 16.4)", () => {
  it("a story under a listed feature is part of it: not its own must, its done size counts toward the feature (its load comes from it)", () => {
    const list = [item({ itemId: 1, estimate: 480 }), item({ itemId: 2, level: "story", estimate: null, size: "L", parentId: 1, doneAt: "x" }), item({ itemId: 3, level: "story", estimate: null, size: "M", parentId: null })];
    expect(progress(list, (i) => !!i.doneAt)).toEqual([{ clientKey: "Adatum", musts: 2, done: 0, left: 2, leftMinutes: 120, nice: 0 }]);
  });
});

describe("Resolved counts as done (Q65)", () => {
  it("a Resolved item is done for the week, shown as resolved; an open one isn't", () => {
    const wi = (id: number, stateCategory: string): WorkItem => ({ id, title: `#${id}`, type: "User Story", state: "x", stateCategory, level: "story", order: null, parentId: null, changedAt: "x", url: "u" });
    const work: ClientWork[] = [{ clientKey: "Adatum", clientName: "Adatum", status: "ok", fetchedAt: "x", fromCache: false, items: [wi(1, "Resolved"), wi(2, "InProgress")], children: [], watched: [], committed: [] }];
    const st = devopsStateFrom(work);
    expect([st("Adatum", 1), st("Adatum", 2)]).toEqual(["resolved", "open"]);
    expect(itemDone(item({ itemId: 1, level: "story" }), st, () => false)).toBe("resolved");
    expect(weekList([item({ itemId: 1 }), item({ itemId: 2 })], work).progress[0]).toMatchObject({ musts: 2, done: 1 });
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
