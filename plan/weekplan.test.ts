import { describe, expect, it } from "vitest";
import { buildWeek } from "../week/build.ts";
import { weekConfig } from "../config/defaults.ts";
import type { ClientPortfolio, FocusPattern, PortfolioItem, WorkItem } from "../week/types.ts";
import type { WeekFeature } from "../store/plan-store.ts";
import { withCurrentTitles, borrowedForWeek, briefMarkdown, clientBlocks, readiness, weekFit, weekNudges, type NudgeTimes } from "./weekplan.ts";

const W = "2026-11-09";
const pattern = (clientKey: string, days: FocusPattern["days"]): FocusPattern => ({ id: clientKey, clientKey, clientName: clientKey, startDate: "2026-01-01", endDate: null, active: true, days });
// Next week: W&C Mon PM, Tue AM+PM (All Day), Wed PM; CSC Wed AM. Monday AM is the standing Cooptimize block.
const patterns = [pattern("W&C", { Mon: "PM", Tue: "AllDay", Wed: "PM" }), pattern("CSC", { Wed: "AM" })];
const week = (over: Partial<Parameters<typeof buildWeek>[0]> = {}) => buildWeek({ weekStart: W, patterns, events: [], config: weekConfig, ...over });

const feature = (over: Partial<WeekFeature>): WeekFeature => ({
  id: 1, weekStart: W, clientKey: "W&C", itemId: 210, title: "Export", itemType: "Feature", url: null, blocks: 2, slots: [], position: 1, level: "feature", tier: "must", doneAt: null, createdAt: "", updatedAt: "", ...over,
});
const pItem = (over: Partial<PortfolioItem>): PortfolioItem => ({
  id: 210, title: "Export", type: "Feature", state: "Active", stateCategory: "InProgress", tier: "feature", order: 1, parentId: null, url: "https://dev.azure.com/o/p/_workitems/edit/210",
  targetDate: "2026-11-20", assignedTo: "Dana Ruiz", mine: false, why: ["parent"], children: [], ...over,
});
const child = (id: number, open: boolean, level: "story" | "portfolio" = "story", state = open ? "Active" : "Closed") =>
  ({ id, title: `Child ${id}`, type: level === "story" ? "User Story" : "Feature", state, stateCategory: open ? "InProgress" : "Completed", open, level, order: id, url: `https://dev.azure.com/o/p/_workitems/edit/${id}`, assignedTo: "Dana Ruiz", mine: false });
const portfolio = (clientKey: string, items: PortfolioItem[], over: Partial<ClientPortfolio> = {}): ClientPortfolio => ({ clientKey, clientName: clientKey, status: "ok", fetchedAt: "x", fromCache: false, items, targetFields: {}, ...over });
const mine = (id: number): WorkItem => ({ id, title: `Mine ${id}`, type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: id, parentId: null, changedAt: "", url: "" });

describe("a client's blocks next week (step 8)", () => {
  it("lists each focus block with its free share after meetings; PTO days give nothing", () => {
    const w = week({
      events: [{ id: "m", source: "outlook", title: "Status", start: "2026-11-09T13:00:00-05:00", end: "2026-11-09T14:30:00-05:00", allDay: false, showAs: "busy", isPersonal: false, responseStatus: "accepted" }],
      pto: { "2026-11-11": { date: "2026-11-11", titles: ["Vacation"], entries: [] } as never },
    });
    const b = clientBlocks(w, "W&C");
    expect(b.map((x) => [x.date, x.half, x.pto])).toEqual([["2026-11-09", "PM", false], ["2026-11-10", "AM", false], ["2026-11-10", "PM", false], ["2026-11-11", "PM", true]]);
    expect(b[0]!.freeMinutes).toBe(b[0]!.totalMinutes - 90);
    expect(b[3]!.freeMinutes).toBe(0);
  });
});

