// The Roadmap view (step 16, D278 to D282): features and epics I own across followed clients, read-only. Built from
// the step 8 portfolio read; the only thing it writes is a local daily snapshot of done and open counts per item, from
// a live read. Nothing external is written here: the row actions use the existing named actions.
import { mapSeq } from "./seq.ts";
import type { AppConfig } from "../config/schema.ts";
import { matchCooptimizer, type Teammate } from "../plan/people.ts";
import { blockedCount, contributingItems, firstActivity, lastActivity, ownedItems, rowState, storyCounts, trendRate, TREND_DAYS } from "../plan/roadmap.ts";
import { needsBreakdown, needsFeatures } from "../plan/weekplan.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday, mondayOf } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import type { ActionResponse, RoadmapClient, RoadmapRow, RoadmapState, RoadmapStory } from "./types.ts";
import type { PortfolioItem, Week } from "../week/types.ts";
import { aheadColumns, aheadWeeks, pastWeeks, PLAN_WEEKS } from "../plan/ahead.ts";
import { AHEAD_SEEN_MARK, directionOccasion, lookAheadOccasion } from "../plan/rituals.ts";
import { borrowedForWeek, weekBudget } from "../plan/weekplan.ts";
import { estimate } from "../plan/estimate.ts";
import type { AheadState } from "./types.ts";
import { userZone } from "../week/zone.ts";

export const ROADMAP_ACTIONS = ["roadmap.load", "roadmap.ahead", "roadmap.set_dates"] as const;
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
  /**
   * Step 17: the week models for Plan ahead: the first `withCalendars` weeks with meetings and personal events (their
   * real free time, E2), the rest from focus patterns, standing blocks and PTO only.
   */
  weeks?: (cfg: AppConfig, weekStarts: IsoDate[], withCalendars: number, refresh: boolean) => Promise<Week[]>;
};

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });

export async function roadmapAction(ctx: RoadmapContext, action: RoadmapAction, input: unknown): Promise<ActionResponse> {
  if (action === "roadmap.ahead") return aheadAction(ctx, input);
  if (action === "roadmap.set_dates") return setDatesAction(ctx, input);
  if (action !== "roadmap.load") return bad(`Unknown action ${action}`);
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => k !== "refresh")) return bad("roadmap.load takes { refresh? }");
  if (o.refresh !== undefined && typeof o.refresh !== "boolean") return bad("refresh must be true or false");
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const now = ctx.now();
  const today = localToday(now, userZone(cfg));
  const refresh = o.refresh === true;
  const clients = await ctx.clients(cfg, mondayOf(today), refresh);
  const portfolios = clients.length ? await ctx.devops(cfg).portfolio(clients, refresh ? { refresh } : {}) : [];
  // One snapshot per owned item per day, only from a live read (a cached one would repeat old counts).
  for (const p of portfolios) {
    if (p.status !== "ok" || p.fromCache) continue;
    (await plan.recordSnapshots(today, rowItems(p).map((i) => ({ clientKey: p.clientKey, itemId: i.id, ...pick(storyCounts(i, now, false)) }))));
  }
  const snaps = (await plan.snapshotsFrom(Temporal.PlainDate.from(today).subtract({ days: TREND_DAYS }).toString()));
  // Step 16.4: people match Cooptimizers by email (name only without one); only a Cooptimizer's email goes to the view.
  const team = ctx.team ? await ctx.team(cfg).catch(() => null) : null;
  const people = (list: { name: string; count: number; email: string | null }[]) =>
    list.map((x) => ({ name: x.name, count: x.count, email: x.name === "You" ? null : (team ? (matchCooptimizer(team, x)?.email.toLowerCase() ?? null) : null) }));
  const onWeek = new Set((await plan.weekPlan(mondayOf(today))).features.map((f) => `${f.clientKey}:${f.itemId}`));
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
          owner: i.mine ? "You" : (i.assignedTo ?? null),
          parentId: i.parentId !== null && ids.has(i.parentId) ? i.parentId : null,
          targetDate: i.targetDate, startDate: i.startDate ?? null, hasStartField: !!p.startFields?.[i.type],
          ...c, blocked, lastActivity: last, firstActivity: firstActivity(i), people: people(c.people), trend: t.points,
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

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): IsoDate | null => {
  if (typeof v !== "string" || !DATE.test(v)) return null;
  try {
    return Temporal.PlainDate.from(v).toString() === v ? v : null;
  } catch {
    return null;
  }
};

