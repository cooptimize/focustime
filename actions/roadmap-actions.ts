// The Roadmap view (step 16, D278 to D282): features and epics I own across followed clients, read-only. Built from
// the step 8 portfolio read; the only thing it writes is a local daily snapshot of done and open counts per item, from
// a live read. Nothing external is written here: the row actions use the existing named actions.
import type { AppConfig } from "../config/schema.ts";
import { matchCooptimizer, type Teammate } from "../plan/people.ts";
import { blockedCount, contributingItems, lastActivity, ownedItems, rowState, storyCounts, trendRate, TREND_DAYS } from "../plan/roadmap.ts";
import { needsBreakdown, needsFeatures } from "../plan/weekplan.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import type { ActionResponse, RoadmapClient, RoadmapRow, RoadmapState, RoadmapStory } from "./types.ts";
import type { PortfolioItem } from "../week/types.ts";

export const ROADMAP_ACTIONS = ["roadmap.load"] as const;
export type RoadmapAction = (typeof ROADMAP_ACTIONS)[number];

export type RoadmapContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "portfolio">;
  /** Followed clients with DevOps this week (Cooptimize always), as week.load fetches them. */
  clients: (cfg: AppConfig, weekStart: IsoDate, refresh: boolean) => Promise<ClientRef[]>;
  now: () => string;
  /** Step 16.4: Cooptimizers (Dataverse), to match DevOps people by email; null when they can't be read. */
  team?: (cfg: AppConfig) => Promise<Teammate[] | null>;
};

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });

export async function roadmapAction(ctx: RoadmapContext, action: RoadmapAction, input: unknown): Promise<ActionResponse> {
  if (action !== "roadmap.load") return bad(`Unknown action ${action}`);
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => k !== "refresh")) return bad("roadmap.load takes { refresh? }");
  if (o.refresh !== undefined && typeof o.refresh !== "boolean") return bad("refresh must be true or false");
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const now = ctx.now();
  const today = localToday(now, cfg.week.hours.timeZone);
  const refresh = o.refresh === true;
  const clients = await ctx.clients(cfg, mondayOf(today), refresh);
  const portfolios = clients.length ? await ctx.devops(cfg).portfolio(clients, refresh ? { refresh } : {}) : [];
  // One snapshot per owned item per day, only from a live read (a cached one would repeat old counts).
  for (const p of portfolios) {
    if (p.status !== "ok" || p.fromCache) continue;
    plan.recordSnapshots(today, rowItems(p).map((i) => ({ clientKey: p.clientKey, itemId: i.id, ...pick(storyCounts(i, now, false)) })));
  }
  const snaps = plan.snapshotsFrom(Temporal.PlainDate.from(today).subtract({ days: TREND_DAYS }).toString());
  // Step 16.4: people match Cooptimizers by email (name only without one); only a Cooptimizer's email goes to the view.
  const team = ctx.team ? await ctx.team(cfg).catch(() => null) : null;
  const people = (list: { name: string; count: number; email: string | null }[]) =>
    list.map((x) => ({ name: x.name, count: x.count, email: x.name === "You" ? null : (team ? (matchCooptimizer(team, x)?.email.toLowerCase() ?? null) : null) }));
  const onWeek = new Set(plan.weekPlan(mondayOf(today)).features.map((f) => `${f.clientKey}:${f.itemId}`));
  const th = cfg.roadmap;
  const match = (name: string | null, email: string | null | undefined) => (name && team ? (matchCooptimizer(team, { name, email: email ?? null })?.email.toLowerCase() ?? null) : null);
  const out: RoadmapClient[] = portfolios.map((p) => {
    const items = rowItems(p);
    const ids = new Set(items.map((i) => i.id));
    return {
      clientKey: p.clientKey,
      clientName: p.clientName,
      status: p.status,
      ...(p.message ? { message: p.message } : {}),
      fetchedAt: p.fetchedAt,
      fromCache: p.fromCache,
      rows: items.map((i): RoadmapRow => {
        const c = storyCounts(i, now, !!p.sizeField);
        const t = trendRate(snaps.get(`${p.clientKey}:${i.id}`) ?? [], today);
        const flags: RoadmapRow["flags"] = [];
        if (i.tier === "feature" && needsBreakdown(i)) flags.push("needs_breakdown");
        if (i.tier === "epic" && needsFeatures(i)) flags.push("needs_features");
        if (!i.targetDate) flags.push("no_target_date");
        const blocked = blockedCount(i);
        const last = lastActivity(i);
        return {
          id: i.id, title: i.title, type: i.type, tier: i.tier, state: i.state, url: i.url,
          relation: i.why.includes("assigned") ? "owned" : "contributing",
          parentId: i.parentId !== null && ids.has(i.parentId) ? i.parentId : null,
          targetDate: i.targetDate, startDate: i.startDate ?? null, hasStartField: !!p.startFields?.[i.type],
          ...c, blocked, lastActivity: last, people: people(c.people), trend: t.points,
          status: rowState({ open: c.open, done: c.done, blocked, lastActivity: last, perWeek: t.perWeek, days: t.days, targetDate: i.targetDate, today, now, noun: i.tier === "epic" ? "features" : "stories", th }),
          stories: storiesOf(i, match),
          flags,
          onWeek: onWeek.has(`${p.clientKey}:${i.id}`),
        };
      }),
    };
  });
  return { ok: true, data: { today, weekStart: mondayOf(today), clients: out, thresholds: th } satisfies RoadmapState };
}

const pick = (c: { done: number; open: number }) => ({ done: c.done, open: c.open });

/** Step 17 (D347): what the Roadmap lists: features and epics I own, then those I contribute to (the parent of my story). */
const rowItems = (p: { items: PortfolioItem[] }) => [...ownedItems(p as never), ...contributingItems(p as never)];

const GROUP_ORDER: Record<RoadmapStory["group"], number> = { blocked: 0, active: 1, new: 2, done: 3 };
/** One level down (stories; an epic's features), Removed left out, grouped by state: blocked, in progress, not started, done. */
function storiesOf(i: PortfolioItem, match: (name: string | null, email: string | null | undefined) => string | null): RoadmapStory[] {
  const level = i.tier === "epic" ? "portfolio" : "story";
  return i.children
    .filter((c) => c.level === level && c.stateCategory !== "Removed")
    .map((c): RoadmapStory => {
      const done = c.stateCategory === "Resolved" || c.stateCategory === "Completed";
      const group = done ? "done" : c.blocked ? "blocked" : c.stateCategory === "Proposed" ? "new" : "active";
      return { id: c.id, title: c.title, state: c.state, group, assignee: c.mine ? "You" : c.assignedTo, email: c.mine ? null : match(c.assignedTo, c.assignedToEmail), url: c.url };
    })
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
}