describe("fit per client: committed blocks against available focus blocks", () => {
  it("fits, tight or over, after meetings, PTO, unavailable time and unpaid borrowed time", () => {
    const w = week();
    const all = clientBlocks(w, "W&C").length;
    expect(all).toBe(4);
    expect(weekFit(w, [feature({ blocks: 2 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "W&C")).toMatchObject({ availableBlocks: 4, committedBlocks: 2, verdict: "fits" });
    expect(weekFit(w, [feature({ blocks: 4 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "W&C")!.verdict).toBe("tight");
    expect(weekFit(w, [feature({ blocks: 5 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "W&C")!.verdict).toBe("over");
    // A PTO day takes its block away.
    const pto = week({ pto: { "2026-11-10": { date: "2026-11-10", titles: ["Off"], entries: [] } as never } });
    expect(weekFit(pto, [feature({ blocks: 3 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "W&C")).toMatchObject({ availableBlocks: 2, verdict: "over" });
    // Unpaid borrowed time for the client is owed out of its blocks: 4h is about one block.
    const owed = weekFit(w, [feature({ blocks: 3 })], { borrowedMinutes: { "W&C": 240 } }).find((f) => f.clientKey === "W&C")!;
    expect(owed.borrowedMinutes).toBe(240);
    expect(owed.availableBlocks).toBeCloseTo(3, 0);
    expect(owed.verdict).not.toBe("fits");
  });
  it("counts an Open half-day a feature is placed on as that client's block", () => {
    const w = week();
    const thuAm = w.days.find((d) => d.date === "2026-11-12")!.am;
    expect(thuAm.open).toBe(true);
    const fit = weekFit(w, [feature({ blocks: 5, slots: [{ date: "2026-11-12", half: "AM" }] })], { borrowedMinutes: {} }).find((f) => f.clientKey === "W&C")!;
    expect(fit.availableBlocks).toBe(5);
    expect(fit.verdict).toBe("tight");
  });
  it("shows every client with blocks or commitments; nothing committed says so", () => {
    const fit = weekFit(week(), [], { borrowedMinutes: {} });
    expect(fit.map((f) => [f.clientKey, f.verdict])).toEqual([["internal", "none"], ["W&C", "none"], ["CSC", "none"]]);
  });
});

describe("borrowed time against a week's fit (Q48)", () => {
  it("counts only unpaid borrows paid back in that week, or with no payback date", () => {
    const b = (clientKey: string, minutes: number, paybackDate: string | null, paidAt: string | null = null) => ({ clientKey, minutes, paybackDate, paidAt });
    const list = [b("W&C", 120, "2026-11-10"), b("W&C", 60, "2026-11-15"), b("W&C", 90, "2026-11-06"), b("W&C", 45, "2026-11-11", "x"), b("CSC", 30, null), b("CSC", 15, "2026-11-16")];
    expect(borrowedForWeek(list, W)).toEqual({ "W&C": 180, CSC: 30 });
  });
});

describe("committed feature titles (Q51)", () => {
  it("shows the current DevOps title, and the stored one only when DevOps can't give it", () => {
    const fs = [feature({ itemId: 210, title: "Old name" }), feature({ id: 2, itemId: 220, title: "Kept name" })];
    const now = withCurrentTitles(fs, (k, id) => (k === "W&C" && id === 210 ? "Export, renamed" : null));
    expect(now.map((f) => [f.itemId, f.title, f.titleSource])).toEqual([[210, "Export, renamed", "devops"], [220, "Kept name", "saved"]]);
  });
});

describe("readiness ladder", () => {
  const w = week();
  it("an epic with no open features needs features", () => {
    const epic = pItem({ id: 250, tier: "epic", type: "Epic", children: [child(251, false, "portfolio")] });
    const ok = pItem({ id: 260, tier: "epic", type: "Epic", children: [child(261, true, "portfolio")] });
    const r = readiness({ week: w, portfolios: [portfolio("W&C", [epic, ok])], features: [], work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [mine(1)] }], marks: [], followUps: [] });
    expect(r.map((x) => [x.kind, x.itemId])).toEqual([["needs_features", 250]]);
  });
  it("step 13.5: draft features under an epic are counted on its flag (draft stories aren't)", () => {
    const epic = pItem({ id: 250, tier: "epic", type: "Epic", children: [] });
    const drafts = [{ clientKey: "W&C", parentItemId: 250, title: "Import", level: "feature" as const }, { clientKey: "W&C", parentItemId: 250, title: "Story", level: "story" as const }, { clientKey: "CSC", parentItemId: 250, title: "Other", level: "feature" as const }];
    const r = readiness({ week: w, portfolios: [portfolio("W&C", [epic])], features: [], work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [mine(1)] }], marks: [], followUps: [], drafts });
    expect(r.find((x) => x.kind === "needs_features")?.drafts).toBe(1);
  });
  it("step 13.5: a follow-up picked into a block is not an intention missing from DevOps", () => {
    const intentions = [{ id: 1, clientKey: "W&C", title: "Reply to Dana", date: W, size: "S" as const, status: "planned", followUpId: 4 }, { id: 2, clientKey: "W&C", title: "Look at logs", date: W, size: "S" as const, status: "planned", followUpId: null }];
    const r = readiness({ week: w, portfolios: [], features: [], work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [mine(1)] }], marks: [], followUps: [], intentions });
    expect(r.filter((x) => x.kind === "intention_not_in_devops").map((x) => x.title)).toEqual(["Look at logs"]);
  });
  it("a committed feature with no open stories (anyone's) needs breakdown, showing when it was marked as being broken down", () => {
    const empty = pItem({ id: 240, children: [child(241, false)] });
    const ready = pItem({ id: 210, children: [child(211, true)] });
    const input = { week: w, portfolios: [portfolio("W&C", [empty, ready])], features: [feature({ itemId: 240 }), feature({ id: 2, itemId: 210 })], work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [mine(1)] }], followUps: [] };
    expect(readiness({ ...input, marks: [] }).filter((x) => x.kind === "needs_breakdown")).toEqual([expect.objectContaining({ clientKey: "W&C", itemId: 240, markedAt: null })]);
    expect(readiness({ ...input, marks: [{ clientKey: "W&C", itemId: 240, markedAt: "2026-11-05T10:00:00-05:00[America/New_York]" }] }).find((x) => x.kind === "needs_breakdown")!.markedAt).toBe("2026-11-05T10:00:00-05:00[America/New_York]");
    // Not committed: no flag.
    expect(readiness({ ...input, features: [], marks: [] }).some((x) => x.kind === "needs_breakdown")).toBe(false);
  });
  it("a client focus block next week with no open work assigned to me needs work, with any follow-up already asked", () => {
    const r = readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [] }, { clientKey: "CSC", status: "ok", fromCache: false, items: [mine(5)] }] });
    expect(r).toEqual([expect.objectContaining({ kind: "block_needs_work", clientKey: "W&C", blocks: 4, followUpId: null })]);
    const asked = readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [{ id: 9, kind: "priorities", clientKey: "W&C", ruleKey: `priorities:${W}:W&C`, closedAt: null }], work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [] }] });
    expect(asked[0]).toMatchObject({ followUpId: 9 });
    // DevOps not loaded, failed or from cache: nothing can be said.
    expect(readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: [{ clientKey: "W&C", status: "auth_failed", fromCache: false, items: [] }] })).toEqual([]);
    expect(readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: null })).toEqual([]);
  });
  it("step 9: a feature needing breakdown counts its local draft stories; unsorted captures are one line to sort", () => {
    const empty = pItem({ id: 240, children: [] });
    const r = readiness({
      week: w, portfolios: [portfolio("W&C", [empty])], features: [feature({ itemId: 240 })], marks: [], followUps: [],
      work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [mine(1)] }, { clientKey: "CSC", status: "ok", fromCache: false, items: [mine(2)] }],
      drafts: [{ clientKey: "W&C", parentItemId: 240 }, { clientKey: "W&C", parentItemId: 240 }, { clientKey: "W&C", parentItemId: null }, { clientKey: "CSC", parentItemId: 240 }],
      captures: 3,
    });
    expect(r.find((x) => x.kind === "needs_breakdown")).toMatchObject({ itemId: 240, drafts: 2 });
    expect(r.find((x) => x.kind === "captures_to_sort")).toMatchObject({ count: 3, soft: false });
    expect(readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: null, captures: 0 }).some((x) => x.kind === "captures_to_sort")).toBe(false);
  });
  it("a committed feature with no target date gets a soft flag", () => {
    const r = readiness({ week: w, portfolios: [portfolio("W&C", [pItem({ targetDate: null, children: [child(211, true)] })])], features: [feature({})], work: null, marks: [], followUps: [] });
    expect(r).toEqual([expect.objectContaining({ kind: "no_target_date", itemId: 210, soft: true })]);
  });
  it("orders the list: blocks needing work, breakdown, target dates, intentions, epics", () => {
    const r = readiness({
      week: w,
      portfolios: [portfolio("W&C", [pItem({ id: 240, targetDate: null }), pItem({ id: 250, tier: "epic", type: "Epic" })])],
      features: [feature({ itemId: 240 })],
      work: [{ clientKey: "W&C", status: "ok", fromCache: false, items: [] }],
      marks: [],
      followUps: [],
    });
    expect(r.map((x) => x.kind)).toEqual(["block_needs_work", "needs_breakdown", "no_target_date", "needs_features"]);
  });
});

