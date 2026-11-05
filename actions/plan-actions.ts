// Plan the day actions (step 5). Local only: they read DevOps results already in memory to check a pick,
// and write only to the local plan store. Nothing here calls DevOps, Outlook, Google or Dataverse.
import { isOpen } from "../plan/process.ts";
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { AppConfig } from "../config/schema.ts";
import { carryTarget, dayLabel, dayRule, SCAN_DAYS, upcomingStart, type DayRule, type HasHours } from "../plan/days.ts";
import { alreadyPlanned } from "../plan/dup.ts";
import { sessionEnd, unpickableReason } from "../plan/rules.ts";
import { DEFAULT_SIZE, SIZES, type Pick as PlanPick, type PlanDayState, type Size } from "../plan/types.ts";
import { PlanError, type DraftPatch, type NewPick, type PlanStore } from "../store/plan-store.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import { dayEndOf, hoursOn, noHoursPrompt, type TimeModel } from "../week/hours.ts";
import type { PtoDay } from "../week/pto.ts";
import type { Half, IsoDate } from "../week/types.ts";
import type { ActionResponse } from "./types.ts";
import { userZone } from "../week/zone.ts";

export const PLAN_ACTIONS = ["planday.start", "planday.commit", "pick.add", "pick.remove", "pick.set_size", "pick.move", "pick.mark_done", "draft.add_story", "draft.set_parent", "draft.remove", "draft.update"] as const;
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
export async function hasHoursOn(plan: PlanStore | undefined, model: TimeModel, date: IsoDate): Promise<boolean> {
  return hoursOn(model, date).segments.length > 0 || ((await plan?.flexBetween(date, date))?.length ?? 0) > 0;
}

/**
 * The same rule for every date within SCAN_DAYS of `from` (the day stepper and the carry-over target look that far),
 * with the flex sessions read once (A3: the rule is a plain function, and the store is async).
 */
export async function hasHoursNear(plan: PlanStore | undefined, model: TimeModel, from: IsoDate): Promise<HasHours> {
  const d = Temporal.PlainDate.from(from);
  const flex = new Set(plan ? (await plan.flexDays(d.subtract({ days: SCAN_DAYS + 1 }).toString(), d.add({ days: SCAN_DAYS + 1 }).toString())).map((f) => f.date) : []);
  return (x) => hoursOn(model, x).segments.length > 0 || flex.has(x);
}

/** Which days from `from` (SCAN_DAYS on) are committed, read once. */
export async function committedNear(plan: PlanStore, from: IsoDate): Promise<(d: IsoDate) => boolean> {
  const to = Temporal.PlainDate.from(from).add({ days: SCAN_DAYS + 1 }).toString();
  const days = new Set((await plan.dayPlansBetween(from, to)).filter((p) => p.committedAt).map((p) => p.date));
  return (d) => days.has(d);
}

/** Today, the first upcoming day and the plannability rule, in the configured zone. */
async function clock(ctx: PlanContext): Promise<{ cfg: AppConfig | null; today: IsoDate; upcoming: IsoDate; model: TimeModel; hasHours: (d: IsoDate) => Promise<boolean> }> {
  const cfg = await ctx.config();
  const model = cfg?.week.hours ?? defaultWeekConfig.hours;
  const now = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(userZone(model));
  const today = now.toPlainDate().toString();
  const hasHours = (d: IsoDate) => hasHoursOn(ctx.plan, model, d);
  return { cfg, today, upcoming: upcomingStart(now, dayEndOf(model, today) ?? "24:00"), model, hasHours };
}

async function ptoOf(ctx: PlanContext, cfg: AppConfig | null, d: IsoDate): Promise<PtoDay | null> {
  return ctx.pto && cfg ? ctx.pto(cfg, d).catch(() => null) : null;
}

/** The day rule for a date: PTO and days without working hours are refused; earlier days are past. */
async function ruleFor(ctx: PlanContext, d: IsoDate): Promise<DayRule> {
  const { cfg, today, hasHours } = await clock(ctx);
  return dayRule(d, today, await ptoOf(ctx, cfg, d), await hasHours(d));
}

