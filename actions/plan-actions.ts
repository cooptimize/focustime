// Plan the day actions (step 5). Local only: they read DevOps results already in memory to check a pick,
// and write only to the local plan store. Nothing here calls DevOps, Outlook, Google or Dataverse.
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { AppConfig } from "../config/schema.ts";
import { carryTarget, dayLabel, dayRule, upcomingStart, type DayRule, type HasHours } from "../plan/days.ts";
import { sessionEnd, unpickableReason } from "../plan/rules.ts";
import { DEFAULT_SIZE, SIZES, type Pick as PlanPick, type PlanDayState, type Size } from "../plan/types.ts";
import { PlanError, type NewPick, type PlanStore } from "../store/plan-store.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import { dayEndOf, hoursOn, type TimeModel } from "../week/hours.ts";
import type { PtoDay } from "../week/pto.ts";
import type { Half, IsoDate } from "../week/types.ts";
import type { ActionResponse } from "./types.ts";

export const PLAN_ACTIONS = ["planday.start", "planday.commit", "pick.add", "pick.remove", "pick.set_size", "pick.move", "pick.mark_done", "draft.add_story"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];
export const isPlanAction = (a: unknown): a is PlanAction => typeof a === "string" && (PLAN_ACTIONS as readonly string[]).includes(a);

export type PlanContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "lookup">;
  /** PTO on a date (step 6), or null. A full PTO day takes no picks. */
  pto?: (cfg: AppConfig, date: IsoDate) => Promise<PtoDay | null>;
  /** PTO dates from a Monday for about five weeks (the same read as week.load's look-ahead), for the carry-over day. */
  ptoAhead?: (cfg: AppConfig, monday: IsoDate) => Promise<ReadonlySet<IsoDate>>;
  /** The real clock (ISO instant). Past days and the carry-over day are judged by it, never by the UI. */
  now: () => string;
};

/** Whether a date has working hours or a flex session (D127): the one plannability rule, from the time model. */
export function hasHoursOn(plan: PlanStore | undefined, model: TimeModel, date: IsoDate): boolean {
  return hoursOn(model, date).segments.length > 0 || (plan?.flexBetween(date, date).length ?? 0) > 0;
}

/** Today, the first upcoming day and the plannability rule, in the configured zone. */
async function clock(ctx: PlanContext): Promise<{ cfg: AppConfig | null; today: IsoDate; upcoming: IsoDate; model: TimeModel; hasHours: HasHours }> {
  const cfg = await ctx.config();
  const model = cfg?.week.hours ?? defaultWeekConfig.hours;
  const now = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(model.timeZone);
  const today = now.toPlainDate().toString();
  const hasHours: HasHours = (d) => hasHoursOn(ctx.plan, model, d);
  return { cfg, today, upcoming: upcomingStart(now, dayEndOf(model, today) ?? "24:00"), model, hasHours };
}

async function ptoOf(ctx: PlanContext, cfg: AppConfig | null, d: IsoDate): Promise<PtoDay | null> {
  return ctx.pto && cfg ? ctx.pto(cfg, d).catch(() => null) : null;
}

/** The day rule for a date: PTO and days without working hours are refused; earlier days are past. */
async function ruleFor(ctx: PlanContext, d: IsoDate): Promise<DayRule> {
  const { cfg, today, hasHours } = await clock(ctx);
  return dayRule(d, today, await ptoOf(ctx, cfg, d), hasHours(d));
}

/** Refuses a full PTO day with a plain reason; null when the day can take picks. */
async function ptoRefusal(ctx: PlanContext, d: IsoDate): Promise<string | null> {
  const { cfg, today, hasHours } = await clock(ctx);
  const r = dayRule(d, today, await ptoOf(ctx, cfg, d), hasHours(d));
  return !r.ok && r.kind === "pto" ? r.reason : null;
}

const pastReason = (d: IsoDate) => `${dayLabel(d)} is past. Its picks can only be ticked done or dropped`;

/** Refuses changes to a past day (anything but done and drop), with the reason; null when allowed. */
async function pastRefusal(ctx: PlanContext, d: IsoDate): Promise<string | null> {
  const { today } = await clock(ctx);
  return d < today ? pastReason(d) : null;
}

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
class Invalid extends Error {}

type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
function date(v: unknown, name = "date"): IsoDate {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid(`${name} must be YYYY-MM-DD`);
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid(`${name} must be a real date`);
  }
}
function half(v: unknown): Half {
  if (v !== "AM" && v !== "PM" && v !== "EVE") throw new Invalid("half must be AM, PM or EVE");
  return v;
}
function id(v: unknown, name = "id"): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
}
function size(v: unknown): Size {
  if (v === undefined) return DEFAULT_SIZE;
  if (typeof v === "string" && (SIZES as readonly string[]).includes(v)) return v as Size;
  throw new Invalid("size must be S, M or L. Nothing above L: split it first");
}
function text(v: unknown, name: string, max = 200): string {
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) throw new Invalid(`${name} can't be empty`);
  if (t.length > max) throw new Invalid(`${name} must be ${max} characters or fewer`);
  return t;
}
const clientKey = (v: unknown) => text(v, "clientKey", 100);
const bool = (v: unknown, name: string) => {
  if (typeof v !== "boolean") throw new Invalid(`${name} must be true or false`);
  return v;
};

