// PL-1: rolling into a new week. The "From last week" proposal (plan/carry.ts) for a week, built on read from last
// week's list and what the DevOps store says now; nothing is added to the plan until a row is accepted (one row, or
// Accept all), and a decided row isn't proposed again that week. Watching rows with their 30-minute check-in: a
// reservation on the week (counted in the budget at once) that becomes a pick only when its day is planned or opened.
// DevOps stays read-only here: Take one on a "Not yours yet" row is PV-1's own write (assign_to_me), from the UI.
//
// Who: only clients (clientAccounts()), only for a Cooptimizer; client leads from the org runtime (customers only,
// Cooptimizers only); "Check in with <name>" only names a Cooptimizer. weekplan.proposal writes nothing (the dry run).
import type { AppConfig } from "../config/schema.ts";
import { isOpen } from "../plan/process.ts";
import { acceptAllDecision, CHECKIN_MINUTES, carryProposal, checkinTarget, proposalCounts, treeOf, watchState, type CarryRow, type FeatureTree, type PlanBits, type ProposalClient, type ProposalData, type WatchView } from "../plan/carry.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import { mondayOf } from "../week/dates.ts";
import type { IsoDate, Week } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import type { OrgRuntime } from "./org.ts";
import type { ActionResponse } from "./types.ts";

export type { PlanBits, ProposalData, WatchView } from "../plan/carry.ts";

export const CARRY_ACTIONS = ["weekplan.proposal", "weekplan.carry_decide", "weekplan.carry_accept_all", "weekplan.watch_checkin", "weekplan.watch_remove"] as const;
export type CarryAction = (typeof CARRY_ACTIONS)[number];

export type CarryContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "featureTrees" | "stateChanges">;
  /** Followed clients with DevOps for that week (as week.load fetches them). */
  clients: (cfg: AppConfig, weekStart: IsoDate) => Promise<ClientRef[]>;
  /** The week's blocks from focus patterns and standing blocks only, for where a check-in goes. */
  blocks: (cfg: AppConfig, weekStart: IsoDate) => Promise<Week>;
  org?: OrgRuntime | undefined;
  /** The signed-in person's id (Entra object id), or null. */
  me: () => Promise<string | null>;
  now: () => string;
};

class Invalid extends Error {}
const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
function monday(v: unknown): IsoDate {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("weekStart must be YYYY-MM-DD");
  let d: Temporal.PlainDate;
  try {
    d = Temporal.PlainDate.from(v, { overflow: "reject" });
  } catch {
    throw new Invalid("weekStart must be a real date");
  }
  if (d.dayOfWeek !== 1) throw new Invalid("weekStart must be a Monday");
  return d.toString();
}
function id(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
}
function key(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.length > 100) throw new Invalid("clientKey must be text");
  return v;
}
function halfDay(v: unknown): { date: IsoDate; half: "AM" | "PM" } | null {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new Invalid("to must be { date, half } or null");
  const o = v as Obj;
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Invalid("to.date must be YYYY-MM-DD");
  if (o.half !== "AM" && o.half !== "PM") throw new Invalid("to.half must be AM or PM");
  return { date: Temporal.PlainDate.from(o.date).toString(), half: o.half };
}

/** Who I am for the proposal: a Cooptimizer or not, a lead of which client, which emails are Cooptimizers'. */
async function whoFor(ctx: CarryContext) {
  const me = await ctx.me();
  const org = ctx.org;
  if (!org) return { me, meIsCooptimizer: !!me, isClient: (_k: string) => true, isLead: async (_k: string) => false, isCooptimizer: (_e: string) => true };
  const [accounts, people] = await Promise.all([org.clientAccounts().catch(() => null), org.levels().catch(() => null)]);
  const emails = new Set<string>();
  for (const e of people?.people.cooptimizers ?? []) for (const x of [e.dir?.email, e.signedIn?.email, e.signedIn?.upn]) if (x) emails.add(x.toLowerCase());
  return {
    me,
    // Before the people are read, nobody is ruled out (as plan/levels.ts does for someone not read yet).
    meIsCooptimizer: !!me && (!people || !people.people.entry(me) || people.people.isCooptimizer(me)),
    isClient: (k: string) => (accounts ? accounts.isClient(k) : true),
    isLead: async (k: string) => (me ? org.isClientLead(me, k).catch(() => false) : false),
    isCooptimizer: (e: string) => emails.has(e.toLowerCase()),
  };
}