/** Refuses a full PTO day with a plain reason; null when the day can take picks. */
async function ptoRefusal(ctx: PlanContext, d: IsoDate): Promise<string | null> {
  const { cfg, today, hasHours } = await clock(ctx);
  const r = dayRule(d, today, await ptoOf(ctx, cfg, d), await hasHours(d));
  return !r.ok && r.kind === "pto" ? r.reason : null;
}

const pastReason = (d: IsoDate) => `${dayLabel(d)} is past. Its picks can only be ticked done or dropped`;

/** Refuses changes to a past day (anything but done and drop), with the reason; null when allowed. */
async function pastRefusal(ctx: PlanContext, d: IsoDate): Promise<string | null> {
  const { today } = await clock(ctx);
  return d < today ? pastReason(d) : null;
}

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
const HALF_WORD: Record<Half, string> = { AM: "the morning", PM: "the afternoon", EVE: "the evening" };
/** Step 15.1 (D277): the same item in the same block is "Already planned here"; in the other half of the day, say which. */
const dupRefusal = (has: Half, want: Half): ActionResponse =>
  has === want ? { ok: false, status: 409, error: "Already planned here", code: "duplicate" } : bad(`Already planned for ${HALF_WORD[has]} that day`, 409);
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
/** A pick's size: S, M or L, or none (E2: not sized yet, counts as 2h; sizing is optional). */
function size(v: unknown): Size | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && (SIZES as readonly string[]).includes(v)) return v as Size;
  throw new Invalid("size must be S, M or L. Nothing above L: split it first");
}
/** A draft story keeps a size (M when not given). */
const draftSize = (v: unknown): Size => size(v) ?? DEFAULT_SIZE;
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
  const { cfg, upcoming, model } = await clock(ctx);
  const monday = Temporal.PlainDate.from(upcoming).subtract({ days: Temporal.PlainDate.from(upcoming).dayOfWeek - 1 }).toString();
  const pto = ctx.ptoAhead && cfg ? await ctx.ptoAhead(cfg, monday).catch(() => new Set<IsoDate>()) : new Set<IsoDate>();
  return { target: carryTarget(upcoming, await committedNear(plan, upcoming), pto, await hasHoursNear(plan, model, upcoming)), upcoming };
}

/** A pick whose evening or weekend session hasn't ended yet by the server's clock (Q45): not carry-over yet. */
async function pendingSession(ctx: PlanContext, plan: PlanStore, cfg: AppConfig | null, upcoming: IsoDate): Promise<(p: PlanPick) => boolean> {
  const model = cfg?.week.hours ?? defaultWeekConfig.hours;
  const now = Temporal.Instant.from(ctx.now());
  // The flex sessions of the days carry-over looks back over (the store's carryOverFor reads the same span).
  const from = Temporal.PlainDate.from(upcoming).subtract({ days: Math.max(14, cfg?.plan.carryDays ?? 0) }).toString();
  const flex = await plan.flexDays(from, upcoming);
  return (p) => {
    // Flex ends are date-times; as local times on the pick's date (a session past midnight counts as midnight).
    const flexEnds = flex.filter((f) => f.date === p.date).map(({ flex: f }) => {
      const z = Temporal.Instant.from(f.end).toZonedDateTimeISO(userZone(model));
      return z.toPlainDate().toString() > p.date ? "24:00" : z.toPlainTime().toString({ smallestUnit: "minute" });
    });
    const end = sessionEnd(p, hoursOn(model, p.date), flexEnds);
    if (!end) return false;
    const [h, m] = end.split(":").map(Number) as [number, number];
    const at = Temporal.PlainDate.from(p.date).toZonedDateTime({ timeZone: userZone(model) }).add({ hours: h, minutes: m });
    return Temporal.Instant.compare(now, at.toInstant()) < 0;
  };
}

