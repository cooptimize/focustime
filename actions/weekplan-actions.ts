// Plan the week (step 8, by client since step 11): each client's week list of DevOps features and stories, Must or
// Nice to have, in stack rank order unless reordered here, optionally pinned to blocks; the Coop brief; "being broken
// down" marks; the "ask about priorities" follow-up; a heads-up follow-up when a committed must is dropped. Local only: the week
// plan lives in the plan store and nothing is written back to DevOps (features through the portfolio read, stories
// from the work read, one description on demand).
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { AppConfig } from "../config/schema.ts";
import { briefMarkdown, prioritiesKey, withCurrentTitles } from "../plan/weekplan.ts";
import { headsUpKey, offersHeadsUp, validBlocks, weekHeadsUpDraft, type ItemLevel, type Tier } from "../plan/weeklist.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { PlanError, type PlanStore, type WeekFeature, type WeekPlanRecord } from "../store/plan-store.ts";
import { mondayOf } from "../week/dates.ts";
import type { ClientPortfolio, ClientWork, IsoDate, PortfolioItem, Week } from "../week/types.ts";
import { internalClients, followUpView, nameOf } from "./followup-rules.ts";
import type { ActionResponse, WeekPlanState, WeekPlanView } from "./types.ts";

export type WeekPlanAction =
  | "weekplan.load"
  | "weekplan.set_feature"
  | "weekplan.place"
  | "weekplan.commit"
  | "weekplan.add"
  | "weekplan.set_tier"
  | "weekplan.set_blocks"
  | "weekplan.reorder"
  | "weekplan.remove"
  | "weekplan.mark_done"
  | "weekplan.headsup"
  | "feature.brief"
  | "feature.mark_breakdown"
  | "followup.ask_priorities";

export type WeekPlanContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "portfolio" | "description" | "last">;
  /** Followed clients with DevOps, as week.load fetches them for that week. */
  clients: (cfg: AppConfig, weekStart: IsoDate, refresh: boolean) => Promise<ClientRef[]>;
  /** The week's blocks from focus patterns and standing blocks only (no calendars), to check where a feature goes. */
  blocks: (cfg: AppConfig, weekStart: IsoDate) => Promise<Week>;
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
function date(v: unknown): IsoDate {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid("date must be YYYY-MM-DD");
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid("date must be a real date");
  }
}
function id(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
}
function clientKey(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.length > 100) throw new Invalid("clientKey must be text");
  return v;
}
function tier(v: unknown): Tier {
  if (v !== "must" && v !== "nice") throw new Invalid("tier must be must or nice");
  return v;
}
function blocks(v: unknown): number {
  if (!validBlocks(v)) throw new Invalid("blocks must be 0.5 to 20 in half steps");
  return v;
}
function bool(v: unknown, name: string): boolean {
  if (typeof v !== "boolean") throw new Invalid(`${name} must be true or false`);
  return v;
}

async function clock(ctx: WeekPlanContext) {
  const cfg = await ctx.config();
  const tz = cfg?.week.hours.timeZone ?? defaultWeekConfig.hours.timeZone;
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate().toString();
  return { cfg, today, thisWeek: mondayOf(today) };
}

export const weekPlanView = (p: WeekPlanRecord): WeekPlanView => ({
  weekStart: p.weekStart,
  committedAt: p.committedAt,
  updatedAt: p.updatedAt,
  changed: !!p.committedAt && !!p.updatedAt && Temporal.Instant.compare(Temporal.ZonedDateTime.from(p.updatedAt).toInstant(), Temporal.ZonedDateTime.from(p.committedAt).toInstant()) > 0,
  features: p.features,
});

const shortDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const HALF_WORDS = { AM: "morning", PM: "afternoon" } as const;