const keyOf = (clientKey: string, itemId: number) => `${clientKey}\u0000${itemId}`;

/** Last week's features, each as DevOps has it now (by id, any state), per client; null for a client it can't say. */
async function treesFor(ctx: CarryContext, cfg: AppConfig, refs: readonly ClientRef[], ids: Readonly<Record<string, readonly number[]>>): Promise<Map<string, FeatureTree | null>> {
  const out = new Map<string, FeatureTree | null>();
  const read = ctx.devops(cfg).featureTrees;
  const results = read ? await read([...refs], ids).catch(() => null) : null;
  for (const ref of refs) {
    const r = results?.find((x) => x.clientKey === ref.clientKey);
    for (const itemId of ids[ref.clientKey] ?? []) {
      const item = r?.items?.find((i) => i.id === itemId);
      out.set(keyOf(ref.clientKey, itemId), r?.items == null ? null : item ? treeOf(item) : null);
    }
  }
  return out;
}

/** Since Monday 00:00 of the week, in the person's zone, as an instant. */
const weekSince = (weekStart: IsoDate, tz: string) => Temporal.PlainDate.from(weekStart).toZonedDateTime({ timeZone: tz }).toInstant().toString();

/** The Watching rows of a week with their state ("No movement this week", "Movement not known yet"). */
export async function watchViews(ctx: CarryContext, cfg: AppConfig, weekStart: IsoDate, refs?: readonly ClientRef[]): Promise<WatchView[]> {
  const plan = ctx.plan;
  if (!plan) return [];
  const rows = await plan.weekWatches(weekStart);
  if (!rows.length) return [];
  const tz = userZone(cfg);
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate();
  const thisWeek = mondayOf(today.toString());
  // A week ahead hasn't started: nothing can have moved yet. A past week counts as a whole week.
  const weekday = weekStart > thisWeek ? 1 : weekStart < thisWeek ? 7 : today.dayOfWeek;
  const clients = refs ?? (await ctx.clients(cfg, weekStart).catch(() => []));
  const ids: Record<string, number[]> = {};
  for (const w of rows) (ids[w.clientKey] ??= []).push(w.itemId);
  const known = clients.filter((c) => ids[c.clientKey]);
  const trees = await treesFor(ctx, cfg, known, ids);
  const who = await whoFor(ctx);
  const since = weekSince(weekStart, tz);
  const changes = new Map<string, Set<number> | null>();
  for (const c of known) {
    const r = await ctx.devops(cfg).stateChanges?.(c.clientKey, since).catch(() => null);
    changes.set(c.clientKey, r?.known ? new Set(r.itemIds) : null);
  }
  const picks = new Map((await plan.picksByIds(rows.map((w) => w.checkinPickId).filter((x): x is number => x !== null))).map((p) => [p.id, p] as const));
  return rows.map((w) => {
    const p = w.checkinPickId !== null ? (picks.get(w.checkinPickId) ?? null) : null;
    const counts = !!w.checkin && (w.checkinPickId === null || (!!p && (p.status === "planned" || p.status === "done")));
    const state = watchState({ tree: trees.get(keyOf(w.clientKey, w.itemId)) ?? null, changed: changes.get(w.clientKey) ?? null, weekday, me: who.me, isCooptimizer: who.isCooptimizer });
    return { ...w, state, counts, pick: p ? { id: p.id, status: p.status, date: p.date, half: p.half } : null };
  });
}

/** Check-in minutes per client that count in a week's budget. */
export const checkinMinutes = (views: readonly Pick<WatchView, "clientKey" | "checkin" | "counts">[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const w of views) if (w.counts && w.checkin) out[w.clientKey] = (out[w.clientKey] ?? 0) + w.checkin.minutes;
  return out;
};