async function state(ctx: PlanContext, plan: PlanStore, d: IsoDate, opened = true): Promise<PlanDayState> {
  const { today, cfg } = await clock(ctx);
  const day = (await plan.start(d));
  const carry = await carryDay(ctx, plan);
  // Unfinished picks from before the first upcoming day, offered only on the carry-over day.
  const carryOver = carry.target === d ? (await plan.carryOverFor(carry.upcoming, cfg?.plan.carryDays, await pendingSession(ctx, plan, cfg, carry.upcoming))) : [];
  const picks = (await plan.picksFor(d));
  // Focused seconds per pick (step 6d): the day's picks and the carry-over offered.
  const focused = (await plan.focusedSeconds([...picks, ...carryOver].map((p) => p.id)));
  // Where I left off per client (step 7): the latest resume note on or before this day.
  const resumeNotes = Object.fromEntries(Object.entries((await plan.latestNotes(d))).map(([k, n]) => [k, { clientKey: n.clientKey, date: n.date, note: n.note }]));
  // Committed features of this date's week (step 8).
  const monday = Temporal.PlainDate.from(d).subtract({ days: Temporal.PlainDate.from(d).dayOfWeek - 1 }).toString();
  const weekFeatures = (await plan.weekPlan(monday)).features.map((f) => ({ clientKey: f.clientKey, itemId: f.itemId, title: f.title, url: f.url, slots: f.slots, level: f.level, tier: f.tier, estimate: f.estimate, size: f.size, parentId: f.parentId, position: f.position, doneAt: f.doneAt }));
  return { date: d, plan: day, picks, carryOver, carryTarget: carry.target, access: d < today ? "past" : "plan", drafts: (await plan.drafts()), opened, focused, resumeNotes, weekFeatures };
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
        const opened = !auto || (!(await plan.day(d))?.committedAt && (await plan.markOnce("plan_day_auto", d)));
        return { ok: true, data: await state(ctx, plan, d, opened) };
      }
      case "planday.commit": {
        const d = date(fields(input, ["date"]).date);
        const rule = await ruleFor(ctx, d);
        if (!rule.ok) return bad(rule.reason, 422);
        if (rule.access === "past") return bad(pastReason(d), 409);
        (await plan.commit(d));
        return { ok: true, data: await state(ctx, plan, d) };
      }
      case "pick.add": {
        const o = fields(input, ["date", "half", "clientKey"], ["size", "itemId", "intention", "draftId", "followUpId"]);
        // Step 13.5: a follow-up picked into a block is size S unless sized.
        const base = { date: date(o.date), half: half(o.half), clientKey: clientKey(o.clientKey), size: o.size === undefined && o.followUpId !== undefined ? ("S" as const) : size(o.size) };
        const given = ["itemId", "intention", "draftId", "followUpId"].filter((k) => o[k] !== undefined);
        if (given.length !== 1) throw new Invalid("give exactly one of itemId, intention, draftId or followUpId");
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
          const dup = (await plan.picksFor(base.date)).find((x) => x.itemId === itemId && x.clientKey === base.clientKey && (x.status === "planned" || x.status === "done"));
          if (dup) return dupRefusal(dup.half, base.half);
          p = { ...base, kind: "item", itemId, title: item.title, itemType: item.type, itemUrl: item.url.startsWith("https://dev.azure.com/") ? item.url : null };
        } else if (o.draftId !== undefined) {
          const draft = (await plan.getDraft(id(o.draftId, "draftId")));
          if (!draft || draft.clientKey !== base.clientKey) return bad("No such draft story for this client", 404);
          const dup = alreadyPlanned((await plan.picksFor(base.date)), { clientKey: base.clientKey, draftId: draft.id }, base.date, base.half);
          if (dup) return dupRefusal(dup.half, base.half);
          p = { ...base, kind: "draft", draftId: draft.id, title: draft.title, itemType: draft.level === "feature" ? "Draft feature" : "Draft story" };
        } else if (o.followUpId !== undefined) {
          const f = (await plan.getFollowUp(id(o.followUpId, "followUpId")));
          if (!f) return bad("No such follow-up", 404);
          if (f.closedAt) return bad("That follow-up is already closed", 409);
          const dup = (await plan.picksFor(base.date)).find((x) => x.followUpId === f.id && (x.status === "planned" || x.status === "done"));
          if (dup) return dupRefusal(dup.half, base.half);
          p = { ...base, kind: "intention", title: f.what.slice(0, 200), itemType: "Follow-up", followUpId: f.id };
        } else {
          p = { ...base, kind: "intention", title: text(o.intention, "intention") };
        }
        const pick = (await plan.addPick(p));
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date) } };
      }
      case "pick.remove": {
        const pid = id(fields(input, ["id"]).id);
        const before = (await plan.getPick(pid));
        if (!before) return bad(`No pick ${pid}`, 404);
        // On a past day nothing is deleted: the pick is kept as dropped, so the record of the day stays.
        const r = (await pastRefusal(ctx, before.date)) ? { result: "dropped" as const, pick: (await plan.drop(pid)) } : (await plan.removePick(pid));
        return { ok: true, data: { result: r.result, state: await state(ctx, plan, before.date) } };
      }
      case "pick.set_size": {
        const o = fields(input, ["id", "size"]);
        const pid = id(o.id);
        const sz = size(o.size);
        const before = (await plan.getPick(pid));
        if (!before) return bad(`No pick ${pid}`, 404);
        const past = await pastRefusal(ctx, before.date);
        if (past) return bad(past, 409);
        const pick = (await plan.setSize(pid, sz));
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date) } };
      }
      case "pick.move": {
        const o = fields(input, ["id", "date", "half"], ["anyway"]);
        const pid = id(o.id);
        const before = (await plan.getPick(pid));
        if (!before) return bad(`No pick ${pid}`, 404);
        const to = date(o.date);
        if (o.anyway !== undefined && typeof o.anyway !== "boolean") throw new Invalid("anyway must be true or false");
        const h = half(o.half);
        const off = await ptoRefusal(ctx, to);
        if (off) return bad(off, 422);
        // Into a past day never; out of a past day only forward to today or later (that is carrying it).
        const past = await pastRefusal(ctx, to);
        if (past) return bad(`${past}. Move it to today or a later day`, 409);
        // Step 13.5: a day with no working hours asks first (Add hours, or Move anyway).
        const cfgNow = await ctx.config().catch(() => null);
        const ask = o.anyway === true || !cfgNow ? null : noHoursPrompt(cfgNow.week.hours, to, Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(userZone(cfgNow)).toPlainDate().toString());
        if (ask) return { ok: false, status: 409, error: ask, code: "no_hours" };
        // Step 15.1 (D277): never two copies of one item in a block.
        if (alreadyPlanned((await plan.picksFor(to)), before, to, h, pid)) return { ok: false, status: 409, error: "Already planned here", code: "duplicate" };
        const pick = (await plan.move(pid, to, h));
        return { ok: true, data: { pick, state: await state(ctx, plan, before.date) } };
      }
      case "pick.mark_done": {
        const o = fields(input, ["id", "done"]);
        const pick = (await plan.setDone(id(o.id), bool(o.done, "done")));
        return { ok: true, data: { pick } };
      }
      case "draft.add_story": {
        const o = fields(input, ["clientKey", "parentItemId", "title"], ["size"]);
        const key = clientKey(o.clientKey);
        // Step 11: a draft can have no feature yet (an intention made a draft: "nudge to make them drafts").
        const parentItemId = o.parentItemId === null ? null : id(o.parentItemId, "parentItemId");
        const title = text(o.title, "title");
        const sz = draftSize(o.size);
        const cfg = await ctx.config();
        if (!cfg) return bad("Fix the config first", 409);
        if (parentItemId === null) return { ok: true, data: { draft: (await plan.addDraft({ clientKey: key, parentItemId: null, title, size: sz })) } };
        const parent = ctx.devops(cfg).lookup(key, parentItemId);
        if (!parent) return bad(`Item ${parentItemId} is not among the loaded DevOps items for ${key}. Refresh and try again`, 409);
        if (parent.level !== "portfolio") return bad("Draft stories go under an epic or feature; this item can be picked directly", 422);
        return { ok: true, data: { draft: (await plan.addDraft({ clientKey: key, parentItemId, title, size: sz })) } };
      }
      case "draft.set_parent": {
        // Step 14.5 (D257): a draft needs a parent before it can be created in DevOps. A story goes under an open
        // feature, a draft feature under an open epic, of the draft's own client, from the loaded DevOps items.
        const o = fields(input, ["id", "parentItemId"]);
        const draft = (await plan.getDraft(id(o.id)));
        if (!draft || draft.devopsId) return bad("No such draft, or it is already in DevOps", 404);
        const parentItemId = id(o.parentItemId, "parentItemId");
        const cfg = await ctx.config();
        if (!cfg) return bad("Fix the config first", 409);
        const parent = ctx.devops(cfg).lookup(draft.clientKey, parentItemId);
        if (!parent) return bad(`Item ${parentItemId} is not among the loaded DevOps items for ${draft.clientKey}. Refresh and try again`, 409);
        const want = draft.level === "feature" ? "epic" : "feature";
        if (parent.level !== "portfolio" || (parent.tier ?? "feature") !== want) return bad(draft.level === "feature" ? "A draft feature goes under an epic" : "A draft story goes under a feature", 422);
        if (!isOpen(parent.stateCategory)) return bad(`#${parentItemId} is ${parent.state}; choose an open one`, 422);
        return { ok: true, data: { draft: (await plan.setDraftParent(draft.id, parentItemId)) } };
      }
      case "draft.update": {
        // Step 15.3: the draft editor. Local only; Create in DevOps writes these values later.
        const o = fields(input, ["id"], ["title", "description", "acceptance", "clientKey", "parentItemId", "size", "startDate", "targetDate"]);
        const draft = (await plan.getDraft(id(o.id)));
        if (!draft || draft.devopsId) return bad("No such draft, or it is already in DevOps", 404);
        const patch: DraftPatch = {};
        if (o.title !== undefined) patch.title = text(o.title, "title");
        const long = (v: unknown, name: string) => {
          if (v === null || v === "") return null;
          if (typeof v !== "string" || v.length > 8000) throw new Invalid(`${name} must be text of at most 8000 characters`);
          return v.trim() || null;
        };
        if (o.description !== undefined) patch.description = long(o.description, "description");
        if (o.acceptance !== undefined) {
          if (draft.level !== "story" && o.acceptance) return bad("Acceptance criteria are for stories", 422);
          patch.acceptance = long(o.acceptance, "acceptance");
        }
        if (o.size !== undefined) patch.size = draftSize(o.size);
        if (o.clientKey !== undefined) patch.clientKey = clientKey(o.clientKey);
        for (const k of ["startDate", "targetDate"] as const) {
          if (o[k] === undefined) continue;
          if (draft.level !== "feature" && o[k]) return bad("Start and target dates are for features", 422);
          patch[k] = o[k] === null || o[k] === "" ? null : date(o[k]);
        }
        const start = patch.startDate !== undefined ? patch.startDate : (draft.startDate ?? null);
        const target = patch.targetDate !== undefined ? patch.targetDate : (draft.targetDate ?? null);
        if (start && target && start > target) return bad("The start date is after the target date", 422);
        if (o.parentItemId !== undefined && o.parentItemId !== null) {
          const parentItemId = id(o.parentItemId, "parentItemId");
          const key = patch.clientKey ?? draft.clientKey;
          const cfg = await ctx.config();
          if (!cfg) return bad("Fix the config first", 409);
          const parent = ctx.devops(cfg).lookup(key, parentItemId);
          if (!parent) return bad(`Item ${parentItemId} is not among the loaded DevOps items for ${key}. Refresh and try again`, 409);
          const want = draft.level === "feature" ? "epic" : "feature";
          if (parent.level !== "portfolio" || (parent.tier ?? "feature") !== want) return bad(draft.level === "feature" ? "A draft feature goes under an epic" : "A draft story goes under a feature", 422);
          if (!isOpen(parent.stateCategory)) return bad(`#${parentItemId} is ${parent.state}; choose an open one`, 422);
          patch.parentItemId = parentItemId;
        } else if (o.parentItemId === null) patch.parentItemId = null;
        return { ok: true, data: { draft: (await plan.updateDraft(draft.id, patch)) } };
      }
      case "draft.remove": {
        const o = fields(input, ["id"]);
        (await plan.removeDraft(id(o.id)));
        return { ok: true, data: { removed: true } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
