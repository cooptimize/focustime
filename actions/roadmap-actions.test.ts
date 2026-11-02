// Step 16, slice 1: roadmap.load (D278 to D282). Fictional clients and people only.
import { describe, expect, it } from "vitest";
import { roadmapAction, type RoadmapContext } from "./roadmap-actions.ts";
import { createPlanStore } from "../store/plan-store.ts";
import type { AppConfig } from "../config/schema.ts";
import type { ClientPortfolio, PortfolioChild, PortfolioItem } from "../week/types.ts";
import type { RoadmapClient } from "./types.ts";

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
    plan.recordSnapshots("2026-10-19", [{ clientKey: "Fabrikam", itemId: 10, done: 0, open: 5 }]);
    await load(ctx);
    await load(ctx);
    const snaps = plan.snapshotsFrom("2026-10-01").get("Fabrikam:10");
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
    expect(plan.snapshotsFrom("2026-01-01").size).toBe(0);
    expect(reads).toEqual([{ clients: ["Fabrikam", "Contoso"], refresh: true }]);
  });
  it("refuses unknown input", async () => {
    const { ctx } = setup();
    expect(await roadmapAction(ctx, "roadmap.load", { x: 1 })).toMatchObject({ ok: false, status: 400 });
  });
});