/** Check-in minutes per client that count in a week's budget, from the store alone (no DevOps read). */
export async function weekCheckins(plan: PlanStore, weekStart: IsoDate): Promise<Record<string, number>> {
  const rows = await plan.weekWatches(weekStart);
  if (!rows.length) return {};
  const picks = new Map((await plan.picksByIds(rows.map((w) => w.checkinPickId).filter((x): x is number => x !== null))).map((p) => [p.id, p] as const));
  return checkinMinutes(rows.map((w) => {
    const p = w.checkinPickId !== null ? picks.get(w.checkinPickId) : undefined;
    return { clientKey: w.clientKey, checkin: w.checkin, counts: !!w.checkin && (w.checkinPickId === null || (!!p && (p.status === "planned" || p.status === "done"))) };
  }));
}

/** Items DevOps has resolved, closed or removed ("client\u0000id"), from the store by id; unknown ones are left out. */
export async function resolvedKeys(devops: Pick<DevOpsSource, "itemStates">, refs: readonly ClientRef[], ids: Readonly<Record<string, readonly number[]>>): Promise<Set<string>> {
  const out = new Set<string>();
  const wanted = refs.filter((r) => (ids[r.clientKey] ?? []).length);
  if (!wanted.length || !devops.itemStates) return out;
  const results = await devops.itemStates([...wanted], ids).catch(() => []);
  for (const r of results) for (const [itemId, category] of Object.entries(r.states ?? {})) if (!isOpen(category)) out.add(keyOf(r.clientKey, Number(itemId)));
  return out;
}

/** Item ids per client (no repeats), for the by-id reads. */
export function idsByClient(items: readonly { clientKey: string; itemId: number | null }[]): Record<string, number[]> {
  const ids: Record<string, number[]> = {};
  for (const i of items) if (i.itemId !== null && !(ids[i.clientKey] ??= []).includes(i.itemId)) ids[i.clientKey]!.push(i.itemId);
  return ids;
}

/** Marks picks whose DevOps item is resolved: they count zero and show as done (read models only). */
export const markResolved = <P extends { clientKey: string; itemId: number | null }>(picks: readonly P[], resolved: ReadonlySet<string>): P[] =>
  picks.map((p) => (p.itemId !== null && resolved.has(keyOf(p.clientKey, p.itemId)) ? { ...p, resolved: true } : p));

/** The budget inputs Commit and the Board share (plan/weekplan.ts weekBudget), so they always agree. */

/** The week's PlanBits: the person's guidance, their Keep open shares, what DevOps resolved, the check-ins. */
export async function planBitsFor(o: { cfg: AppConfig; plan: PlanStore; devops: Pick<DevOpsSource, "itemStates">; refs: readonly ClientRef[]; weekStart: IsoDate; items: readonly { clientKey: string; itemId: number | null }[] }): Promise<{ bits: PlanBits; resolved: Set<string> }> {
  const resolved = await resolvedKeys(o.devops, o.refs, idsByClient(o.items));
  const g = o.cfg.org?.guidance;
  return { resolved, bits: { planShare: g?.planShare ?? 100, keepOpenDefault: g?.keepOpen ?? 0, keepOpen: { ...o.cfg.keepOpen }, resolved: [...resolved].sort(), checkins: await weekCheckins(o.plan, o.weekStart) } };
}

