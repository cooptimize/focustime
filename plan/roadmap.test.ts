// Step 16, slice 1: the Roadmap view's rules (D278 to D281). Fictional data only.
import { describe, expect, it } from "vitest";
import { blockedCount, contributingItems, DEFAULT_FILTER, filterRows, forecastEnd, lastActivity, ownedItems, paceText, rowState, stateCounts, storyCounts, trendRate, type RoadmapSnapshot, type RoadmapStateKind, type RowStateInput } from "./roadmap.ts";
import type { ClientPortfolio, PortfolioChild, PortfolioItem } from "../week/types.ts";

const NOW = "2026-11-02T15:00:00Z";
const kid = (id: number, extra: Partial<PortfolioChild> = {}): PortfolioChild => ({
  id, title: `Story ${id}`, type: "User Story", state: "Active", stateCategory: "InProgress", open: true, level: "story", order: id, url: `https://dev.azure.com/fabrikam/P/_workitems/edit/${id}`,
  assignedTo: "Alex Rivera", mine: false, changedAt: "2026-10-30T12:00:00Z", size: 3, ...extra,
});
const item = (id: number, extra: Partial<PortfolioItem> = {}): PortfolioItem => ({
  id, title: `Feature ${id}`, type: "Feature", state: "In Progress", stateCategory: "InProgress", tier: "feature", order: id, parentId: null,
  url: `https://dev.azure.com/fabrikam/P/_workitems/edit/${id}`, targetDate: "2026-11-20", assignedTo: "Me", mine: true, why: ["assigned"], children: [], ...extra,
});
const portfolio = (items: PortfolioItem[]): ClientPortfolio => ({ clientKey: "Fabrikam", clientName: "Fabrikam", status: "ok", fetchedAt: NOW, fromCache: false, items, targetFields: {}, sizeField: "Microsoft.VSTS.Scheduling.StoryPoints" });

describe("owned features and epics (D278)", () => {
  it("keeps only items assigned to me, not parents of my stories or epics above them", () => {
    const p = portfolio([
      item(1),
      item(2, { why: ["parent"], mine: false, assignedTo: "Jordan Park" }),
      item(3, { tier: "epic", type: "Epic", why: ["above"], mine: false }),
      item(4, { tier: "epic", type: "Epic", why: ["assigned", "parent"] }),
    ]);
    expect(ownedItems(p).map((i) => i.id)).toEqual([1, 4]);
  });
});

describe("stories done and open (D279)", () => {
  const f = item(10, {
    children: [
      kid(1, { stateCategory: "Completed", state: "Closed", open: false }),
      kid(2, { stateCategory: "Resolved", state: "Resolved", open: true }),
      kid(3, { stateCategory: "Removed", state: "Removed", open: false }),
      kid(4, { assignedTo: "Alex Rivera" }),
      kid(5, { assignedTo: "Sam Lee", size: null }),
      kid(6, { assignedTo: null, stateCategory: "Proposed", state: "New", changedAt: "2026-10-10T12:00:00Z" }),
      kid(7, { assignedTo: "Alex Rivera", changedAt: "2026-10-19T14:00:00Z" }),
      kid(9, { assignedTo: "Casey Me", mine: true }),
      kid(8, { level: "other", type: "Task" }),
    ],
  });
  it("counts Resolved and Completed as done, leaves Removed and non-story children out", () => {
    const c = storyCounts(f, NOW, true);
    expect([c.done, c.open]).toEqual([2, 5]);
  });
  it("names who works on the open stories with counts, most first (me as You), and counts unassigned, unsized and quiet ones", () => {
    const c = storyCounts(f, NOW, true);
    expect(c.people).toEqual([{ name: "Alex Rivera", count: 2, email: null }, { name: "Sam Lee", count: 1, email: null }, { name: "You", count: 1, email: null }]);
    expect(c.unassigned).toBe(1);
    expect(c.unsized).toBe(1);
    // No change in 14 days: story 6 (Oct 10) and 7 (Oct 19, 14 days and an hour before now).
    expect(c.stale).toBe(2);
  });
  it("has no unsized count without a size field", () => {
    expect(storyCounts(f, NOW, false).unsized).toBeNull();
  });
  it("counts an epic's features, not stories", () => {
    const e = item(20, { tier: "epic", type: "Epic", children: [kid(21, { level: "portfolio", type: "Feature" }), kid(22, { level: "portfolio", type: "Feature", stateCategory: "Completed", open: false }), kid(23)] });
    expect(storyCounts(e, NOW, true)).toMatchObject({ done: 1, open: 1, unsized: null });
  });
});

