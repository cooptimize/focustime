import { describe, expect, it } from "vitest";
import { buildWeek } from "../week/build.ts";
import { weekConfig } from "../config/defaults.ts";
import type { ClientPortfolio, FocusPattern, PortfolioItem, WorkItem } from "../week/types.ts";
import type { WeekFeature } from "../store/plan-store.ts";
import { withCurrentTitles, borrowedForWeek, briefMarkdown, clientBlocks, readiness, weekBudget, weekNudges, type NudgeTimes } from "./weekplan.ts";

const W = "2026-11-09";
const pattern = (clientKey: string, days: FocusPattern["days"]): FocusPattern => ({ id: clientKey, clientKey, clientName: clientKey, startDate: "2026-01-01", endDate: null, active: true, days });
// Next week: T&S Mon PM, Tue AM+PM (All Day), Wed PM; Adatum Wed AM. Monday AM is the standing Cooptimize block.
const patterns = [pattern("T&S", { Mon: "PM", Tue: "AllDay", Wed: "PM" }), pattern("Adatum", { Wed: "AM" })];
const week = (over: Partial<Parameters<typeof buildWeek>[0]> = {}) => buildWeek({ weekStart: W, patterns, events: [], config: weekConfig, ...over });

const feature = (over: Partial<WeekFeature>): WeekFeature => ({
  id: 1, weekStart: W, clientKey: "T&S", itemId: 210, title: "Export", itemType: "Feature", url: null, blocks: 2, size: null, parentId: null, slots: [], position: 1, level: "feature", tier: "must", doneAt: null, createdAt: "", updatedAt: "", ...over,
}) as WeekFeature;
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
    const b = clientBlocks(w, "T&S");
    expect(b.map((x) => [x.date, x.half, x.pto])).toEqual([["2026-11-09", "PM", false], ["2026-11-10", "AM", false], ["2026-11-10", "PM", false], ["2026-11-11", "PM", true]]);
    expect(b[0]!.freeMinutes).toBe(b[0]!.totalMinutes - 90);
    expect(b[3]!.freeMinutes).toBe(0);
  });
});