/** The carry-over day: the earliest upcoming, plannable, uncommitted day (plan/days.ts). */
async function carryDay(ctx: PlanContext, plan: PlanStore): Promise<{ target: IsoDate | null; upcoming: IsoDate }> {
  const { cfg, upcoming, hasHours } = await clock(ctx);
  const monday = Temporal.PlainDate.from(upcoming).subtract({ days: Temporal.PlainDate.from(upcoming).dayOfWeek - 1 }).toString();
  const pto = ctx.ptoAhead && cfg ? await ctx.ptoAhead(cfg, monday).catch(() => new Set<IsoDate>()) : new Set<IsoDate>();
  return { target: carryTarget(upcoming, (d) => !!plan.day(d)?.committedAt, pto, hasHours), upcoming };
}

/** A pick whose evening or weekend session hasn't ended yet by the server's clock (Q45): not carry-over yet. */
function pendingSession(ctx: PlanContext, plan: PlanStore, cfg: AppConfig | null): (p: PlanPick) => boolean {
  const model = cfg?.week.hours ?? defaultWeekConfig.hours;
  const now = Temporal.Instant.from(ctx.now());
  return (p) => {
    // Flex ends are date-times; as local times on the pick's date (a session past midnight counts as midnight).
    const flexEnds = plan.flexBetween(p.date, p.date).map((f) => {
      const z = Temporal.Instant.from(f.end).toZonedDateTimeISO(model.timeZone);
      return z.toPlainDate().toString() > p.date ? "24:00" : z.toPlainTime().toString({ smallestUnit: "minute" });
    });
    const end = sessionEnd(p, hoursOn(model, p.date), flexEnds);
    if (!end) return false;
    const [h, m] = end.split(":").map(Number) as [number, number];
    const at = Temporal.PlainDate.from(p.date).toZonedDateTime({ timeZone: model.timeZone }).add({ hours: h, minutes: m });
    return Temporal.Instant.compare(now, at.toInstant()) < 0;
  };
}

async function state(ctx: PlanContext, plan: PlanStore, d: IsoDate, opened = true): Promise<PlanDayState> {
  const { today, cfg } = await clock(ctx);
  const day = plan.start(d);
  const carry = await carryDay(ctx, plan);
  // Unfinished picks from before the first upcoming day, offered only on the carry-over day.
  const carryOver = carry.target === d ? plan.carryOverFor(carry.upcoming, cfg?.plan.carryDays, pendingSession(ctx, plan, cfg)) : [];
  const picks = plan.picksFor(d);
  // Focused seconds per pick (step 6d): the day's picks and the carry-over offered.
  const focused = plan.focusedSeconds([...picks, ...carryOver].map((p) => p.id));
  // Where I left off per client (step 7): the latest resume note on or before this day.
  const resumeNotes = Object.fromEntries(Object.entries(plan.latestNotes(d)).map(([k, n]) => [k, { clientKey: n.clientKey, date: n.date, note: n.note }]));
  // Committed features of this date's week (step 8).
  const monday = Temporal.PlainDate.from(d).subtract({ days: Temporal.PlainDate.from(d).dayOfWeek - 1 }).toString();
  const weekFeatures = plan.weekPlan(monday).features.map((f) => ({ clientKey: f.clientKey, itemId: f.itemId, title: f.title, url: f.url, slots: f.slots }));
  return { date: d, plan: day, picks, carryOver, carryTarget: carry.target, access: d < today ? "past" : "plan", drafts: plan.drafts(), opened, focused, resumeNotes, weekFeatures };
}