describe("trend from daily snapshots (D280)", () => {
  const s = (date: string, done: number, open: number): RoadmapSnapshot => ({ date, done, open });
  it("uses the oldest snapshot of the last 21 days and today's, as stories closed per week", () => {
    const r = trendRate([s("2026-10-05", 0, 20), s("2026-10-12", 2, 14), s("2026-10-19", 3, 12), s("2026-11-02", 9, 9)], "2026-11-02");
    // Oct 5 is 28 days back, outside the window: from Oct 12 (2 done) to Nov 2 (9 done), 21 days.
    expect(r.days).toBe(21);
    expect(r.perWeek).toBeCloseTo(7 / 3, 5);
    expect(r.points.map((p) => p.date)).toEqual(["2026-10-12", "2026-10-19", "2026-11-02"]);
  });
  it("never goes negative when stories reopen, and has no rate with one snapshot", () => {
    expect(trendRate([s("2026-10-26", 5, 3), s("2026-11-02", 4, 4)], "2026-11-02").perWeek).toBe(0);
    expect(trendRate([s("2026-11-02", 4, 4)], "2026-11-02")).toMatchObject({ days: 0, perWeek: null });
    expect(trendRate([], "2026-11-02")).toMatchObject({ days: 0, perWeek: null, points: [] });
  });
});

describe("one state per row, in order (step 17, D344)", () => {
  const NOWI = "2026-11-02T15:00:00Z";
  const base: RowStateInput = { today: "2026-11-02", now: NOWI, days: 21, noun: "stories", blocked: 0, lastActivity: "2026-10-30T12:00:00Z", perWeek: 3, open: 6, done: 9, targetDate: "2026-11-23" };
  const st = (o: Partial<RowStateInput> = {}) => rowState({ ...base, ...o });
  it("On track: the forecast lands before the target date with room", () => {
    // 6 open at 3 a week: 2 weeks, Nov 16; target Nov 23 is a week later.
    expect(st()).toEqual({ state: "on_track", reason: "6 stories open, about 3 close a week, 3 weeks left", trendBuilding: false, forecastEnd: "2026-11-16" });
  });
  it("Watch: the forecast lands within the Watch margin of the target", () => {
    expect(st({ targetDate: "2026-11-20" })).toMatchObject({ state: "watch", reason: "6 stories open, about 3 close a week, 3 weeks left" });
    // A margin of 0 weeks: never Watch, only On track or At risk.
    expect(st({ targetDate: "2026-11-20", th: { stalledDays: 14, watchWeeks: 0 } }).state).toBe("on_track");
  });
  it("At risk: the pace won't fit the target date (the forecast overshoots), or the date has passed", () => {
    expect(st({ targetDate: "2026-11-13" })).toMatchObject({ state: "at_risk", reason: "6 stories open, about 3 close a week, 11 days left, needs about 2 weeks", forecastEnd: "2026-11-16" });
    expect(st({ targetDate: "2026-10-26" })).toMatchObject({ state: "at_risk", reason: "Target date passed 1 week ago, 6 stories open" });
  });
  it("nothing closed: At risk under two weeks left, otherwise Watch", () => {
    expect(st({ perWeek: 0, targetDate: "2026-11-12" })).toMatchObject({ state: "at_risk", reason: "6 stories open, none closed in the last 21 days, 10 days left" });
    expect(st({ perWeek: 0, targetDate: "2026-11-30" })).toMatchObject({ state: "watch", forecastEnd: null });
  });
  it("Blocked comes first, even ahead of a passed target date", () => {
    expect(st({ blocked: 2, targetDate: "2026-10-26" })).toMatchObject({ state: "blocked", reason: "2 stories blocked, 6 stories open" });
  });
  it("Not scoped with nothing under it; Done when all is done or resolved", () => {
    expect(st({ open: 0, done: 0 })).toMatchObject({ state: "not_scoped", reason: "No stories yet" });
    expect(st({ open: 0, done: 0, noun: "features" }).reason).toBe("No features yet");
    expect(st({ open: 0, done: 7, targetDate: "2026-10-01", lastActivity: "2026-09-01T00:00:00Z" })).toMatchObject({ state: "done", reason: "All 7 stories done" });
  });
  it("Stalled: no story change for the threshold, after the pace rules", () => {
    expect(st({ lastActivity: "2026-10-12T12:00:00Z" })).toMatchObject({ state: "stalled", reason: "No story changes in 3 weeks, 6 stories open" });
    expect(st({ lastActivity: "2026-10-12T12:00:00Z", th: { stalledDays: 30, watchWeeks: 1 } }).state).toBe("on_track");
    expect(st({ lastActivity: null }).state).toBe("stalled");
    // At risk is evaluated first.
    expect(st({ lastActivity: "2026-10-12T12:00:00Z", targetDate: "2026-11-13" }).state).toBe("at_risk");
  });
  it("Needs a date: open work and no target date (after Stalled and Watch)", () => {
    expect(st({ targetDate: null })).toMatchObject({ state: "needs_date", reason: "6 stories open, about 3 close a week, no target date" });
  });
  it("Trend building: under 7 days of counts, rule-based states only and no pace in words", () => {
    // The pace would say At risk; without a week of counts it can't.
    expect(st({ days: 4, targetDate: "2026-11-13" })).toEqual({ state: "on_track", reason: "6 stories open, 11 days left", trendBuilding: true, forecastEnd: null });
    expect(st({ perWeek: null, days: 0, targetDate: null })).toMatchObject({ state: "needs_date", reason: "6 stories open, no target date", trendBuilding: true });
    // A passed date is still At risk: no pace needed.
    expect(st({ days: 2, targetDate: "2026-10-30" }).state).toBe("at_risk");
  });
  it("pace in whole words: never a decimal", () => {
    expect(paceText(0.8)).toBe("about 1 close a week");
    expect(paceText(2.6)).toBe("about 3 close a week");
    expect(paceText(0.3)).toBe("about 1 closes every 3 weeks");
    expect(st({ open: 1, perWeek: 7, targetDate: "2026-11-03" }).reason).toBe("1 story open, about 7 close a week, 1 day left");
    expect(st({ targetDate: "2026-11-02", perWeek: 7 }).reason).toBe("6 stories open, about 7 close a week, due today, needs about 6 days");
    for (const r of [0.1, 0.4, 0.74, 0.76, 1.49, 3.33]) expect(paceText(r)).not.toMatch(/\d[.,]\d/);
  });
  it("the forecast rounds up to a whole day", () => {
    expect(forecastEnd(5, 3, "2026-11-02")).toBe("2026-11-14");
    expect(forecastEnd(5, 0, "2026-11-02")).toBeNull();
    expect(forecastEnd(0, 3, "2026-11-02")).toBeNull();
  });
});