async function proposal(ctx: CarryContext, cfg: AppConfig, plan: PlanStore, weekStart: IsoDate, thisWeek: IsoDate): Promise<ProposalData> {
  const lastWeek = Temporal.PlainDate.from(weekStart).subtract({ days: 7 }).toString();
  const refs = await ctx.clients(cfg, weekStart).catch(() => []);
  const watching = await watchViews(ctx, cfg, weekStart, refs);
  const empty = { weekStart, lastWeek, access: weekStart < thisWeek ? ("past" as const) : ("plan" as const), clients: [], unknown: 0, counts: proposalCounts([]), watching };
  if (weekStart < thisWeek) return empty;
  const who = await whoFor(ctx);
  if (!who.me || !who.meIsCooptimizer) return empty;
  const last = (await plan.weekPlan(lastWeek)).features;
  const followed = new Map(refs.map((r) => [r.clientKey, r] as const));
  // Only clients I follow (they get DevOps reads) and that are clients (no prospects, no hidden accounts).
  const lastHere = last.filter((f) => f.level === "feature" && followed.has(f.clientKey) && who.isClient(f.clientKey));
  const ids: Record<string, number[]> = {};
  for (const f of lastHere) (ids[f.clientKey] ??= []).push(f.itemId);
  const keys = Object.keys(ids);
  const trees = await treesFor(ctx, cfg, keys.map((k) => followed.get(k)!), ids);
  const leads = new Map(await Promise.all(keys.map(async (k) => [k, await who.isLead(k)] as const)));
  const now = await plan.weekPlan(weekStart);
  const r = carryProposal({
    me: who.me,
    meIsCooptimizer: who.meIsCooptimizer,
    isClient: who.isClient,
    isLead: (k) => leads.get(k) ?? false,
    lastWeek: lastHere,
    planned: [...now.features, ...watching].map((f) => ({ clientKey: f.clientKey, itemId: f.itemId })),
    decided: await plan.carryDecisions(weekStart),
    tree: (k, itemId) => trees.get(keyOf(k, itemId)) ?? null,
  });
  const clients: ProposalClient[] = [];
  for (const row of r.rows) {
    let c = clients.find((x) => x.clientKey === row.clientKey);
    if (!c) clients.push((c = { clientKey: row.clientKey, clientName: followed.get(row.clientKey)?.clientName ?? row.clientKey, rows: [] }));
    c.rows.push(row);
  }
  return { ...empty, clients, unknown: r.unknown, counts: proposalCounts(r.rows, r.unknown) };
}

/** Turns a check-in reservation into a pick on its day, when that day is planned or opened (or is already). */
export async function materializeCheckins(plan: PlanStore, date: IsoDate): Promise<number> {
  let n = 0;
  for (const w of await plan.watchesOn(date)) {
    if (w.checkinPickId !== null || !w.checkin) continue;
    const p = await plan.addPick({ date, half: w.checkin.half, clientKey: w.clientKey, kind: "intention", title: `Check in: ${w.title}`, size: "S", minutes: w.checkin.minutes });
    await plan.setCheckinPick(w.weekStart, w.clientKey, w.itemId, p.id);
    n++;
  }
  return n;
}

/** Applies one decision on a proposal row: what keeping, watching or dropping it means. */
async function decide(ctx: CarryContext, cfg: AppConfig, plan: PlanStore, weekStart: IsoDate, row: CarryRow, decision: "keep" | "drop" | "watch"): Promise<void> {
  if (decision === "drop") {
    await plan.decideCarry(weekStart, row.clientKey, row.itemId, row.kind, "dropped");
    return;
  }
  if (decision === "watch") {
    if (row.kind === "finished") throw new PlanError("A finished feature has nothing to watch");
    const week = await ctx.blocks(cfg, weekStart);
    const target = checkinTarget(week.days, row.clientKey, ctx.now());
    await plan.addWatch({ weekStart, clientKey: row.clientKey, itemId: row.itemId, title: row.title, itemType: row.itemType, url: row.url, why: row.why ?? "chosen", checkin: target ? { ...target, minutes: CHECKIN_MINUTES } : null });
    // The check-in's day already planned or opened: it is a pick at once.
    if (target && (await plan.day(target.date))) await materializeCheckins(plan, target.date);
    await plan.decideCarry(weekStart, row.clientKey, row.itemId, row.kind, "watching");
    return;
  }
  if (row.kind !== "carry" && row.kind !== "needs_stories") throw new PlanError(row.kind === "not_yours" ? "Take one of its stories first, or drop it" : "Nothing to plan for this one; keep watching it or drop it");
  const last = (await plan.weekPlan(Temporal.PlainDate.from(weekStart).subtract({ days: 7 }).toString())).features;
  const prior = (itemId: number) => last.find((f) => f.clientKey === row.clientKey && f.itemId === itemId);
  await plan.addWeekItem({ weekStart, clientKey: row.clientKey, itemId: row.itemId, title: row.title, itemType: row.itemType, url: row.url, level: "feature", estimate: row.estimate });
  for (const s of row.stories) await plan.addWeekItem({ weekStart, clientKey: row.clientKey, itemId: s.id, title: s.title, itemType: s.type, url: s.url, level: "story", size: prior(s.id)?.size ?? null, parentId: row.itemId });
  await plan.decideCarry(weekStart, row.clientKey, row.itemId, row.kind, "kept");
}