/** A feature of the client's portfolio (feature tier only), from the last portfolio read. */
async function featureOf(ctx: WeekPlanContext, cfg: AppConfig, weekStart: IsoDate, key: string, itemId: number, tier: "feature" | "any" = "feature"): Promise<{ item: PortfolioItem; portfolio: ClientPortfolio } | null> {
  const clients = await ctx.clients(cfg, weekStart, false);
  const ref = clients.find((c) => c.clientKey === key);
  if (!ref) return null;
  const [portfolio] = await ctx.devops(cfg).portfolio([ref]);
  const item = portfolio?.items.find((i) => i.id === itemId && (tier === "any" || i.tier === "feature"));
  return item && portfolio ? { item, portfolio } : null;
}

/**
 * A story of the client's as DevOps shows it now (step 11): one of my items or a child read with them (work read), or
 * a story under one of the client's features (portfolio read). Features and epics are not stories.
 */
async function storyOf(ctx: WeekPlanContext, cfg: AppConfig, weekStart: IsoDate, key: string, itemId: number): Promise<{ title: string; type: string; url: string } | null> {
  const w = ctx.devops(cfg).last(key);
  const fromWork = w ? [...w.items, ...w.children, ...(w.committed ?? []), ...(w.watched ?? [])].find((i) => i.id === itemId && i.level === "story") : undefined;
  if (fromWork) return { title: fromWork.title, type: fromWork.type, url: fromWork.url };
  const clients = await ctx.clients(cfg, weekStart, false);
  const ref = clients.find((c) => c.clientKey === key);
  if (!ref) return null;
  const [portfolio] = await ctx.devops(cfg).portfolio([ref]);
  const kid = portfolio?.items.flatMap((i) => i.children).find((c) => c.id === itemId && c.level === "story");
  return kid ? { title: kid.title, type: kid.type, url: kid.url } : null;
}

/** Where a feature can go: that client's own blocks, or an Open half-day (Mon to Thu, no focus block). */
async function checkSlot(ctx: WeekPlanContext, cfg: AppConfig, weekStart: IsoDate, key: string, d: IsoDate, h: "AM" | "PM"): Promise<string | null> {
  const week = await ctx.blocks(cfg, weekStart);
  const day = week.days.find((x) => x.date === d);
  if (!day) return "That day isn't in this week";
  const slot = h === "AM" ? day.am : day.pm;
  if (slot.focus[0] && slot.focus[0].clientKey !== key) return `That block is ${slot.focus[0].clientName}'s`;
  if (!slot.focus[0] && !slot.open) return "That half-day isn't a focus block or an Open half-day";
  return null;
}

