// Step 16, slice 1: the Delivery view's rules (D278 to D281). Fictional data only.
import { describe, expect, it } from "vitest";
import { deliverySignal, ownedItems, storyCounts, trendRate, type DeliverySnapshot } from "./delivery.ts";
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
    expect(c.people).toEqual([{ name: "Alex Rivera", count: 2 }, { name: "Sam Lee", count: 1 }, { name: "You", count: 1 }]);
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
  const s = (date: string, done: number, open: number): DeliverySnapshot => ({ date, done, open });
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

describe("the on-track signal (D281)", () => {
  const base = { today: "2026-11-02", days: 21, noun: "stories" as const };
  it("says On track when what's open fits the weeks left at the current rate", () => {
    expect(deliverySignal({ ...base, open: 6, done: 9, perWeek: 3, targetDate: "2026-11-16" })).toEqual({ level: "on_track", reason: "6 stories open, about 3 closed per week, 2 weeks to target" });
  });
  it("says Watch up to one and a half times the weeks left, At risk beyond", () => {
    expect(deliverySignal({ ...base, open: 9, done: 9, perWeek: 3, targetDate: "2026-11-16" })).toEqual({ level: "watch", reason: "9 stories open, about 3 closed per week, 2 weeks to target" });
    expect(deliverySignal({ ...base, open: 10, done: 9, perWeek: 3, targetDate: "2026-11-16" }).level).toBe("at_risk");
  });
  it("handles nothing closed in the window by weeks left", () => {
    expect(deliverySignal({ ...base, open: 4, done: 2, perWeek: 0, targetDate: "2026-11-16" })).toEqual({ level: "watch", reason: "4 stories open, none closed in the last 21 days, 2 weeks to target" });
    expect(deliverySignal({ ...base, open: 4, done: 2, perWeek: 0, targetDate: "2026-11-12" })).toEqual({ level: "at_risk", reason: "4 stories open, none closed in the last 21 days, 10 days to target" });
  });
  it("is On track when everything is done, and At risk past the target date", () => {
    expect(deliverySignal({ ...base, open: 0, done: 7, perWeek: 1, targetDate: "2026-10-01" })).toEqual({ level: "on_track", reason: "All 7 stories done" });
    expect(deliverySignal({ ...base, open: 3, done: 7, perWeek: 1, targetDate: "2026-10-30" })).toEqual({ level: "at_risk", reason: "Target date passed, 3 stories open" });
  });
  it("gives no signal with nothing under the item yet", () => {
    expect(deliverySignal({ ...base, open: 0, done: 0, perWeek: null, targetDate: "2026-11-30" })).toEqual({ level: null, reason: "No stories yet" });
    expect(deliverySignal({ ...base, noun: "features", open: 0, done: 0, perWeek: null, targetDate: null })).toEqual({ level: null, reason: "No features yet" });
  });
  it("gives no signal without a target date or before a week of snapshots", () => {
    expect(deliverySignal({ ...base, open: 3, done: 1, perWeek: 1, targetDate: null })).toEqual({ level: null, reason: "No target date" });
    expect(deliverySignal({ ...base, days: 4, open: 3, done: 1, perWeek: 1, targetDate: "2026-11-30" })).toEqual({ level: null, reason: "Trend after a week of daily counts (4 days so far)" });
  });
  it("says features for an epic, rates under one with a decimal, and one day or week in the singular", () => {
    expect(deliverySignal({ ...base, noun: "features", open: 1, done: 0, perWeek: 0.8, targetDate: "2026-11-09" })).toEqual({ level: "watch", reason: "1 feature open, about 0.8 closed per week, 1 week to target" });
    expect(deliverySignal({ ...base, open: 1, done: 3, perWeek: 2, targetDate: "2026-11-03" }).reason).toBe("1 story open, about 2 closed per week, 1 day to target");
  });
});
