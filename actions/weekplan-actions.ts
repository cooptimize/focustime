// Plan the week (step 8): commit features per client to a week, by a number of my blocks or by placing them on
// specific blocks; the Coop brief; "being broken down" marks; the "ask about priorities" loop. Local only: the week
// plan lives in the plan store. DevOps is only read (features through the portfolio read, one description on demand).
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { AppConfig } from "../config/schema.ts";
import { briefMarkdown, prioritiesKey } from "../plan/weekplan.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { PlanError, type PlanStore, type WeekFeature, type WeekPlanRecord } from "../store/plan-store.ts";
import { mondayOf } from "../week/dates.ts";
import type { ClientPortfolio, IsoDate, PortfolioItem, Week } from "../week/types.ts";
import { loopView, nameOf } from "./loop-rules.ts";
import type { ActionResponse, WeekPlanState, WeekPlanView } from "./types.ts";

export type WeekPlanAction = "weekplan.load" | "weekplan.set_feature" | "weekplan.place" | "weekplan.commit" | "feature.brief" | "feature.mark_breakdown" | "loop.ask_priorities";

export type WeekPlanContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "portfolio" | "description">;
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
        const loops = plan.allLoops().filter((l) => l.kind === "priorities" && l.ruleKey?.startsWith(`priorities:${weekStart}:`)).map((l) => loopView(plan, l, today, clientName));
        const state: WeekPlanState = { weekStart, thisWeek, today, access: weekStart < thisWeek ? "past" : "plan", plan: weekPlanView(plan.weekPlan(weekStart)), portfolios, marks: plan.breakdownMarks(), loops };
        return { ok: true, data: state };
      }
      case "weekplan.set_feature": {
        const o = fields(input, ["weekStart", "clientKey", "itemId", "blocks"]);
        const weekStart = monday(o.weekStart);
        editable(weekStart);
        const key = clientKey(o.clientKey);
        const itemId = id(o.itemId, "itemId");
        if (typeof o.blocks !== "number" || !Number.isInteger(o.blocks)) throw new Invalid("blocks must be a whole number");
        const existing = plan.weekPlan(weekStart).features.find((f) => f.clientKey === key && f.itemId === itemId);
        let title = existing?.title ?? "";
        let itemType = existing?.itemType ?? null;
        let url = existing?.url ?? null;
        // Committing (not taking off) needs the feature to be one of this client's, as DevOps shows it now.
        if (o.blocks > 0) {
          const found = await featureOf(ctx, cfg, weekStart, key, itemId);
          if (!found && !existing) return bad(`#${itemId} isn't one of your features for ${key}`, 422);
          if (found) ({ title, type: itemType, url } = { title: found.item.title, type: found.item.type, url: found.item.url });
        }
        const feature = plan.setWeekFeature({ weekStart, clientKey: key, itemId, title, itemType, url, blocks: o.blocks });
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
            const found = await featureOf(ctx, cfg, weekStart, key, itemId);
            if (!found) return bad(`#${itemId} isn't one of your features for ${key}`, 422);
            feature = plan.setWeekFeature({ weekStart, clientKey: key, itemId, title: found.item.title, itemType: found.item.type, url: found.item.url, blocks: 1 });
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
      case "loop.ask_priorities": {
        const o = fields(input, ["weekStart", "clientKey"]);
        const weekStart = monday(o.weekStart);
        const key = clientKey(o.clientKey);
        const week = await ctx.blocks(cfg, weekStart);
        const blocks = week.days.flatMap((d) => [d.am, d.pm].filter((s) => s.focus[0]?.clientKey === key).map((s) => `${shortDay(s.date)} ${HALF_WORDS[s.half as "AM" | "PM"]}`));
        if (!blocks.length) return bad(`No focus blocks with ${key} that week`, 422);
        const name = nameOf(cfg, (k) => week.days.flatMap((d) => [d.am, d.pm]).find((s) => s.focus[0]?.clientKey === k)?.focus[0]?.clientName)(key);
        const draft = [`Hi ${name}, I have focus time with you the week of ${shortDay(weekStart)}:`, ...blocks.map((b) => `- ${b}`), "Nothing open is assigned to me in DevOps right now. What should I work on first?"].join("\n");
        const loop = plan.openRuleLoop({ kind: "priorities", ruleKey: prioritiesKey(weekStart, key), clientKey: key, who: name, what: `Ask ${name} about priorities for the week of ${shortDay(weekStart)}`, draft });
        const existing = loop ?? plan.allLoops().find((l) => l.ruleKey === prioritiesKey(weekStart, key)) ?? null;
        return { ok: true, data: { loop: existing ? loopView(plan, existing, today, () => name) : null, created: !!loop } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
