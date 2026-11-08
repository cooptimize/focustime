// AH-7: Readiness you can finish, pure: Start here's urgency rule, the counts by kind, Skip's 2 weeks, and progress.
import { describe, expect, it } from "vitest";
import type { FixEntry } from "./fixnext.ts";
import { addFixed, dropFixed, fills, fixedSince, kindCounts, liveSkips, progressText, readFixed, skipEnds, START_RULE, startHere, toggleKind, type Urgent } from "./readiness.ts";

const e = (itemId: number, gaps: FixEntry["gaps"] = ["no_dates"], clientKey = "a"): FixEntry => ({ key: `${clientKey}:${itemId}`, clientKey, itemId, gaps, action: gaps[0]!, why: ["top"] });
const u = (itemId: number, o: Partial<Omit<Urgent, "entry">> = {}, clientKey = "a"): Urgent => ({ entry: e(itemId, ["no_dates"], clientKey), rank: 0, date: null, mine: false, ...o });

describe("AH-7: Start here", () => {
  it("dated soonest (overdue first, undated last), then nearest the top of its backlog, then mine, then id; five at most", () => {
    const xs = [
      u(1, { rank: 0 }),
      u(2, { date: "2026-11-20", rank: 5 }),
      u(3, { date: "2026-10-30", rank: 9 }), // overdue: soonest of all
      u(4, { date: "2026-11-20", rank: 1 }),
      u(5, { rank: 0, mine: true }, "b"),
      u(6, { rank: 3 }),
      u(7, { rank: 0 }, "b"),
    ];
    expect(startHere(xs).map((x) => x.itemId)).toEqual([3, 4, 2, 5, 1]);
    expect(startHere(xs, 7).map((x) => x.itemId)).toEqual([3, 4, 2, 5, 1, 7, 6]);
    expect(startHere([])).toEqual([]);
    expect(START_RULE).toBe("Dated soonest first (target, else start; undated last), then nearest the top of its backlog, then yours.");
  });
});

describe("AH-7: the counts by kind", () => {
  it("an entry with two kinds counts in both; a count clicked is that kind alone, clicked again clears", () => {
    expect(kindCounts([e(1, ["needs_stories", "no_dates"]), e(2, ["no_dates"]), e(3, ["unsized"])])).toEqual({ needs_stories: 1, no_dates: 2, unassigned: 0, unsized: 1 });
    expect(toggleKind([], "unsized")).toEqual(["unsized"]);
    expect(toggleKind(["unsized"], "unsized")).toEqual([]);
    expect(toggleKind(["unsized", "no_dates"], "unsized")).toEqual(["unsized"]);
    expect(toggleKind(undefined, "no_dates")).toEqual(["no_dates"]);
  });
});

describe("AH-7: skips last 2 weeks", () => {
  it("one from Oct 19 is gone on Nov 2; Oct 20 and today stay; anything unreadable or from the future is dropped", () => {
    expect(liveSkips({ "a:1": "2026-10-19", "a:2": "2026-10-20", "a:3": "2026-11-02", "a:4": "2026-11-09", "a:5": 7, bad: "2026-11-01" }, "2026-11-02")).toEqual({ "a:2": "2026-10-20", "a:3": "2026-11-02" });
    expect(liveSkips(null, "2026-11-02")).toEqual({});
    expect(liveSkips(["a:1"], "2026-11-02")).toEqual({});
    expect(skipEnds("2026-11-02")).toBe("2026-11-16");
  });
});

describe("AH-7: progress", () => {
  it("a fix is a field going from empty to set (a start alone isn't one); counted once per item and kind, since Monday", () => {
    expect(fills("target", null, "2026-12-11")).toBe("no_dates");
    expect(fills("assignee", null, "Dana <d@example.com>")).toBe("unassigned");
    expect(fills("size", "", "5")).toBe("unsized");
    expect(fills("start", null, "2026-11-16")).toBeNull();
    expect(fills("target", "2026-11-01", "2026-12-11")).toBeNull();
    expect(fills("size", null, null)).toBeNull();
    let log = addFixed([], "a:1", ["no_dates", "unsized"], "2026-11-03T15:00:00Z");
    log = addFixed(log, "a:1", ["no_dates"], "2026-11-04T15:00:00Z");
    expect(log.map((x) => `${x.k} ${x.g} ${x.at.slice(0, 10)}`)).toEqual(["a:1 unsized 2026-11-03", "a:1 no_dates 2026-11-04"]);
    expect(fixedSince(log, "2026-11-04T05:00:00Z")).toBe(1);
    expect(fixedSince(dropFixed(log, "a:1", ["unsized"]), "2026-11-02T05:00:00Z")).toBe(1);
    // Older than 2 weeks goes with the next save.
    expect(addFixed([{ k: "a:9", g: "unsized", at: "2026-10-01T00:00:00Z" }], "a:2", ["unassigned"], "2026-11-03T15:00:00Z").map((x) => x.k)).toEqual(["a:2"]);
    expect(readFixed([{ k: "a:1", g: "unsized", at: "2026-11-03T15:00:00Z" }, { k: "a:2", g: "nope", at: "2026-11-03T15:00:00Z" }, { k: "a:3", g: "unsized", at: "soon" }, 4])).toHaveLength(1);
    expect(progressText(12, 3)).toBe("12 fixed this week · 3 pending save");
    expect(progressText(0, 3)).toBe("3 pending save");
    expect(progressText(0, 0)).toBeNull();
  });
});