describe("the budget per client (step 16.4): whole blocks", () => {
  const ev = (start: string, end: string) => ({ id: start, source: "outlook" as const, title: "Busy", start, end, allDay: false, showAs: "busy" as const, isPersonal: false, responseStatus: "accepted" as const });
  it("is the client's half-days, a whole number, and says how the musts compare", () => {
    const w = week();
    const b = weekBudget(w, [feature({ blocks: 2 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!;
    expect(b).toMatchObject({ budget: 4, planned: 2, status: "free", text: "2 blocks free" });
    expect(weekBudget(w, [feature({ blocks: 4 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!.text).toBe("All 4 planned");
    expect(weekBudget(w, [feature({ blocks: 5 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!.text).toBe("5 planned, 4 available");
  });
  it("leaves out days off and half-days with under 2 hours free, and says why", () => {
    const w = week({
      pto: { "2026-11-10": { date: "2026-11-10", titles: ["Off"], entries: [] } as never },
      // Mon PM mostly meetings: 13:00 to 16:00 busy.
      events: [ev("2026-11-09T13:00:00-05:00", "2026-11-09T16:00:00-05:00")],
    });
    const b = weekBudget(w, [feature({ blocks: 1 })], { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!;
    expect(b.budget).toBe(1);
    expect(b.blocks.filter((x) => !x.counts).map((x) => x.reason)).toEqual(["Mon PM: mostly meetings", "Tue AM: day off", "Tue PM: day off"]);
    expect(Number.isInteger(b.budget)).toBe(true);
  });
  it("a meeting that leaves 2 hours or more still counts the half-day", () => {
    const w = week({ events: [ev("2026-11-09T13:00:00-05:00", "2026-11-09T14:00:00-05:00")] });
    expect(weekBudget(w, [], { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!.budget).toBe(4);
  });
  it("unpaid borrowed time takes whole blocks only", () => {
    const w = week();
    expect(weekBudget(w, [], { borrowedMinutes: { "T&S": 120 } }).find((f) => f.clientKey === "T&S")).toMatchObject({ budget: 4, borrowedBlocks: 0 });
    expect(weekBudget(w, [], { borrowedMinutes: { "T&S": 600 } }).find((f) => f.clientKey === "T&S")).toMatchObject({ budget: 2, borrowedBlocks: 2 });
  });
  it("counts an Open half-day an item is pinned to as that client's block", () => {
    const w = week();
    expect(w.days.find((d) => d.date === "2026-11-12")!.am.open).toBe(true);
    expect(weekBudget(w, [feature({ blocks: 5, slots: [{ date: "2026-11-12", half: "AM" }] })], { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!.text).toBe("All 5 planned");
  });
  it("stories under a listed feature fill it and never add to the total", () => {
    const items = [feature({ itemId: 210, blocks: 2 }), feature({ id: 2, itemId: 211, level: "story", blocks: null, size: "L", parentId: 210 }), feature({ id: 3, itemId: 212, level: "story", blocks: null, size: "L", parentId: 210 }), feature({ id: 4, itemId: 213, level: "story", blocks: null, size: "M", parentId: null })];
    expect(weekBudget(week(), items, { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!.planned).toBe(3);
  });
  it("shows every client with blocks or commitments", () => {
    expect(weekBudget(week(), [], { borrowedMinutes: {} }).map((f) => [f.clientKey, f.status])).toEqual([["internal", "none"], ["T&S", "none"], ["Adatum", "none"]]);
  });
});

describe("borrowed time against a week's fit (Q48)", () => {
  it("counts only unpaid borrows paid back in that week, or with no payback date", () => {
    const b = (clientKey: string, minutes: number, paybackDate: string | null, paidAt: string | null = null) => ({ clientKey, minutes, paybackDate, paidAt });
    const list = [b("T&S", 120, "2026-11-10"), b("T&S", 60, "2026-11-15"), b("T&S", 90, "2026-11-06"), b("T&S", 45, "2026-11-11", "x"), b("Adatum", 30, null), b("Adatum", 15, "2026-11-16")];
    expect(borrowedForWeek(list, W)).toEqual({ "T&S": 180, Adatum: 30 });
  });
});

describe("committed feature titles (Q51)", () => {
  it("shows the current DevOps title, and the stored one only when DevOps can't give it", () => {
    const fs = [feature({ itemId: 210, title: "Old name" }), feature({ id: 2, itemId: 220, title: "Kept name" })];
    const now = withCurrentTitles(fs, (k, id) => (k === "T&S" && id === 210 ? "Export, renamed" : null));
    expect(now.map((f) => [f.itemId, f.title, f.titleSource])).toEqual([[210, "Export, renamed", "devops"], [220, "Kept name", "saved"]]);
  });
});

describe("readiness ladder", () => {
  const w = week();
  it("an epic with no open features needs features", () => {
    const epic = pItem({ id: 250, tier: "epic", type: "Epic", children: [child(251, false, "portfolio")] });
    const ok = pItem({ id: 260, tier: "epic", type: "Epic", children: [child(261, true, "portfolio")] });
    const r = readiness({ week: w, portfolios: [portfolio("T&S", [epic, ok])], features: [], work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [mine(1)] }], marks: [], followUps: [] });
    expect(r.map((x) => [x.kind, x.itemId])).toEqual([["needs_features", 250]]);
  });
  it("step 13.5: draft features under an epic are counted on its flag (draft stories aren't)", () => {
    const epic = pItem({ id: 250, tier: "epic", type: "Epic", children: [] });
    const drafts = [{ clientKey: "T&S", parentItemId: 250, title: "Import", level: "feature" as const }, { clientKey: "T&S", parentItemId: 250, title: "Story", level: "story" as const }, { clientKey: "Adatum", parentItemId: 250, title: "Other", level: "feature" as const }];
    const r = readiness({ week: w, portfolios: [portfolio("T&S", [epic])], features: [], work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [mine(1)] }], marks: [], followUps: [], drafts });
    expect(r.find((x) => x.kind === "needs_features")?.drafts).toBe(1);
  });
  it("step 13.5: a follow-up picked into a block is not an intention missing from DevOps", () => {
    const intentions = [{ id: 1, clientKey: "T&S", title: "Reply to Dana", date: W, size: "S" as const, status: "planned", followUpId: 4 }, { id: 2, clientKey: "T&S", title: "Look at logs", date: W, size: "S" as const, status: "planned", followUpId: null }];
    const r = readiness({ week: w, portfolios: [], features: [], work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [mine(1)] }], marks: [], followUps: [], intentions });
    expect(r.filter((x) => x.kind === "intention_not_in_devops").map((x) => x.title)).toEqual(["Look at logs"]);
  });
  it("a committed feature with no open stories (anyone's) needs breakdown, showing when it was marked as being broken down", () => {
    const empty = pItem({ id: 240, children: [child(241, false)] });
    const ready = pItem({ id: 210, children: [child(211, true)] });
    const input = { week: w, portfolios: [portfolio("T&S", [empty, ready])], features: [feature({ itemId: 240 }), feature({ id: 2, itemId: 210 })], work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [mine(1)] }], followUps: [] };
    expect(readiness({ ...input, marks: [] }).filter((x) => x.kind === "needs_breakdown")).toEqual([expect.objectContaining({ clientKey: "T&S", itemId: 240, markedAt: null })]);
    expect(readiness({ ...input, marks: [{ clientKey: "T&S", itemId: 240, markedAt: "2026-11-05T10:00:00-05:00[America/New_York]" }] }).find((x) => x.kind === "needs_breakdown")!.markedAt).toBe("2026-11-05T10:00:00-05:00[America/New_York]");
    // Not committed: no flag.
    expect(readiness({ ...input, features: [], marks: [] }).some((x) => x.kind === "needs_breakdown")).toBe(false);
  });
  it("a client focus block next week with no open work assigned to me needs work, with any follow-up already asked", () => {
    const r = readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [] }, { clientKey: "Adatum", status: "ok", fromCache: false, items: [mine(5)] }] });
    expect(r).toEqual([expect.objectContaining({ kind: "block_needs_work", clientKey: "T&S", blocks: 4, followUpId: null })]);
    const asked = readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [{ id: 9, kind: "priorities", clientKey: "T&S", ruleKey: `priorities:${W}:T&S`, closedAt: null }], work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [] }] });
    expect(asked[0]).toMatchObject({ followUpId: 9 });
    // DevOps not loaded, failed or from cache: nothing can be said.
    expect(readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: [{ clientKey: "T&S", status: "auth_failed", fromCache: false, items: [] }] })).toEqual([]);
    expect(readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: null })).toEqual([]);
  });
  it("step 9: a feature needing breakdown counts its local draft stories; unsorted captures are one line to sort", () => {
    const empty = pItem({ id: 240, children: [] });
    const r = readiness({
      week: w, portfolios: [portfolio("T&S", [empty])], features: [feature({ itemId: 240 })], marks: [], followUps: [],
      work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [mine(1)] }, { clientKey: "Adatum", status: "ok", fromCache: false, items: [mine(2)] }],
      drafts: [{ clientKey: "T&S", parentItemId: 240 }, { clientKey: "T&S", parentItemId: 240 }, { clientKey: "T&S", parentItemId: null }, { clientKey: "Adatum", parentItemId: 240 }],
      captures: 3,
    });
    expect(r.find((x) => x.kind === "needs_breakdown")).toMatchObject({ itemId: 240, drafts: 2 });
    expect(r.find((x) => x.kind === "captures_to_sort")).toMatchObject({ count: 3, soft: false });
    expect(readiness({ week: w, portfolios: [], features: [], marks: [], followUps: [], work: null, captures: 0 }).some((x) => x.kind === "captures_to_sort")).toBe(false);
  });
  it("a committed feature with no target date gets a soft flag", () => {
    const r = readiness({ week: w, portfolios: [portfolio("T&S", [pItem({ targetDate: null, children: [child(211, true)] })])], features: [feature({})], work: null, marks: [], followUps: [] });
    expect(r).toEqual([expect.objectContaining({ kind: "no_target_date", itemId: 210, soft: true })]);
  });
  it("orders the list: blocks needing work, breakdown, target dates, intentions, epics", () => {
    const r = readiness({
      week: w,
      portfolios: [portfolio("T&S", [pItem({ id: 240, targetDate: null }), pItem({ id: 250, tier: "epic", type: "Epic" })])],
      features: [feature({ itemId: 240 })],
      work: [{ clientKey: "T&S", status: "ok", fromCache: false, items: [] }],
      marks: [],
      followUps: [],
    });
    expect(r.map((x) => x.kind)).toEqual(["block_needs_work", "needs_breakdown", "no_target_date", "needs_features"]);
  });
});