describe("blocked, last activity and contributing (step 17)", () => {
  it("counts open blocked children only and finds the latest change", () => {
    const f = item(1, { children: [kid(2, { blocked: true }), kid(3, { blocked: true, stateCategory: "Completed", open: false }), kid(4, { changedAt: "2026-11-01T09:00:00Z" }), kid(5, { stateCategory: "Removed", changedAt: "2026-11-02T09:00:00Z" })] });
    expect(blockedCount(f)).toBe(1);
    expect(lastActivity(f)).toBe("2026-11-01T09:00:00Z");
    expect(lastActivity(item(9))).toBeNull();
  });
  it("contributing: the parent of my story, not assigned to me", () => {
    const p = portfolio([item(1), item(2, { why: ["parent"], mine: false }), item(3, { why: ["assigned", "parent"] }), item(4, { why: ["above"] })]);
    expect(contributingItems(p).map((i) => i.id)).toEqual([2]);
  });
});

describe("the status board's filters (step 17)", () => {
  type R = { id: number; title: string; relation: "owned" | "contributing"; targetDate: string | null; status: { state: RoadmapStateKind } };
  const r = (id: number, state: RoadmapStateKind, relation: "owned" | "contributing" = "owned", targetDate: string | null = null): R => ({ id, title: `Item ${id}`, relation, targetDate, status: { state } });
  const rows = [r(1, "on_track", "owned", "2026-11-20"), r(2, "blocked", "contributing", "2026-12-04"), r(3, "at_risk", "owned", "2026-11-13"), r(4, "needs_date"), r(5, "done", "owned", "2026-11-01")];
  it("sorts by risk (state order, then target date) by default, or by target date", () => {
    expect(filterRows("A", rows, DEFAULT_FILTER).map((x) => x.id)).toEqual([2, 3, 4, 1, 5]);
    expect(filterRows("A", rows, { ...DEFAULT_FILTER, sort: "target" }).map((x) => x.id)).toEqual([5, 3, 1, 2, 4]);
  });
  it("combines states, relation, clients and search", () => {
    const f = { ...DEFAULT_FILTER, states: ["blocked", "at_risk"] as RoadmapStateKind[] };
    expect(filterRows("A", rows, f).map((x) => x.id)).toEqual([2, 3]);
    expect(filterRows("A", rows, { ...f, relation: "owned" }).map((x) => x.id)).toEqual([3]);
    expect(filterRows("A", rows, { ...f, clients: ["B"] })).toEqual([]);
    expect(filterRows("A", rows, { ...DEFAULT_FILTER, q: "item 4" }).map((x) => x.id)).toEqual([4]);
    expect(filterRows("A", rows, { ...DEFAULT_FILTER, q: "#5" }).map((x) => x.id)).toEqual([5]);
  });
  it("counts states over what the other filters keep, so choosing a state doesn't zero the others", () => {
    const c = stateCounts([{ clientKey: "A", rows }, { clientKey: "B", rows: [r(9, "blocked")] }], { ...DEFAULT_FILTER, states: ["done"], clients: ["A"] });
    expect(c).toMatchObject({ blocked: 1, at_risk: 1, needs_date: 1, on_track: 1, done: 1, stalled: 0 });
  });
});
