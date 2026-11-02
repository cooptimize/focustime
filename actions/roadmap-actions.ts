// The Roadmap view (step 16, D278 to D282): features and epics I own across followed clients, read-only. Built from
// the step 8 portfolio read; the only thing it writes is a local daily snapshot of done and open counts per item, from
// a live read. Nothing external is written here: the row actions use the existing named actions.
import type { AppConfig } from "../config/schema.ts";
import { roadmapSignal, ownedItems, storyCounts, trendRate, TREND_DAYS } from "../plan/roadmap.ts";
import { needsBreakdown, needsFeatures } from "../plan/weekplan.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import type { ActionResponse, RoadmapClient, RoadmapRow, RoadmapState } from "./types.ts";

export const ROADMAP_ACTIONS = ["roadmap.load"] as const;
export type RoadmapAction = (typeof ROADMAP_ACTIONS)[number];

export type RoadmapContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "portfolio">;
  /** Followed clients with DevOps this week (Cooptimize always), as week.load fetches them. */
  clients: (cfg: AppConfig, weekStart: IsoDate, refresh: boolean) => Promise<ClientRef[]>;
  now: () => string;
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
    plan.recordSnapshots(today, ownedItems(p).map((i) => ({ clientKey: p.clientKey, itemId: i.id, ...pick(storyCounts(i, now, false)) })));
  }
  const snaps = plan.snapshotsFrom(Temporal.PlainDate.from(today).subtract({ days: TREND_DAYS }).toString());
  const onWeek = new Set(plan.weekPlan(mondayOf(today)).features.map((f) => `${f.clientKey}:${f.itemId}`));
  const out: RoadmapClient[] = portfolios.map((p) => ({
    clientKey: p.clientKey,
    clientName: p.clientName,
    status: p.status,
    ...(p.message ? { message: p.message } : {}),
    fetchedAt: p.fetchedAt,
    fromCache: p.fromCache,
    rows: ownedItems(p).map((i): RoadmapRow => {
      const c = storyCounts(i, now, !!p.sizeField);
      const t = trendRate(snaps.get(`${p.clientKey}:${i.id}`) ?? [], today);
      const flags: RoadmapRow["flags"] = [];
      if (i.tier === "feature" && needsBreakdown(i)) flags.push("needs_breakdown");
      if (i.tier === "epic" && needsFeatures(i)) flags.push("needs_features");
      if (!i.targetDate) flags.push("no_target_date");
      return {
        id: i.id, title: i.title, type: i.type, tier: i.tier, state: i.state, url: i.url, targetDate: i.targetDate,
        ...c, trend: t.points,
        signal: roadmapSignal({ open: c.open, done: c.done, perWeek: t.perWeek, days: t.days, targetDate: i.targetDate, today, noun: i.tier === "epic" ? "features" : "stories" }),
        flags,
        onWeek: onWeek.has(`${p.clientKey}:${i.id}`),
      };
    }),
  }));
  return { ok: true, data: { today, weekStart: mondayOf(today), clients: out } satisfies RoadmapState };
}

const pick = (c: { done: number; open: number }) => ({ done: c.done, open: c.open });