describe("the budget counts musts only (step 11)", () => {
  it("nice-to-haves are listed but don't count against the client's blocks", () => {
    const b = weekBudget(week(), [feature({ itemId: 1, blocks: 2 }), { ...feature({ itemId: 2, blocks: 3 }), tier: "nice" }], { borrowedMinutes: {} }).find((f) => f.clientKey === "T&S")!;
    expect(b).toMatchObject({ planned: 2, nicePlanned: 3 });
  });
});

describe("DevOps health (step 11)", () => {
  const base = { week: week(), work: null, marks: [], followUps: [] };
  const ports = [portfolio("T&S", [pItem({ id: 240, targetDate: null }), pItem({ id: 241, targetDate: null }), pItem({ id: 242, targetDate: "2026-11-20", children: [child(1, true)] })])];
  it("flags list features with no stories (must or nice) and musts with no target date; stories aren't checked as features", () => {
    const r = readiness({ ...base, portfolios: ports, features: [feature({ itemId: 240 }), { ...feature({ itemId: 241 }), tier: "nice" }, feature({ itemId: 242 }), { ...feature({ itemId: 243 }), level: "story" }] });
    expect(r.map((x) => `${x.kind}:${x.itemId}`)).toEqual(["needs_breakdown:240", "needs_breakdown:241", "no_target_date:240"]);
  });
  it("nudges typed intentions into DevOps, unless already a draft, dropped, or a Break down pick", () => {
    const intentions = [
      { id: 1, clientKey: "T&S", title: "Review the export", date: "2026-11-09", size: "M" as const, status: "planned" },
      { id: 2, clientKey: "T&S", title: "Already drafted", date: "2026-11-09", size: "S" as const, status: "done" },
      { id: 3, clientKey: "T&S", title: "Gone", date: "2026-11-09", size: "S" as const, status: "dropped" },
      { id: 4, clientKey: "T&S", title: "Break down #240 Export", date: "2026-11-09", size: "M" as const, status: "planned" },
    ];
    const r = readiness({ ...base, portfolios: [], features: [], intentions, drafts: [{ clientKey: "T&S", parentItemId: null, title: "already drafted " }] });
    expect(r).toEqual([expect.objectContaining({ kind: "intention_not_in_devops", pickId: 1, clientKey: "T&S", title: "Review the export", size: "M" })]);
  });
});