describe("fit per client counts musts only (step 11)", () => {
  it("nice-to-haves are listed but don't count against the client's free blocks", () => {
    const fit = weekFit(week(), [feature({ itemId: 1, blocks: 2 }), { ...feature({ itemId: 2, blocks: 3 }), tier: "nice" }], { borrowedMinutes: {} }).find((f) => f.clientKey === "W&C")!;
    expect(fit).toMatchObject({ committedBlocks: 2, niceBlocks: 3 });
    expect(fit.verdict).not.toBe("none");
    const onlyNice = weekFit(week(), [{ ...feature({ itemId: 2, blocks: 3 }), tier: "nice" }], { borrowedMinutes: {} }).find((f) => f.clientKey === "W&C")!;
    expect(onlyNice.verdict).toBe("none");
  });
});

describe("DevOps health (step 11)", () => {
  const base = { week: week(), work: null, marks: [], followUps: [] };
  const ports = [portfolio("W&C", [pItem({ id: 240, targetDate: null }), pItem({ id: 241, targetDate: null }), pItem({ id: 242, targetDate: "2026-11-20", children: [child(1, true)] })])];
  it("flags list features with no stories (must or nice) and musts with no target date; stories aren't checked as features", () => {
    const r = readiness({ ...base, portfolios: ports, features: [feature({ itemId: 240 }), { ...feature({ itemId: 241 }), tier: "nice" }, feature({ itemId: 242 }), { ...feature({ itemId: 243 }), level: "story" }] });
    expect(r.map((x) => `${x.kind}:${x.itemId}`)).toEqual(["needs_breakdown:240", "needs_breakdown:241", "no_target_date:240"]);
  });
  it("nudges typed intentions into DevOps, unless already a draft, dropped, or a Break down pick", () => {
    const intentions = [
      { id: 1, clientKey: "W&C", title: "Review the export", date: "2026-11-09", size: "M" as const, status: "planned" },
      { id: 2, clientKey: "W&C", title: "Already drafted", date: "2026-11-09", size: "S" as const, status: "done" },
      { id: 3, clientKey: "W&C", title: "Gone", date: "2026-11-09", size: "S" as const, status: "dropped" },
      { id: 4, clientKey: "W&C", title: "Break down #240 Export", date: "2026-11-09", size: "M" as const, status: "planned" },
    ];
    const r = readiness({ ...base, portfolios: [], features: [], intentions, drafts: [{ clientKey: "W&C", parentItemId: null, title: "already drafted " }] });
    expect(r).toEqual([expect.objectContaining({ kind: "intention_not_in_devops", pickId: 1, clientKey: "W&C", title: "Review the export", size: "M" })]);
  });
});

