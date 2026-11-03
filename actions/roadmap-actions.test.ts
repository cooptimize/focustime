// Step 16, slice 1: roadmap.load (D278 to D282). Fictional clients and people only.
import { describe, expect, it } from "vitest";
import { roadmapAction, type RoadmapContext } from "./roadmap-actions.ts";
import { createPlanStore } from "../store/plan-store.ts";
import type { AppConfig } from "../config/schema.ts";
import type { ClientPortfolio, FocusPattern, PortfolioChild, PortfolioItem } from "../week/types.ts";
import type { AheadState, RoadmapClient } from "./types.ts";
import { buildWeek } from "../week/build.ts";
import { weekConfig } from "../config/defaults.ts";

const cfg = { week: { hours: { timeZone: "America/Chicago" } } } as unknown as AppConfig;
const kid = (id: number, extra: Partial<PortfolioChild> = {}): PortfolioChild => ({ id, title: `Story ${id}`, type: "User Story", state: "Active", stateCategory: "InProgress", open: true, level: "story", order: id, url: `https://dev.azure.com/fabrikam/P/_workitems/edit/${id}`, assignedTo: "Alex Rivera", mine: false, changedAt: "2026-10-30T12:00:00Z", size: 2, ...extra });
const item = (id: number, extra: Partial<PortfolioItem> = {}): PortfolioItem => ({ id, title: `Feature ${id}`, type: "Feature", state: "Active", stateCategory: "InProgress", tier: "feature", order: id, parentId: null, url: `https://dev.azure.com/fabrikam/P/_workitems/edit/${id}`, targetDate: "2026-11-30", assignedTo: "Me", mine: true, why: ["assigned"], children: [], ...extra });

function setup(now = "2026-11-02T15:00:00Z", fromCache = false) {
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(now).toZonedDateTimeISO("America/Chicago") });
  const reads: { clients: string[]; refresh: boolean }[] = [];
  const portfolios: ClientPortfolio[] = [
    {
      clientKey: "Fabrikam", clientName: "Fabrikam", status: "ok", fetchedAt: now, fromCache, targetFields: { Feature: "Microsoft.VSTS.Scheduling.TargetDate" }, sizeField: "Microsoft.VSTS.Scheduling.StoryPoints",
      items: [
        item(10, { children: [kid(1, { stateCategory: "Completed", open: false }), kid(2), kid(3, { assignedTo: null, size: null })] }),
        item(11, { why: ["parent"], mine: false, assignedTo: "Jordan Park" }),
        item(12, { tier: "epic", type: "Epic", targetDate: null, children: [] }),
      ],
    },
    { clientKey: "Contoso", clientName: "Contoso", status: "auth_failed", message: "The DevOps PAT for Contoso was refused", fetchedAt: null, fromCache: false, items: [], targetFields: {} },
  ];
  const ctx: RoadmapContext = {
    plan,
    config: async () => cfg,
    devops: () => ({ portfolio: async (clients, opts) => (reads.push({ clients: clients.map((c) => c.clientKey), refresh: !!opts?.refresh }), portfolios.filter((p) => clients.some((c) => c.clientKey === p.clientKey))) }),
    clients: async () => [{ clientKey: "Fabrikam", clientName: "Fabrikam" }, { clientKey: "Contoso", clientName: "Contoso" }],
    now: () => now,
  };
  return { plan, ctx, reads };
}
const load = async (ctx: RoadmapContext, input: unknown = {}) => {
  const r = await roadmapAction(ctx, "roadmap.load", input);
  if (!r.ok) throw new Error(r.error);
  return r.data as { today: string; clients: RoadmapClient[] };
};