describe("Coop brief", () => {
  const item = pItem({ children: [child(211, false), child(212, true)] });
  it("is markdown with the client, feature, description, link, child items and states, target date, and the request", () => {
    const md = briefMarkdown({ clientName: "T&S", item, description: "Export the weekly report.\n- CSV" });
    expect(md).toContain("# Coop brief: Feature #210 Export");
    expect(md).toContain("- Client: T&S");
    expect(md).toContain("- Target date: Fri, Nov 20, 2026");
    expect(md).toContain("- Link: https://dev.azure.com/o/p/_workitems/edit/210");
    expect(md).toContain("Export the weekly report.\n- CSV");
    expect(md).toContain("- #211 User Story: Child 211 (Closed)");
    expect(md).toContain("- #212 User Story: Child 212 (Active)");
    expect(md).toMatch(/propose user stories/i);
    expect(md).toContain("Acceptance criteria");
    expect(md).toContain("S (about an hour), M (a couple of hours) or L (about a whole block)");
  });
  it("carries only DevOps fields: no assignees, nothing from the plan", () => {
    const md = briefMarkdown({ clientName: "T&S", item, description: "" });
    expect(md).not.toContain("Dana");
    expect(md).toContain("No description in DevOps.");
    expect(briefMarkdown({ clientName: "T&S", item: pItem({ targetDate: null }), description: null })).toContain("- Target date: not set");
    expect(briefMarkdown({ clientName: "T&S", item: pItem({ children: [] }), description: null })).toContain("None yet.");
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