describe("Coop brief", () => {
  const item = pItem({ children: [child(211, false), child(212, true)] });
  it("is markdown with the client, feature, description, link, child items and states, target date, and the request", () => {
    const md = briefMarkdown({ clientName: "W&C", item, description: "Export the weekly report.\n- CSV" });
    expect(md).toContain("# Coop brief: Feature #210 Export");
    expect(md).toContain("- Client: W&C");
    expect(md).toContain("- Target date: Fri, Nov 20, 2026");
    expect(md).toContain("- Link: https://dev.azure.com/o/p/_workitems/edit/210");
    expect(md).toContain("Export the weekly report.\n- CSV");
    expect(md).toContain("- #211 User Story: Child 211 (Closed)");
    expect(md).toContain("- #212 User Story: Child 212 (Active)");
    expect(md).toMatch(/propose user stories/i);
    expect(md).toContain("Acceptance criteria");
    expect(md).toContain("S (about 1 hour), M (about 2 hours) or L (about a half-day block)");
  });
  it("carries only DevOps fields: no assignees, nothing from the plan", () => {
    const md = briefMarkdown({ clientName: "W&C", item, description: "" });
    expect(md).not.toContain("Dana");
    expect(md).toContain("No description in DevOps.");
    expect(briefMarkdown({ clientName: "W&C", item: pItem({ targetDate: null }), description: null })).toContain("- Target date: not set");
    expect(briefMarkdown({ clientName: "W&C", item: pItem({ children: [] }), description: null })).toContain("None yet.");
  });
});