export async function planAction(ctx: PlanContext, action: PlanAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store is not available", 503);
  try {
    switch (action) {
      case "planday.start": {
        const o = fields(input, ["date"], ["auto"]);
        const d = date(o.date);
        const auto = o.auto === undefined ? false : bool(o.auto, "auto");
        const rule = await ruleFor(ctx, d);
        if (!rule.ok) return bad(rule.reason, 422);
        // An automatic open happens once per day, and never for a day already committed.
        const opened = !auto || (!plan.day(d)?.committedAt && plan.markOnce("plan_day_auto", d));
        return { ok: true, data: await state(ctx, plan, d, opened) };
      }
      case "planday.commit": {
        const d = date(fields(input, ["date"]).date);
        const rule = await ruleFor(ctx, d);
        if (!rule.ok) return bad(rule.reason, 422);
        if (rule.access === "past") return bad(pastReason(d), 409);
        plan.commit(d);
        return { ok: true, data: await state(ctx, plan, d) };
      }
      case "pick.add": {
        const o = fields(input, ["date", "half", "clientKey"], ["size", "itemId", "intention", "draftId"]);
        const base = { date: date(o.date), half: half(o.half), clientKey: clientKey(o.clientKey), size: size(o.size) };
        const given = ["itemId", "intention", "draftId"].filter((k) => o[k] !== undefined);
        if (given.length !== 1) throw new Invalid("give exactly one of itemId, intention or draftId");
        const off = await ptoRefusal(ctx, base.date);
        if (off) return bad(off, 422);
        const past = await pastRefusal(ctx, base.date);
        if (past) return bad(past, 409);
        let p: NewPick;
        if (o.itemId !== undefined) {
          const itemId = id(o.itemId, "itemId");
          const cfg = await ctx.config();
          if (!cfg) return bad("Fix the config first", 409);
          const item = ctx.devops(cfg).lookup(base.clientKey, itemId);
          if (!item) return bad(`Item ${itemId} is not among the loaded DevOps items for ${base.clientKey}. Refresh and try again`, 409);
          const why = unpickableReason(item);
          if (why) return bad(why, 422);
          const dup = plan.picksFor(base.date).find((x) => x.itemId === itemId && x.clientKey === base.clientKey && (x.status === "planned" || x.status === "done"));
          if (dup) return bad(`Item ${itemId} is already picked for ${dup.half} that day`, 409);
          p = { ...base, kind: "item", itemId, title: item.title, itemType: item.type, itemUrl: item.url.startsWith("https://dev.azure.com/") ? item.url : null };
        } else if (o.draftId !== undefined) {
          const draft = plan.getDraft(id(o.draftId, "draftId"));
          if (!draft || draft.clientKey !== base.clientKey) return bad("No such draft story for this client", 404);
          p = { ...base, kind: "draft", draftId: draft.id, title: draft.title, itemType: "Draft story" };
        } else {
          p = { ...base, kind: "intention", title: text(o.intention, "intention") };
        }
        const pick = plan.addPick(p);
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date) } };
      }
      case "pick.remove": {
        const pid = id(fields(input, ["id"]).id);
        const before = plan.getPick(pid);
        if (!before) return bad(`No pick ${pid}`, 404);
        // On a past day nothing is deleted: the pick is kept as dropped, so the record of the day stays.
        const r = (await pastRefusal(ctx, before.date)) ? { result: "dropped" as const, pick: plan.drop(pid) } : plan.removePick(pid);
        return { ok: true, data: { result: r.result, state: await state(ctx, plan, before.date) } };
      }
      case "pick.set_size": {
        const o = fields(input, ["id", "size"]);
        const pid = id(o.id);
        const sz = size(o.size);
        const before = plan.getPick(pid);
        if (!before) return bad(`No pick ${pid}`, 404);
        const past = await pastRefusal(ctx, before.date);
        if (past) return bad(past, 409);
        const pick = plan.setSize(pid, sz);
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date) } };
      }
      case "pick.move": {
        const o = fields(input, ["id", "date", "half"]);
        const pid = id(o.id);
        const before = plan.getPick(pid);
        if (!before) return bad(`No pick ${pid}`, 404);
        const to = date(o.date);
        const h = half(o.half);
        const off = await ptoRefusal(ctx, to);
        if (off) return bad(off, 422);
        // Into a past day never; out of a past day only forward to today or later (that is carrying it).
        const past = await pastRefusal(ctx, to);
        if (past) return bad(`${past}. Move it to today or a later day`, 409);
        const pick = plan.move(pid, to, h);
        return { ok: true, data: { pick, state: await state(ctx, plan, before.date) } };
      }
      case "pick.mark_done": {
        const o = fields(input, ["id", "done"]);
        const pick = plan.setDone(id(o.id), bool(o.done, "done"));
        return { ok: true, data: { pick } };
      }
      case "draft.add_story": {
        const o = fields(input, ["clientKey", "parentItemId", "title"], ["size"]);
        const key = clientKey(o.clientKey);
        const parentItemId = id(o.parentItemId, "parentItemId");
        const title = text(o.title, "title");
        const sz = size(o.size);
        const cfg = await ctx.config();
        if (!cfg) return bad("Fix the config first", 409);
        const parent = ctx.devops(cfg).lookup(key, parentItemId);
        if (!parent) return bad(`Item ${parentItemId} is not among the loaded DevOps items for ${key}. Refresh and try again`, 409);
        if (parent.level !== "portfolio") return bad("Draft stories go under an epic or feature; this item can be picked directly", 422);
        return { ok: true, data: { draft: plan.addDraft({ clientKey: key, parentItemId, title, size: sz }) } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