describe("roadmap.load", () => {
  it("lists only what I own, per client, with counts, people, flags and a signal; a failing client says why", async () => {
    const { ctx } = setup();
    const d = await load(ctx);
    expect(d.today).toBe("2026-11-02");
    const [fab, con] = d.clients;
    // Owned first, then contributing (the parent of my story, step 17).
    expect(fab!.rows.map((r) => [r.id, r.relation])).toEqual([[10, "owned"], [12, "owned"], [11, "contributing"]]);
    expect(fab!.rows[0]).toMatchObject({ title: "Feature 10", tier: "feature", done: 1, open: 2, people: [{ name: "Alex Rivera", count: 1 }], unassigned: 1, unsized: 1, stale: 0, targetDate: "2026-11-30", flags: [] });
    expect(fab!.rows[0]!.status).toEqual({ state: "on_track", reason: "2 stories open, 4 weeks left", trendBuilding: true, forecastEnd: null });
    // The epic has no features yet and no target date: both flags, Not scoped.
    expect(fab!.rows[1]).toMatchObject({ tier: "epic", status: { state: "not_scoped", reason: "No features yet" } });
    expect(fab!.rows[1]!.flags).toEqual(["needs_features", "no_target_date"]);
    expect(con).toMatchObject({ clientKey: "Contoso", status: "auth_failed", message: "The DevOps PAT for Contoso was refused", rows: [] });
  });
  it("takes one snapshot per item per day from a live read, and builds the trend and rate from them", async () => {
    const { ctx, plan } = setup();
    (await plan.recordSnapshots("2026-10-19", [{ clientKey: "Fabrikam", itemId: 10, done: 0, open: 5 }]));
    await load(ctx);
    await load(ctx);
    const snaps = (await plan.snapshotsFrom("2026-10-01")).get("Fabrikam:10");
    expect(snaps).toEqual([{ date: "2026-10-19", done: 0, open: 5 }, { date: "2026-11-02", done: 1, open: 2 }]);
    const row = (await load(ctx)).clients[0]!.rows[0]!;
    expect(row.trend).toEqual(snaps);
    // 1 closed in 14 days is 0.5 a week; 2 open need 4 weeks, 4 weeks left (Nov 30): On track.
    // The forecast lands on the target date itself: Watch (within a week).
    expect(row.status).toEqual({ state: "watch", reason: "2 stories open, about 1 closes every 2 weeks, 4 weeks left", trendBuilding: false, forecastEnd: "2026-11-30" });
  });
  it("step 17: stories grouped by state with assignees, blocked counted, start dates where the process has them, thresholds from config", async () => {
    const { ctx } = setup();
    const p = await ctx.devops(cfg).portfolio([{ clientKey: "Fabrikam", clientName: "Fabrikam" }] as never, {});
    const f = p[0]!;
    f.startFields = { Feature: "Microsoft.VSTS.Scheduling.StartDate" };
    f.items[0] = item(10, { startDate: "2026-11-09", children: [kid(1, { stateCategory: "Completed", state: "Closed", open: false }), kid(2, { blocked: true, state: "Blocked" }), kid(3, { stateCategory: "Proposed", state: "New", mine: true, assignedTo: "Me" }), kid(4, { stateCategory: "Removed" })] });
    ctx.devops = () => ({ portfolio: async () => [f] });
    ctx.config = async () => ({ ...cfg, roadmap: { stalledDays: 20, watchWeeks: 2 } }) as AppConfig;
    const d = (await roadmapAction(ctx, "roadmap.load", {})) as { ok: true; data: { clients: RoadmapClient[]; thresholds: unknown } };
    const row = d.data.clients[0]!.rows[0]!;
    expect(row).toMatchObject({ startDate: "2026-11-09", hasStartField: true, blocked: 1, status: { state: "blocked", reason: "1 story blocked, 2 stories open" } });
    expect(row.stories.map((s) => [s.id, s.group, s.assignee])).toEqual([[2, "blocked", "Alex Rivera"], [3, "new", "You"], [1, "done", "Alex Rivera"]]);
    expect(d.data.clients[0]!.rows[2]).toMatchObject({ relation: "contributing", hasStartField: true, startDate: null });
    expect(d.data.thresholds).toEqual({ stalledDays: 20, watchWeeks: 2 });
  });
  it("takes no snapshot from a cached read, and passes refresh through", async () => {
    const { ctx, plan, reads } = setup(undefined, true);
    await load(ctx, { refresh: true });
    expect((await plan.snapshotsFrom("2026-01-01")).size).toBe(0);
    expect(reads).toEqual([{ clients: ["Fabrikam", "Contoso"], refresh: true }]);
  });
  it("refuses unknown input", async () => {
    const { ctx } = setup();
    expect(await roadmapAction(ctx, "roadmap.load", { x: 1 })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("roadmap.ahead and roadmap.set_dates (step 17, slice 2)", () => {
  const patterns: FocusPattern[] = [{ id: "fab", clientKey: "Fabrikam", clientName: "Fabrikam", startDate: "2026-01-01", endDate: null, active: true, days: { Tue: "AllDay" } }];
  const withWeeks = () => {
    const s = setup();
    const asked: { n: number; withCalendars: number; refresh: boolean }[] = [];
    s.ctx.weeks = async (_cfg, starts, withCalendars, refresh) => (asked.push({ n: starts.length, withCalendars, refresh }), starts.map((w) => buildWeek({ weekStart: w, patterns, events: [], config: weekConfig })));
    return { ...s, asked };
  };
  const ahead = async (ctx: RoadmapContext, input: unknown = {}) => {
    const r = await roadmapAction(ctx, "roadmap.ahead", input);
    if (!r.ok) throw new Error(r.error);
    return r.data as AheadState;
  };
  it("12 weeks from this week; budgets for weeks 1 to 4 and feature hours from the week plans; months after", async () => {
    const { ctx, plan, asked } = withWeeks();
    (await plan.addWeekItem({ weekStart: "2026-11-09", clientKey: "Fabrikam", itemId: 10, title: "Feature 10", itemType: "Feature", url: null, level: "feature", tier: "must", estimate: 12 * 60 }));
    (await plan.addWeekItem({ weekStart: "2026-11-16", clientKey: "Fabrikam", itemId: 11, title: "Feature 11", itemType: "Feature", url: null, level: "feature", tier: "nice", estimate: 4 * 60 }));
    const d = await ahead(ctx, { refresh: true });
    expect(asked).toEqual([{ n: 12, withCalendars: 4, refresh: true }]);
    expect(d.today).toBe("2026-11-02");
    expect(d.weeks[0]).toBe("2026-11-02");
    expect(d.columns.map((c) => c.label)).toEqual(["Oct 19", "Oct 26", "Nov 2", "Nov 9", "Nov 16", "Nov 23", "Dec", "Jan"]);
    const fab = d.clients.find((c) => c.clientKey === "Fabrikam")!;
    expect(fab.weeks.map((w) => [w.weekStart, w.freeMinutes, w.plannedMinutes, w.status, w.text])).toEqual([
      ["2026-11-02", 480, 0, "none", "8h free"],
      ["2026-11-09", 480, 720, "over", "8h free · 12h planned"],
      ["2026-11-16", 480, 0, "none", "8h free"],
      ["2026-11-23", 480, 0, "none", "8h free"],
    ]);
    // Weeks 5 to 12: Tuesdays all day, two blocks a week (December has five weeks by their Thursdays).
    expect(fab.months).toEqual([{ month: "2026-12", available: 10 * 240 }, { month: "2027-01", available: 6 * 240 }]);
    expect(d.cells.map((c) => [c.itemId, c.weekStart, c.minutes, c.tier, c.derived])).toEqual([[10, "2026-11-09", 720, "must", false], [11, "2026-11-16", 240, "nice", false]]);
    // Every word is whole hours: no decimals, no blocks.
    expect(JSON.stringify(d.clients)).not.toMatch(/\d\.\d|block/);
  });
  it("slice 3: the last 2 weeks, musts planned and focused minutes per pick item; whether each cell is derived", async () => {
    const { ctx, plan } = withWeeks();
    (await plan.addWeekItem({ weekStart: "2026-10-26", clientKey: "Fabrikam", itemId: 10, title: "Feature 10", itemType: "Feature", url: null, level: "feature", tier: "must", estimate: 8 * 60 }));
    (await plan.addWeekItem({ weekStart: "2026-10-26", clientKey: "Fabrikam", itemId: 11, title: "Feature 11", itemType: "Feature", url: null, level: "feature", tier: "nice", estimate: 4 * 60 }));
    (await plan.commitWeek("2026-10-26"));
    const pick = (await plan.addPick({ date: "2026-10-27", half: "AM", clientKey: "Fabrikam", kind: "item", itemId: 2, title: "Story 2", size: "L" }));
    (await plan.addFocus({ pickId: pick.id, label: "Story 2", startedAt: "2026-10-27T09:00:00-05:00[America/Chicago]", endedAt: "2026-10-27T12:20:00-05:00[America/Chicago]", seconds: 200 * 60 }));
    (await plan.addWeekItem({ weekStart: "2026-11-02", clientKey: "Fabrikam", itemId: 10, title: "Feature 10", itemType: "Feature", url: null, level: "feature", tier: "must", estimate: 4 * 60 }));
    const d = await ahead(ctx);
    expect(d.columns.slice(0, 2).map((c) => [c.kind, c.label])).toEqual([["past", "Oct 19"], ["past", "Oct 26"]]);
    expect(d.past).toEqual([
      { weekStart: "2026-10-19", committed: false, planned: [], worked: [] },
      { weekStart: "2026-10-26", committed: true, planned: [{ clientKey: "Fabrikam", itemId: 10, minutes: 480 }], worked: [{ clientKey: "Fabrikam", itemId: 2, minutes: 200 }] },
    ]);
    expect(d.cells[0]).toMatchObject({ itemId: 10, minutes: 240, derived: false });
  });
  it("slice 4: opening Plan ahead (seen) answers this month's direction review, and the look ahead once next week is planned", async () => {
    const { ctx, plan } = withWeeks();
    // Nov 5: a look-ahead Thursday and November's first Thursday.
    ctx.now = () => "2026-11-05T15:00:00Z";
    await ahead(ctx);
    expect((await plan.marked("ahead_seen", "direction:2026-11"))).toBe(false);
    await ahead(ctx, { seen: true });
    expect((await plan.marked("ahead_seen", "direction:2026-11"))).toBe(true);
    // Next week isn't planned yet: the look ahead stays to offer after Done in Plan the week.
    expect((await plan.marked("ahead_seen", "plan_ahead:2026-11-05"))).toBe(false);
    (await plan.commitWeek("2026-11-09"));
    await ahead(ctx, { seen: true });
    expect((await plan.marked("ahead_seen", "plan_ahead:2026-11-05"))).toBe(true);
    expect(await roadmapAction(ctx, "roadmap.ahead", { seen: "yes" })).toMatchObject({ ok: false, status: 400 });
  });
  it("keeps dragged dates locally, clears them, and refuses bad input", async () => {
    const { ctx } = withWeeks();
    const set = (input: unknown) => roadmapAction(ctx, "roadmap.set_dates", input);
    expect(await set({ clientKey: "Fabrikam", itemId: 10, start: "2026-11-09", end: "2026-12-04" })).toMatchObject({ ok: true, data: { dates: { start: "2026-11-09", end: "2026-12-04" } } });
    expect((await ahead(ctx)).dates).toEqual({ "Fabrikam:10": { start: "2026-11-09", end: "2026-12-04" } });
    expect(await set({ clientKey: "Fabrikam", itemId: 10, start: "2026-12-05", end: "2026-12-04" })).toMatchObject({ ok: false, status: 422 });
    expect(await set({ clientKey: "Fabrikam", itemId: 10, start: "2026-02-30", end: "2026-12-04" })).toMatchObject({ ok: false, status: 400 });
    expect(await set({ clientKey: "Fabrikam", itemId: 1.5, start: "2026-11-09", end: "2026-12-04" })).toMatchObject({ ok: false, status: 400 });
    expect(await set({ clientKey: "Fabrikam", itemId: 10, start: "2026-11-09", end: "2026-12-04", extra: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(await set({ clientKey: "Fabrikam", itemId: 10, start: null, end: null })).toMatchObject({ ok: true, data: { dates: null } });
    expect((await ahead(ctx)).dates).toEqual({});
    expect(await roadmapAction(ctx, "roadmap.ahead", { x: 1 })).toMatchObject({ ok: false, status: 400 });
  });
});