describe("week nudges (Thursday 2:00 PM, Friday morning, Monday 8:30 AM)", () => {
  const times: NudgeTimes = { thu: "14:00", fri: "09:00", mon: "08:30" };
  const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[America/New_York]`);
  const none = () => false;
  it("Thursday from 2:00 PM, if next week isn't committed; once a day is the caller's (markOnce)", () => {
    expect(weekNudges(at("2026-11-05T13:59:00-05:00"), times, none).due).toEqual([]);
    expect(weekNudges(at("2026-11-05T14:00:00-05:00"), times, none).due).toEqual([{ key: "week_nudge_thu", weekStart: "2026-11-09" }]);
    expect(weekNudges(at("2026-11-05T21:00:00-05:00"), times, none).due).toHaveLength(1);
    expect(weekNudges(at("2026-11-05T14:00:00-05:00"), times, (w) => w === "2026-11-09").due).toEqual([]);
  });
  it("Friday from its time for next week, Monday from 8:30 AM for this week", () => {
    expect(weekNudges(at("2026-11-06T09:00:00-05:00"), times, none).due).toEqual([{ key: "week_nudge_fri", weekStart: "2026-11-09" }]);
    expect(weekNudges(at("2026-11-09T08:29:00-05:00"), times, none).due).toEqual([]);
    expect(weekNudges(at("2026-11-09T08:30:00-05:00"), times, none).due).toEqual([{ key: "week_nudge_mon", weekStart: "2026-11-09" }]);
    expect(weekNudges(at("2026-11-10T08:30:00-05:00"), times, none).due).toEqual([]);
  });
  it("Q50: a nudge not sent on its day (PTO) is due from the start of the next working time, until its week starts", () => {
    const nine = Temporal.PlainTime.from("09:00");
    // The week of Nov 2 is committed, so its Monday nudge (also unsent here) stays out of the way.
    const none = (w: string) => w === "2026-11-02";
    // Thursday's nudge, Friday morning: due once work starts (Friday's own is due too; the caller sends one per week).
    expect(weekNudges(at("2026-11-06T08:30:00-05:00"), { ...times, fri: "" }, none, { workStart: nine }).due).toEqual([]);
    expect(weekNudges(at("2026-11-06T09:00:00-05:00"), { ...times, fri: "" }, none, { workStart: nine }).due).toEqual([{ key: "week_nudge_thu", weekStart: "2026-11-09" }]);
    // Not on a day without working time, and not once its week has started (Monday's own nudge takes over).
    expect(weekNudges(at("2026-11-06T10:00:00-05:00"), { ...times, fri: "" }, none, { workStart: null }).due).toEqual([]);
    expect(weekNudges(at("2026-11-09T09:00:00-05:00"), { ...times, mon: "" }, none, { workStart: nine }).due).toEqual([]);
    // Monday's (this week) carries to Tuesday's working start, and stops after that week.
    expect(weekNudges(at("2026-11-10T09:05:00-05:00"), times, none, { workStart: nine }).due).toEqual([{ key: "week_nudge_mon", weekStart: "2026-11-09" }]);
    // Without a working start (legacy callers), only the nudge's own day.
    expect(weekNudges(at("2026-11-10T09:05:00-05:00"), times, none).due).toEqual([]);
  });
  it("a nudge set to empty is off", () => {
    expect(weekNudges(at("2026-11-05T15:00:00-05:00"), { ...times, thu: "" }, none).due).toEqual([]);
  });
  it("the top-bar badge stays from the last nudge until that week is committed", () => {
    expect(weekNudges(at("2026-11-05T13:00:00-05:00"), times, none).badge).toBe("2026-11-02"); // Monday's nudge, this week
    expect(weekNudges(at("2026-11-05T13:00:00-05:00"), times, (w) => w === "2026-11-02").badge).toBeNull();
    expect(weekNudges(at("2026-11-05T14:30:00-05:00"), times, none).badge).toBe("2026-11-09");
    expect(weekNudges(at("2026-11-07T10:00:00-05:00"), times, none).badge).toBe("2026-11-09"); // Saturday
    expect(weekNudges(at("2026-11-09T07:00:00-05:00"), times, none).badge).toBe("2026-11-09"); // Monday before 8:30: Friday's nudge still stands
    expect(weekNudges(at("2026-11-05T14:30:00-05:00"), times, (w) => w === "2026-11-09").badge).toBeNull();
    expect(weekNudges(at("2026-11-05T14:30:00-05:00"), { thu: "", fri: "", mon: "" }, none).badge).toBeNull();
  });
});