/**
 * Step 17 (slice 2): Plan ahead's 12 weeks. Weeks 1 to 4: each client's free time (E2: the same budget as Plan the
 * week, its blocks' real free time less borrowed time) against the musts planned, and every feature's hours that
 * week, from the week plans themselves (one source of truth with Plan the week). Weeks 5 to 12: free time per month
 * from focus patterns and PTO. Read only; nothing external is written.
 */
async function aheadAction(ctx: RoadmapContext, input: unknown): Promise<ActionResponse> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => k !== "refresh" && k !== "seen")) return bad("roadmap.ahead takes { refresh?, seen? }");
  if (o.refresh !== undefined && typeof o.refresh !== "boolean") return bad("refresh must be true or false");
  if (o.seen !== undefined && typeof o.seen !== "boolean") return bad("seen must be true or false");
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  if (!ctx.weeks) return bad("Plan ahead isn't available here", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const today = localToday(ctx.now(), userZone(cfg));
  const weekStarts = aheadWeeks(mondayOf(today));
  // Step 17 (slice 4): opening Plan ahead (seen) answers the rituals of the moment: the look ahead once next week is
  // planned, and this month's direction review. Their dot goes and their notification closes.
  if (o.seen === true) {
    const la = lookAheadOccasion(today);
    if (la && (await plan.weekPlan(Temporal.PlainDate.from(la).add({ days: 4 }).toString())).committedAt) (await plan.markOnce(AHEAD_SEEN_MARK, `plan_ahead:${la}`));
    const dr = directionOccasion(today);
    if (dr) (await plan.markOnce(AHEAD_SEEN_MARK, `direction:${dr.slice(0, 7)}`));
  }
  const past = pastWeeks(weekStarts[0]!);
  const columns = aheadColumns(weekStarts, past);
  const weeks = await ctx.weeks(cfg, weekStarts, PLAN_WEEKS, o.refresh === true);
  const borrowed = (await plan.borrowedFor(weekStarts[0]!, Temporal.PlainDate.from(weekStarts[PLAN_WEEKS - 1]!).add({ days: 6 }).toString()));
  type Cap = AheadState["clients"][number];
  const caps = new Map<string, Cap>();
  const capOf = (k: string, name: string): Cap => {
    let c = caps.get(k);
    if (!c) caps.set(k, (c = { clientKey: k, clientName: name, weeks: [], months: [] }));
    return c;
  };
  const cells: AheadState["cells"] = [];
  for (const [i, week] of weeks.slice(0, PLAN_WEEKS).entries()) {
    const w = weekStarts[i]!;
    const items = (await plan.weekPlan(w)).features;
    for (const b of weekBudget(week, items, { borrowedMinutes: borrowedForWeek(borrowed, w) })) {
      capOf(b.clientKey, b.clientName).weeks.push({ weekStart: w, freeMinutes: b.freeMinutes, plannedMinutes: b.plannedMinutes, nicePlannedMinutes: b.nicePlannedMinutes, borrowedMinutes: b.borrowedMinutes, status: b.status, text: b.text, over: b.over });
    }
    // Each feature's load that week: from its stories on that week's list once one is sized, else its estimate (E2).
    const est = estimate(items.map((f) => ({ ...f, level: f.level ?? "feature", tier: f.tier ?? "must" })));
    for (const env of est.envelopes) cells.push({ clientKey: env.feature.clientKey, itemId: env.feature.itemId, weekStart: w, minutes: env.minutes, derived: env.derived, unsized: env.unsized, tier: env.feature.tier, weekItemId: env.feature.id, stories: env.stories.length });
  }
  // Weeks 5 to 12: free time per month column (patterns and PTO; meetings aren't known that far ahead).
  for (const col of columns) {
    if (col.kind !== "month") continue;
    const per = new Map<string, { name: string; n: number }>();
    for (const w of col.weeks) {
      const week = weeks[weekStarts.indexOf(w)];
      if (!week) continue;
      for (const b of weekBudget(week, [], { borrowedMinutes: {} })) {
        const x = per.get(b.clientKey) ?? { name: b.clientName, n: 0 };
        x.n += b.freeMinutes;
        per.set(b.clientKey, x);
      }
    }
    for (const [k, x] of per) capOf(k, x.name).months.push({ month: col.month, available: x.n });
  }
  // A client with blocks only after week 4 still gets its four weeks (no free time).
  for (const c of caps.values())
    for (const w of weekStarts.slice(0, PLAN_WEEKS))
      if (!c.weeks.some((x) => x.weekStart === w)) c.weeks.push({ weekStart: w, freeMinutes: 0, plannedMinutes: 0, nicePlannedMinutes: 0, borrowedMinutes: 0, status: "none", text: "No focus time this week", over: null });
  for (const c of caps.values()) c.weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const dates = Object.fromEntries((await plan.roadmapDates()));
  // The last 2 weeks: each feature's hours on that week's plan against the focused time on its picks (slice 3).
  const pastOut: AheadState["past"] = await mapSeq(past, async (w) => {
    const wp = (await plan.weekPlan(w));
    const est = estimate(wp.features.map((f) => ({ ...f, level: f.level ?? "feature", tier: f.tier ?? "must" })));
    const picks = (await plan.picksBetween(w, Temporal.PlainDate.from(w).add({ days: 6 }).toString()));
    const secs = (await plan.focusedSeconds(picks.map((p) => p.id)));
    const worked = new Map<string, number>();
    for (const p of picks) {
      const m = Math.round((secs[p.id] ?? 0) / 60);
      if (m <= 0) continue;
      const k = `${p.clientKey}|${p.itemId ?? ""}`;
      worked.set(k, (worked.get(k) ?? 0) + m);
    }
    return {
      weekStart: w,
      committed: !!wp.committedAt,
      planned: est.envelopes.filter((e) => e.feature.tier === "must").map((e) => ({ clientKey: e.feature.clientKey, itemId: e.feature.itemId, minutes: e.minutes })),
      worked: [...worked].map(([k, minutes]) => {
        const [clientKey, id] = k.split("|");
        return { clientKey: clientKey!, itemId: id ? Number(id) : null, minutes };
      }),
    };
  });
  const state: AheadState = { today, weeks: weekStarts, columns, clients: [...caps.values()], cells, dates, past: pastOut };
  return { ok: true, data: state };
}

/** Step 17: keep dates dragged on the timeline locally (null clears them), until Save dates to DevOps. */
async function setDatesAction(ctx: RoadmapContext, input: unknown): Promise<ActionResponse> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => !["clientKey", "itemId", "start", "end"].includes(k))) return bad("roadmap.set_dates takes { clientKey, itemId, start, end } (both null to clear)");
  if (typeof o.clientKey !== "string" || !o.clientKey.trim() || o.clientKey.length > 100) return bad("clientKey is required");
  if (typeof o.itemId !== "number" || !Number.isInteger(o.itemId) || o.itemId <= 0) return bad("itemId must be a positive whole number");
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  if (o.start === null && o.end === null) {
    (await plan.setRoadmapDates(o.clientKey, o.itemId, null));
    return { ok: true, data: { dates: null } };
  }
  const start = isoDate(o.start), end = isoDate(o.end);
  if (!start || !end) return bad("start and end must be dates (YYYY-MM-DD)");
  if (end < start) return bad("The end date is before the start date", 422);
  (await plan.setRoadmapDates(o.clientKey, o.itemId, { start, end }));
  return { ok: true, data: { dates: { start, end } } };
}