export async function carryAction(ctx: CarryContext, action: CarryAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  try {
    const cfg = await ctx.config();
    if (!cfg) return bad("Fix the config first", 409);
    const tz = userZone(cfg);
    const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate().toString();
    const thisWeek = mondayOf(today);
    const editable = (w: IsoDate) => {
      if (w < thisWeek) throw new PlanError("That week is over; it can be reviewed, not changed");
    };
    switch (action) {
      case "weekplan.proposal": {
        const o = fields(input ?? {}, [], ["weekStart"]);
        const weekStart = o.weekStart === undefined ? thisWeek : monday(o.weekStart);
        return { ok: true, data: await proposal(ctx, cfg, plan, weekStart, thisWeek) };
      }
      case "weekplan.carry_decide": {
        const o = fields(input, ["weekStart", "clientKey", "itemId", "decision"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        if (o.decision !== "keep" && o.decision !== "drop" && o.decision !== "watch") throw new Invalid("decision must be keep, drop or watch");
        const p = await proposal(ctx, cfg, plan, weekStart, thisWeek);
        const row = p.clients.flatMap((c) => c.rows).find((r) => r.clientKey === key(o.clientKey) && r.itemId === id(o.itemId, "itemId"));
        if (!row) return bad("That row isn't proposed for this week any more", 409);
        await decide(ctx, cfg, plan, weekStart, row, o.decision);
        return { ok: true, data: await proposal(ctx, cfg, plan, weekStart, thisWeek) };
      }
      case "weekplan.carry_accept_all": {
        const o = fields(input, ["weekStart"], ["clientKey"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const only = o.clientKey === undefined ? null : key(o.clientKey);
        const p = await proposal(ctx, cfg, plan, weekStart, thisWeek);
        let n = 0;
        for (const row of p.clients.flatMap((c) => c.rows)) {
          if (only && row.clientKey !== only) continue;
          const d = acceptAllDecision(row.kind);
          if (!d) continue;
          await decide(ctx, cfg, plan, weekStart, row, d === "watching" ? "watch" : "keep");
          n++;
        }
        return { ok: true, data: { ...(await proposal(ctx, cfg, plan, weekStart, thisWeek)), accepted: n } };
      }
      case "weekplan.watch_checkin": {
        const o = fields(input, ["weekStart", "clientKey", "itemId", "to"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const k = key(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        const to = halfDay(o.to);
        const sunday = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
        if (to && (to.date < weekStart || to.date > sunday)) throw new Invalid("A check-in stays in its week");
        if (to && to.date < today) throw new Invalid("A check-in can't move into the past");
        const w = (await plan.weekWatches(weekStart)).find((x) => x.clientKey === k && x.itemId === itemId);
        if (!w) return bad("That feature isn't watched this week", 404);
        // Moving or removing it takes its pick off its old day (the Watching row stays).
        if (w.checkinPickId !== null) {
          const [p] = await plan.picksByIds([w.checkinPickId]);
          if (p?.status === "planned") await plan.removePick(p.id);
        }
        await plan.setCheckin(weekStart, k, itemId, to ? { ...to, minutes: w.checkin?.minutes ?? CHECKIN_MINUTES } : null);
        if (to && (await plan.day(to.date))) await materializeCheckins(plan, to.date);
        return { ok: true, data: { watching: await watchViews(ctx, cfg, weekStart) } };
      }
      case "weekplan.watch_remove": {
        const o = fields(input, ["weekStart", "clientKey", "itemId"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const k = key(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        const w = (await plan.weekWatches(weekStart)).find((x) => x.clientKey === k && x.itemId === itemId);
        if (!w) return bad("That feature isn't watched this week", 404);
        if (w.checkinPickId !== null) {
          const [p] = await plan.picksByIds([w.checkinPickId]);
          if (p?.status === "planned") await plan.removePick(p.id);
        }
        await plan.removeWatch(weekStart, k, itemId);
        // Stays decided for the week (it doesn't come back as a proposal row).
        await plan.decideCarry(weekStart, k, itemId, "watch", "dropped");
        return { ok: true, data: { watching: await watchViews(ctx, cfg, weekStart) } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