export async function weekPlanAction(ctx: WeekPlanContext, action: WeekPlanAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  try {
    const { cfg, today, thisWeek } = await clock(ctx);
    if (!cfg) return bad("Fix the config first", 409);
    const editable = (w: IsoDate) => {
      if (w < thisWeek) throw new PlanError("That week is over; it can be reviewed, not changed");
    };
    switch (action) {
      case "weekplan.load": {
        const o = fields(input ?? {}, [], ["weekStart", "refresh"]);
        const weekStart = o.weekStart === undefined ? Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString() : monday(o.weekStart);
        const refresh = o.refresh === undefined ? false : bool(o.refresh, "refresh");
        const clients = await ctx.clients(cfg, weekStart, refresh);
        // A past week is a review: its committed features as stored, no DevOps read.
        const portfolios = weekStart < thisWeek ? [] : await ctx.devops(cfg).portfolio(clients, refresh ? { refresh } : {});
        const names = new Map(clients.map((c) => [c.clientKey, c.clientName] as const));
        const clientName = nameOf(cfg, (k) => names.get(k));
        const followUps = plan.allFollowUps().filter((l) => l.kind === "priorities" && l.ruleKey?.startsWith(`priorities:${weekStart}:`)).map((l) => followUpView(plan, l, today, clientName));
        // Q51: current DevOps titles (this read's features, then fresh work items in memory); stored titles otherwise.
        const fromWork = titleFrom(clients.map((c) => ctx.devops(cfg).last(c.clientKey)).filter((w): w is ClientWork => !!w));
        const current = (k: string, id: number) => portfolios.find((p) => p.clientKey === k && p.status === "ok" && !p.fromCache)?.items.find((i) => i.id === id)?.title ?? fromWork(k, id);
        const state: WeekPlanState = { weekStart, thisWeek, today, access: weekStart < thisWeek ? "past" : "plan", plan: withTitles(weekPlanView(plan.weekPlan(weekStart)), current), portfolios, marks: plan.breakdownMarks(), followUps, drafts: plan.drafts(), captures: plan.inboxCount() };
        return { ok: true, data: state };
      }
      case "weekplan.set_feature": {
        const o = fields(input, ["weekStart", "clientKey", "itemId", "blocks"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const key = clientKey(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        const n = o.blocks === 0 ? 0 : blocks(o.blocks);
        const existing = plan.weekPlan(weekStart).features.find((f) => f.clientKey === key && f.itemId === itemId);
        let title = existing?.title ?? "";
        let itemType = existing?.itemType ?? null;
        let url = existing?.url ?? null;
        // Committing (not taking off) needs the feature to be one of this client's, as DevOps shows it now.
        if (n > 0) {
          const found = await featureOf(ctx, cfg, weekStart, key, itemId);
          if (!found && !existing) return bad(`#${itemId} isn't one of your features for ${key}`, 422);
          if (found) ({ title, type: itemType, url } = { title: found.item.title, type: found.item.type, url: found.item.url });
        }
        const feature = plan.setWeekFeature({ weekStart, clientKey: key, itemId, title, itemType, url, blocks: n });
        return { ok: true, data: { feature, plan: weekPlanView(plan.weekPlan(weekStart)) } };
      }
      case "weekplan.place": {
        const o = fields(input, ["weekStart", "clientKey", "itemId", "date", "half", "on"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const key = clientKey(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        const d = date(o.date);
        if (o.half !== "AM" && o.half !== "PM") throw new Invalid("half must be AM or PM");
        const h = o.half;
        const on = bool(o.on, "on");
        const offset = Temporal.PlainDate.from(weekStart).until(Temporal.PlainDate.from(d)).days;
        if (offset < 0 || offset > 6) return bad("That block isn't in this week", 422);
        let feature: WeekFeature | null | undefined = plan.weekPlan(weekStart).features.find((f) => f.clientKey === key && f.itemId === itemId);
        if (on) {
          const why = await checkSlot(ctx, cfg, weekStart, key, d, h);
          if (why) return bad(why, 422);
          if (!feature) {
            // Pinning something not on the list yet puts it on as a must (step 11: a feature or a story).
            const found = await featureOf(ctx, cfg, weekStart, key, itemId);
            const story = found ? null : await storyOf(ctx, cfg, weekStart, key, itemId);
            if (!found && !story) return bad(`#${itemId} isn't one of your features for ${key}`, 422);
            const src = found ? { title: found.item.title, type: found.item.type, url: found.item.url } : story!;
            feature = plan.addWeekItem({ weekStart, clientKey: key, itemId, title: src.title, itemType: src.type, url: src.url, level: found ? "feature" : "story" });
          }
        }
        if (!feature) return bad("That feature isn't on this week's plan", 422);
        const placed = plan.placeFeature(feature.id, d, h, on);
        return { ok: true, data: { feature: placed, plan: weekPlanView(plan.weekPlan(weekStart)) } };
      }
      case "weekplan.commit": {
        const o = fields(input, ["weekStart"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        return { ok: true, data: { plan: weekPlanView(plan.commitWeek(weekStart)) } };
      }
      case "weekplan.add": {
        const o = fields(input, ["weekStart", "clientKey", "itemId"], ["tier", "blocks"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const key = clientKey(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        const t = o.tier === undefined ? undefined : tier(o.tier);
        const b = o.blocks === undefined ? undefined : blocks(o.blocks);
        // DevOps first: only what DevOps shows as this client's feature or story now goes on the list.
        const feature = await featureOf(ctx, cfg, weekStart, key, itemId);
        const story = feature ? null : await storyOf(ctx, cfg, weekStart, key, itemId);
        if (!feature && !story) return bad(`#${itemId} isn't one of ${key}'s features or stories in DevOps`, 422);
        const level: ItemLevel = feature ? "feature" : "story";
        const src = feature ? { title: feature.item.title, type: feature.item.type, url: feature.item.url } : story!;
        const item = plan.addWeekItem({ weekStart, clientKey: key, itemId, title: src.title, itemType: src.type, url: src.url, level, ...(t ? { tier: t } : {}), ...(b !== undefined ? { blocks: b } : {}) });
        return { ok: true, data: { item, plan: weekPlanView(plan.weekPlan(weekStart)) } };
      }
      case "weekplan.set_tier":
      case "weekplan.remove": {
        const o = fields(input, action === "weekplan.set_tier" ? ["id", "tier"] : ["id"]);
        const before = plan.weekItem(id(o.id, "id"));
        if (!before) return bad("That item isn't on a week plan", 422);
        editable(before.weekStart);
        const committedAt = plan.weekPlan(before.weekStart).committedAt;
        const to = action === "weekplan.set_tier" ? tier(o.tier) : null;
        if (to) plan.setWeekItemTier(before.id, to);
        else plan.removeWeekItem(before.id);
        // Dropping a must the week was committed with offers the heads-up follow-up; nothing else is asked (D197).
        const dropped = to !== "must" && offersHeadsUp(before, committedAt) && !internalClients(cfg).has(before.clientKey);
        return { ok: true, data: { plan: weekPlanView(plan.weekPlan(before.weekStart)), headsUp: dropped ? { weekStart: before.weekStart, clientKey: before.clientKey, itemId: before.itemId, title: before.title, trigger: to ? "demoted" : "dropped" } : null } };
      }
      case "weekplan.set_blocks": {
        const o = fields(input, ["id", "blocks"]);
        const before = plan.weekItem(id(o.id, "id"));
        if (!before) return bad("That item isn't on a week plan", 422);
        editable(before.weekStart);
        const item = plan.setWeekItemBlocks(before.id, blocks(o.blocks));
        return { ok: true, data: { item, plan: weekPlanView(plan.weekPlan(before.weekStart)) } };
      }
      case "weekplan.mark_done": {
        const o = fields(input, ["id", "on"]);
        const before = plan.weekItem(id(o.id, "id"));
        if (!before) return bad("That item isn't on a week plan", 422);
        editable(before.weekStart);
        const item = plan.markWeekItemDone(before.id, bool(o.on, "on"));
        return { ok: true, data: { item, plan: weekPlanView(plan.weekPlan(before.weekStart)) } };
      }
      case "weekplan.reorder": {
        // The order as shown, top first; or reset: back to DevOps stack rank for the client's whole list.
        const o = fields(input, ["weekStart", "clientKey"], ["tier", "order", "reset"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const key = clientKey(o.clientKey);
        if (o.reset !== undefined) {
          if (o.reset !== true) throw new Invalid("reset must be true");
          if (o.order !== undefined || o.tier !== undefined) throw new Invalid("reset takes no order");
          return { ok: true, data: { plan: weekPlanView(plan.reorderWeekItems(weekStart, key, "must", null)) } };
        }
        const t = tier(o.tier);
        if (!Array.isArray(o.order) || !o.order.length || o.order.length > 200) throw new Invalid("order must be a list of item numbers");
        const ids = o.order.map((x) => id(x, "order"));
        if (new Set(ids).size !== ids.length) throw new Invalid("order has an item twice");
        return { ok: true, data: { plan: weekPlanView(plan.reorderWeekItems(weekStart, key, t, ids.map((itemId, i) => ({ itemId, position: i + 1 })))) } };
      }
      case "weekplan.headsup": {
        const o = fields(input, ["weekStart", "clientKey", "itemId", "title"], ["trigger"]);
        if (o.trigger !== undefined && o.trigger !== "dropped" && o.trigger !== "demoted") throw new Invalid("trigger must be dropped or demoted");
        const weekStart = monday(o.weekStart);
        const key = clientKey(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        if (typeof o.title !== "string" || !o.title.trim() || o.title.length > 500) throw new Invalid("title must be text");
        const clients = await ctx.clients(cfg, weekStart, false);
        const name = nameOf(cfg, (k) => clients.find((c) => c.clientKey === k)?.clientName)(key);
        const followUp = plan.openRuleFollowUp({ kind: "slip", ruleKey: headsUpKey(weekStart, key, itemId), clientKey: key, who: name, what: `Heads-up to ${name}: #${itemId} moves out of the week`, itemId, draft: weekHeadsUpDraft(name, weekStart, { itemId, title: o.title.trim() }),
          // Step 13.5: where it came from, shown on the follow-up.
          origin: { trigger: o.trigger === "demoted" ? "A committed must was made a nice to have" : "A committed must was taken off the week", items: [{ itemId, title: o.title.trim() }], at: ctx.now() } });
        const existing = followUp ?? plan.allFollowUps().find((l) => l.ruleKey === headsUpKey(weekStart, key, itemId)) ?? null;
        return { ok: true, data: { followUp: existing ? followUpView(plan, existing, today, () => name) : null, created: !!followUp } };
      }
      case "feature.brief": {
        const o = fields(input, ["clientKey", "itemId"], ["weekStart"]);
        const key = clientKey(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        const weekStart = o.weekStart === undefined ? Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString() : monday(o.weekStart);
        const found = await featureOf(ctx, cfg, weekStart, key, itemId, "any");
        if (!found) return bad(`#${itemId} isn't one of your features for ${key}`, 422);
        // The description is read now, for this brief only; it is never cached or logged.
        const description = await ctx.devops(cfg).description(key, itemId).catch(() => null);
        return { ok: true, data: { markdown: briefMarkdown({ clientName: found.portfolio.clientName, item: found.item, description }), descriptionRead: description !== null } };
      }
      case "feature.mark_breakdown": {
        const o = fields(input, ["clientKey", "itemId", "on"]);
        plan.markBreakdown(clientKey(o.clientKey), id(o.itemId, "itemId"), bool(o.on, "on"));
        return { ok: true, data: { marks: plan.breakdownMarks() } };
      }
      case "followup.ask_priorities": {
        const o = fields(input, ["weekStart", "clientKey"]);
        const weekStart = monday(o.weekStart);
        const key = clientKey(o.clientKey);
        const week = await ctx.blocks(cfg, weekStart);
        const blocks = week.days.flatMap((d) => [d.am, d.pm].filter((s) => s.focus[0]?.clientKey === key).map((s) => `${shortDay(s.date)} ${HALF_WORDS[s.half as "AM" | "PM"]}`));
        if (!blocks.length) return bad(`No focus blocks with ${key} that week`, 422);
        const name = nameOf(cfg, (k) => week.days.flatMap((d) => [d.am, d.pm]).find((s) => s.focus[0]?.clientKey === k)?.focus[0]?.clientName)(key);
        const draft = [`Hi ${name}, I have focus time with you the week of ${shortDay(weekStart)}:`, ...blocks.map((b) => `- ${b}`), "Nothing open is assigned to me in DevOps right now. What should I work on first?"].join("\n");
        const followUp = plan.openRuleFollowUp({ kind: "priorities", ruleKey: prioritiesKey(weekStart, key), clientKey: key, who: name, what: `Ask ${name} about priorities for the week of ${shortDay(weekStart)}`, draft });
        const existing = followUp ?? plan.allFollowUps().find((l) => l.ruleKey === prioritiesKey(weekStart, key)) ?? null;
        return { ok: true, data: { followUp: existing ? followUpView(plan, existing, today, () => name) : null, created: !!followUp } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}

/** Q51: a title from fresh DevOps results (not cached, not failed), for committed features. */
export function titleFrom(work: readonly ClientWork[] | null): (clientKey: string, itemId: number) => string | null {
  return (clientKey, itemId) => {
    const w = work?.find((x) => x.clientKey === clientKey && x.status === "ok" && !x.fromCache);
    return (w ? [...w.items, ...w.children, ...(w.committed ?? [])].find((i) => i.id === itemId)?.title : null) ?? null;
  };
}

export const withTitles = (v: WeekPlanView, current: (clientKey: string, itemId: number) => string | null): WeekPlanView => ({ ...v, features: withCurrentTitles(v.features, current) });

