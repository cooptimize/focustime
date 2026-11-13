// Plan the day actions (step 5). Local only: they read DevOps results already in memory to check a pick,
// and write only to the local plan store. Nothing here calls DevOps, Outlook, Google or Dataverse.
import { AnswersError, descriptionMax, parseAnswers } from "../plan/three-questions.ts";
import { markResolved, materializeCheckins } from "./carry-actions.ts";
import { removedNotice, resizedRemaining } from "../plan/progress.ts";
import { SIZE_MINUTES } from "../plan/types.ts";
import { isOpen, typeNeedsBreakdown } from "../plan/process.ts";
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { AppConfig } from "../config/schema.ts";
import { NOTHING_TO_CONFIRM_DAY } from "../plan/no-confirm.ts";
import { carryTarget, dayLabel, dayRule, placeNote, SCAN_DAYS, upcomingStart, type DayRule, type HasHours } from "../plan/days.ts";
import { alreadyPlanned } from "../plan/dup.ts";
import { SUGGEST_CLEARED, validClearKey } from "../plan/boardsuggest.ts";
import { sessionEnd, unpickableReason } from "../plan/rules.ts";
import { DEFAULT_SIZE, SIZES, type Pick as PlanPick, type PlanDayState, type Size, type TodoLink, type TodoWindow } from "../plan/types.ts";
import { DEPLOYMENT, windowHalf, windowMinutes, windowProblem } from "../plan/deploy.ts";
import { defaultKeys, groupsFor, resolveTicked, type ClientDeploy, type DeployItem } from "../plan/deploy-items.ts";
import { PlanError, type DraftPatch, type NewPick, type PlanStore } from "../store/plan-store.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import { dayEndOf, hoursOn, type TimeModel } from "../week/hours.ts";
import type { PtoDay } from "../week/pto.ts";
import type { Half, IsoDate } from "../week/types.ts";
import type { ActionResponse } from "./types.ts";
import { userZone } from "../week/zone.ts";

export const PLAN_ACTIONS = ["planday.start", "planday.carry", "planday.commit", "pick.add", "pick.remove", "pick.take_off", "pick.put_back", "pick.set_size", "pick.move", "pick.mark_done", "deploy.add", "pick.set_kind", "pick.uncarry", "pick.undrop", "planday.carry_hint", "suggest.load", "suggest.clear", "suggest.unclear", "draft.add_story", "draft.set_parent", "draft.remove", "draft.update"] as const;
/** UI-B: the marker kind for the suggested-cards hint, dismissed once. */
export const CARRY_HINT = "carry_hint";

export type PlanAction = (typeof PLAN_ACTIONS)[number];

export type PlanContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "lookup" | "last">;
  /** PTO on a date (step 6), or null. A full PTO day takes no picks. */
  pto?: (cfg: AppConfig, date: IsoDate) => Promise<PtoDay | null>;
  /** PTO dates from a Monday for about five weeks (the same read as week.load's look-ahead), for the carry-over day. */
  ptoAhead?: (cfg: AppConfig, monday: IsoDate) => Promise<ReadonlySet<IsoDate>>;
  /** The real clock (ISO instant). Past days and the carry-over day are judged by it, never by the UI. */
  now: () => string;
  /** PL-1: which of these DevOps items are resolved, closed or removed ("client\u0000id"); absent: none known. */
  resolved?: (cfg: AppConfig, items: readonly { clientKey: string; itemId: number | null }[]) => Promise<ReadonlySet<string>>;
  /**
   * CP-1: the client's open features (or epics) as the capture box and the draft editor offer them (the same read as
   * capture.features), for a parent the Week hasn't loaded (someone else's feature). Null when DevOps can't say.
   */
  openParents?: (clientKey: string, tier: "feature" | "epic") => Promise<readonly number[] | null>;
  /** WD-2 follow-up: one open item of a client I can see, from the central store (Ahead's read), or null. */
  storeItem?: (clientKey: string, itemId: number) => Promise<import("../week/types.ts").WorkItem | null>;
  /** DP-2: the client's data platform and its list of deployment items (Admin › Clients); absent: not set. */
  clientDeploy?: (clientKey: string) => Promise<ClientDeploy | null>;
};

/**
 * A draft's parent: an open feature (for a story) or epic (for a draft feature) of the draft's own client, from the
 * loaded DevOps items or, when the Week hasn't loaded it, the client's open ones as the lookups offer them (CP-1). The
 * create step checks it again in DevOps. Null when it's fine, else the refusal.
 */
async function parentProblem(ctx: PlanContext, cfg: AppConfig, clientKey: string, level: "story" | "feature", parentItemId: number): Promise<ActionResponse | null> {
  const want = level === "feature" ? "epic" : "feature";
  const parent = ctx.devops(cfg).lookup(clientKey, parentItemId);
  if (!parent) {
    const open = await ctx.openParents?.(clientKey, want).catch(() => null);
    if (open?.includes(parentItemId)) return null;
    return bad(`Item ${parentItemId} is not among the loaded DevOps items for ${clientKey}. Refresh and try again`, 409);
  }
  if (parent.level !== "portfolio" || (parent.tier ?? "feature") !== want) return bad(level === "feature" ? "A draft feature goes under an epic" : "A draft story goes under a feature", 422);
  if (!isOpen(parent.stateCategory)) return bad(`#${parentItemId} is ${parent.state}; choose an open one`, 422);
  return null;
}

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

/**
 * AS-2 (supersedes PV-1's PTO refusal and step 13.5's "Add hours for that day?"): where a to-do may go. The day never
 * refuses it; the only refusal is a day before today. QT-1: a block that ended earlier today takes work too (the
 * board is a punch list: something done this morning can still be put there and ticked). The note says what kind of
 * day it is (placeNote, the same words as the Board's drop tip).
 */
async function placeAt(ctx: PlanContext, d: IsoDate, _h: Half): Promise<{ ended: string | null; note: string | null }> {
  const { cfg, today, hasHours } = await clock(ctx);
  if (d < today) return { ended: `${pastReason(d)}. Move it to today or a later day`, note: null };
  const pto = await ptoOf(ctx, cfg, d);
  return { ended: null, note: placeNote(d, { pto: !!pto, hasHours: await hasHours(d) }) };
}

/** QT-1: the local timeboxes Take off answered for Undo: at most 4, each a start before its end, as instants. */
function putBackBoxes(v: unknown): { start: string; end: string }[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 4) throw new Invalid("boxes must be a list of at most 4");
  return v.map((x) => {
    const o = fields(x, ["start", "end"]);
    if (typeof o.start !== "string" || typeof o.end !== "string") throw new Invalid("a box needs a start and an end");
    let a: Temporal.Instant, b: Temporal.Instant;
    try {
      a = Temporal.Instant.from(o.start);
      b = Temporal.Instant.from(o.end);
    } catch {
      throw new Invalid("a box's start and end must be times");
    }
    if (Temporal.Instant.compare(a, b) >= 0) throw new Invalid("a box must start before it ends");
    return { start: o.start, end: o.end };
  });
}

const pastReason = (d: IsoDate) => `${dayLabel(d)} is past. Its to-dos can only be ticked done or dropped`;

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
const mondayOfDate = (d: IsoDate): IsoDate => {
  const p = Temporal.PlainDate.from(d);
  return p.subtract({ days: p.dayOfWeek - 1 }).toString();
};
/** WD-1: what pick.add's response said its add did to the week (afterPick in dispatch.ts), handed back by Undo. */
/** The add's Undo: the week and the feature it put there. CF-1: WD-1's week times (before, after) are accepted from an old tab and ignored. */
function weekUndo(v: unknown): { weekStart: IsoDate; featureId: number | null } {
  const o = fields(v, ["weekStart", "featureId"], ["before", "after"]);
  const weekStart = date(o.weekStart, "undo.weekStart");
  const featureId = o.featureId === null || o.featureId === undefined ? null : id(o.featureId, "undo.featureId");
  return { weekStart, featureId };
}

/** Whether anything of a feature is still placed in a week (the feature itself, one of its stories, or a draft under it). */
async function featureStillPlaced(ctx: PlanContext, plan: PlanStore, weekStart: IsoDate, featureId: number, clientKey: string): Promise<boolean> {
  const sunday = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
  const live = (await plan.picksBetween(weekStart, sunday)).filter((p) => p.clientKey === clientKey && (p.status === "planned" || p.status === "done"));
  if (!live.length) return false;
  const cfg = await ctx.config();
  const dv = cfg ? ctx.devops(cfg) : null;
  const drafts = live.some((p) => p.draftId !== null) ? await plan.drafts() : [];
  return live.some((p) => p.itemId === featureId || (p.itemId !== null && (dv?.lookup(clientKey, p.itemId) as { parentId?: number | null } | null | undefined)?.parentId === featureId) || (p.draftId !== null && drafts.some((d) => d.id === p.draftId && d.parentItemId === featureId)));
}
/** A pick's size: XS, S, M or L, or none (E2: not sized yet, counts as the person's assumption; sizing is optional). */
function size(v: unknown): Size | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && (SIZES as readonly string[]).includes(v)) return v as Size;
  throw new Invalid("size must be XS, S, M or L. Nothing above L: split it first");
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

/** WK-3: a deployment's window from { start, end } ("HH:MM"); a missing or bad one is refused in plain words. */
function deployWindow(o: Obj): TodoWindow {
  const problem = windowProblem({ start: o.start, end: o.end });
  if (problem) throw new Invalid(problem);
  return { start: o.start as string, end: o.end as string };
}
const deployNote = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 2000) throw new Invalid("note must be text of at most 2000 characters");
  return v.trim() || null;
};
/**
 * WK-3: the DevOps items a deployment covers: ids of the to-do's own client's loaded items (never another client's),
 * at most 20, with their titles; the to-do's own item first when it has one. A string is the refusal.
 */
async function deployLinks(ctx: PlanContext, key: string, v: unknown, own: number | null = null): Promise<TodoLink[] | null | string> {
  if (v !== undefined && v !== null && (!Array.isArray(v) || v.length > 20)) throw new Invalid("itemIds must be a list of at most 20 ids");
  const ids = [...new Set([...(own !== null ? [own] : []), ...((v as unknown[] | undefined) ?? []).map((x) => id(x, "itemIds"))])];
  if (!ids.length) return null;
  const cfg = await ctx.config();
  if (!cfg) return "Fix the config first";
  const dv = ctx.devops(cfg);
  const out: TodoLink[] = [];
  for (const i of ids) {
    const item = dv.lookup(key, i);
    if (!item) return `#${i} isn't among this client's loaded DevOps items. Refresh and try again`;
    out.push({ id: i, title: item.title });
  }
  return out;
}

/**
 * DP-2: the items a deployment ticks, as a snapshot: the keys sent, or with none sent this client's defaults (only for a
 * new deployment; one already planned keeps what it has). A string is the refusal.
 */
async function deployTicks(ctx: PlanContext, key: string, v: unknown, before: PlanPick | null): Promise<DeployItem[] | null | string> {
  if (v !== undefined && v !== null && (!Array.isArray(v) || v.length > 40 || v.some((k) => typeof k !== "string"))) throw new Invalid("items must be a list of at most 40 item keys");
  const existing = before?.todoKind === "deployment" ? (before.deployItems ?? null) : null;
  if ((v === undefined || v === null) && before?.todoKind === "deployment") return existing;
  const c = (await ctx.clientDeploy?.(key)) ?? null;
  const { items, unknown } = resolveTicked((v as string[] | undefined | null) ?? defaultKeys(groupsFor(c)), c, existing);
  if (unknown.length) return "That item isn't on this client's deployment list any more. Reload and try again";
  return items.length ? items : null;
}

/** The carry-over day: the earliest upcoming, plannable, uncommitted day (plan/days.ts). */
async function carryDay(ctx: PlanContext, plan: PlanStore): Promise<{ target: IsoDate | null; upcoming: IsoDate }> {
  const { cfg, upcoming, model } = await clock(ctx);
  const monday = Temporal.PlainDate.from(upcoming).subtract({ days: Temporal.PlainDate.from(upcoming).dayOfWeek - 1 }).toString();
  const pto = ctx.ptoAhead && cfg ? await ctx.ptoAhead(cfg, monday).catch(() => new Set<IsoDate>()) : new Set<IsoDate>();
  return { target: carryTarget(upcoming, pto, await hasHoursNear(plan, model, upcoming)), upcoming };
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
  // PL-1: a Watching check-in reserved on this day becomes a pick now that the day is opened.
  if (d >= today) await materializeCheckins(plan, d);
  const carry = await carryDay(ctx, plan);
  // Unfinished picks from before the first upcoming day, offered only on the carry-over day.
  const carryOver = carry.target === d ? (await plan.carryOverFor(carry.upcoming, cfg?.plan.carryDays, await pendingSession(ctx, plan, cfg, carry.upcoming))) : [];
  const picks0 = (await plan.picksFor(d));
  // PL-1: a pick of a resolved item counts zero and shows as done.
  const resolved = cfg && ctx.resolved ? await ctx.resolved(cfg, picks0).catch(() => new Set<string>()) : new Set<string>();
  const picks = resolved.size ? markResolved(picks0, resolved) : picks0;
  // Focused seconds per pick (step 6d): the day's picks and the carry-over offered.
  const focused = (await plan.focusedSeconds([...picks, ...carryOver].map((p) => p.id)));
  // Where I left off per client (step 7): the latest resume note on or before this day.
  const resumeNotes = Object.fromEntries(Object.entries((await plan.latestNotes(d))).map(([k, n]) => [k, { clientKey: n.clientKey, date: n.date, note: n.note }]));
  // Committed features of this date's week (step 8).
  const monday = Temporal.PlainDate.from(d).subtract({ days: Temporal.PlainDate.from(d).dayOfWeek - 1 }).toString();
  const weekFeatures = (await plan.weekPlan(monday)).features.map((f) => ({ id: f.id, clientKey: f.clientKey, itemId: f.itemId, title: f.title, url: f.url, slots: f.slots, level: f.level, estimate: f.estimate, size: f.size, parentId: f.parentId, position: f.position, doneAt: f.doneAt }));
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
        // An automatic open happens once per day (CF-1: there is no confirmed day to skip).
        const opened = !auto || (await plan.markOnce("plan_day_auto", d));
        return { ok: true, data: await state(ctx, plan, d, opened) };
      }
      case "planday.carry": {
        // NV-1: Week's "From last week": the carry-over day and its unfinished picks, read only (no day is opened).
        fields(input, [], []);
        const { cfg } = await clock(ctx);
        const carry = await carryDay(ctx, plan);
        const picks = carry.target ? await plan.carryOverFor(carry.upcoming, cfg?.plan.carryDays, await pendingSession(ctx, plan, cfg, carry.upcoming)) : [];
        // UI-B: the one-time hint over the suggested cards, until it is dismissed (a per-person marker).
        return { ok: true, data: { target: carry.target, picks, hint: !(await plan.marked(CARRY_HINT, "once")) } };
      }
      case "planday.carry_hint": {
        fields(input, [], []);
        await plan.markOnce(CARRY_HINT, "once");
        return { ok: true, data: { hint: false } };
      }
      case "suggest.load": {
        // SG-1: what the board's suggestion rule reads from the store: the unfinished to-dos (planday.carry's read)
        // and what was cleared. Nothing is stored for a suggestion itself.
        fields(input, [], []);
        const { cfg } = await clock(ctx);
        const carry = await carryDay(ctx, plan);
        const picks = carry.target ? await plan.carryOverFor(carry.upcoming, cfg?.plan.carryDays, await pendingSession(ctx, plan, cfg, carry.upcoming)) : [];
        const cleared = [...(await plan.markedDates(SUGGEST_CLEARED))].filter(validClearKey);
        return { ok: true, data: { picks, cleared } };
      }
      case "suggest.clear":
      case "suggest.unclear": {
        // SG-1: Clear on a row (that item, for its week), a block (for that day) or a day; Undo takes the mark away.
        // A per-person marker in the plan store (markers, kind sg_clear); nothing else changes.
        const o = fields(input, ["keys"], []);
        if (!Array.isArray(o.keys) || !o.keys.length || o.keys.length > 20 || o.keys.some((k) => typeof k !== "string" || !validClearKey(k))) throw new Invalid("keys must be 1 to 20 clear keys");
        for (const k of o.keys as string[]) {
          if (action === "suggest.clear") await plan.markOnce(SUGGEST_CLEARED, k);
          else await plan.unmark(SUGGEST_CLEARED, k);
        }
        return { ok: true, data: { cleared: [...(await plan.markedDates(SUGGEST_CLEARED))].filter(validClearKey) } };
      }
      case "pick.uncarry": {
        // UI-B: Undo of Keep or Move on an unfinished pick: the copy goes, the pick it came from is planned again.
        const pick = await plan.uncarry(id(fields(input, ["id"]).id));
        return { ok: true, data: { pick } };
      }
      case "pick.undrop": {
        // UI-B: Undo of Drop on an unfinished pick.
        const pick = await plan.undrop(id(fields(input, ["id"]).id));
        return { ok: true, data: { pick } };
      }
      case "planday.commit":
        // CF-1 (F3): nothing confirms a day now. An old tab or card that still asks gets a plain answer; nothing changes.
        return { ok: true, data: { unchanged: true, message: NOTHING_TO_CONFIRM_DAY } };
      case "pick.add": {
        const o = fields(input, ["date", "half", "clientKey"], ["size", "itemId", "intention", "draftId", "followUpId"]);
        // Step 13.5: a follow-up picked into a block is size S unless sized.
        const base = { date: date(o.date), half: half(o.half), clientKey: clientKey(o.clientKey), size: o.size === undefined && o.followUpId !== undefined ? ("S" as const) : size(o.size) };
        const given = ["itemId", "intention", "draftId", "followUpId"].filter((k) => o[k] !== undefined);
        if (given.length !== 1) throw new Invalid("give exactly one of itemId, intention, draftId or followUpId");
        // AS-2: a PTO day takes it too, with a note; a past day still refuses.
        const past = await pastRefusal(ctx, base.date);
        if (past) return bad(past, 409);
        const clk = await clock(ctx);
        const note = placeNote(base.date, { pto: !!(await ptoOf(ctx, clk.cfg, base.date)), hasHours: await clk.hasHours(base.date) });
        let p: NewPick;
        if (o.itemId !== undefined) {
          const itemId = id(o.itemId, "itemId");
          const cfg = await ctx.config();
          if (!cfg) return bad("Fix the config first", 409);
          // WD-2 follow-up: "More in <client>" lists the client's whole open backlog, so an item the Week didn't load
          // (a teammate's story under a feature that isn't mine) is read from the client's store, by my own access.
          const item = ctx.devops(cfg).lookup(base.clientKey, itemId) ?? (await ctx.storeItem?.(base.clientKey, itemId).catch(() => null)) ?? null;
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
        const pick = (await plan.addPick(p, clk.cfg?.plan.sizes));
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date), note } };
      }
      case "pick.remove": {
        const o = fields(input, ["id"], ["undo"]);
        const pid = id(o.id);
        const undo = o.undo === undefined ? null : weekUndo(o.undo);
        const before = (await plan.getPick(pid));
        if (!before) return bad(`No to-do ${pid}`, 404);
        if (undo && undo.weekStart !== mondayOfDate(before.date)) throw new Invalid("undo is for another week");
        // On a past day nothing is deleted: the pick is kept as dropped, so the record of the day stays.
        const r = (await pastRefusal(ctx, before.date)) ? { result: "dropped" as const, pick: (await plan.drop(pid)) } : (await plan.removePick(pid));
        // WD-1, CF-1: Undo of an add also takes back the feature the add put on the week, unless something else of it
        // is still placed that week.
        if (undo?.featureId != null && !(await featureStillPlaced(ctx, plan, undo.weekStart, undo.featureId, before.clientKey))) await plan.undoWeekAdd(undo.weekStart, undo.featureId);
        return { ok: true, data: { result: r.result, state: await state(ctx, plan, before.date) } };
      }
      case "pick.take_off": {
        // WD-2: Take off the plan. The to-do leaves its block and its work is "not placed" again; it is never marked
        // dropped by this (Drop is pick.remove). A plain to-do isn't destroyed: its words stay as a draft with no
        // feature, listed under To place. The answer says how Undo puts it back.
        const pid = id(fields(input, ["id"]).id);
        const before = await plan.getPick(pid);
        if (!before) return bad(`No to-do ${pid}`, 404);
        if (before.status === "done") return bad("A done to-do stays on its day. Mark it not done first", 409);
        if (before.status !== "planned") return bad("Only a planned to-do can be taken off the plan", 409);
        if (await pastRefusal(ctx, before.date)) return bad("A past day keeps its record. Move the to-do to today instead", 409);
        if (before.todoKind === "deployment") return bad("A deployment keeps its window. Move it or drop it instead", 409);
        const boxes = (await plan.timeboxesBetween(before.date, before.date)).filter((t) => t.pickId === pid && !t.removedAt);
        if (boxes.some((t) => t.outlook)) return bad("Its timebox is on Outlook. Remove the timebox first, then take the to-do off", 409);
        const at = { date: before.date, half: before.half, clientKey: before.clientKey, ...(before.size ? { size: before.size } : {}) };
        const plain = before.kind === "intention" && before.followUpId === null;
        const kind = plain ? "plain" : before.followUpId !== null ? "promise" : before.kind === "draft" ? "draft" : "item";
        // The row goes first (it refuses one with time on it or carried on), so nothing else changes on a refusal.
        await plan.takeOffPick(pid);
        for (const t of boxes) await plan.removeTimebox(t.id);
        const draft = plain ? await plan.addDraft({ clientKey: before.clientKey, parentItemId: null, title: before.title, size: before.size ?? "M" }) : null;
        const undo = {
          add: { ...at, ...(plain ? { intention: before.title } : before.followUpId !== null ? { followUpId: before.followUpId } : before.kind === "draft" ? { draftId: before.draftId } : { itemId: before.itemId }) },
          ...(draft ? { draftId: draft.id } : {}),
          ...(before.carriedFrom !== null ? { carriedFrom: before.carriedFrom } : {}),
          // QT-1 (WD-2 review): Undo puts a local timebox back at its time (an Outlook one never got this far).
          ...(boxes.length ? { boxes: boxes.map((t) => ({ start: t.start, end: t.end })) } : {}),
        };
        return { ok: true, data: { result: "deleted", kind, title: before.title, timeboxes: boxes.length, draftId: draft?.id ?? null, undo, state: await state(ctx, plan, before.date) } };
      }
      case "pick.put_back": {
        // WD-2: Undo of Take off the plan, from what pick.take_off answered: the to-do is added to its block again by
        // pick.add's own rules, a plain to-do's kept draft goes, and a carried one is linked to where it came from.
        const u = fields(fields(input, ["undo"]).undo, ["add"], ["draftId", "carriedFrom", "boxes"]);
        const boxes = putBackBoxes(u.boxes);
        const again = await planAction(ctx, "pick.add", u.add);
        if (!again.ok) return again;
        const pick = (again.data as { pick: import("../plan/types.ts").Pick }).pick;
        if (u.draftId !== undefined) {
          const d = id(u.draftId, "draftId");
          // Only the draft this take off made: one with no feature, with the to-do's own words, not on a block.
          const kept = (await plan.drafts()).find((x) => x.id === d);
          if (kept && kept.parentItemId === null && kept.title === pick.title && pick.kind === "intention") await plan.removeDraft(d).catch(() => undefined);
        }
        if (u.carriedFrom !== undefined) await plan.relinkCarried(pick.id, id(u.carriedFrom, "carriedFrom")).catch(() => undefined);
        // Only on the to-do's own day, local only (never Outlook): the time it had before Take off.
        for (const b of boxes) if (Temporal.Instant.from(b.start).toZonedDateTimeISO(userZone((await clock(ctx)).model)).toPlainDate().toString() === pick.date) await plan.addTimebox({ date: pick.date, clientKey: pick.clientKey, pickId: pick.id, itemId: pick.itemId, title: pick.title, url: pick.itemUrl, start: b.start, end: b.end, outlook: false });
        return { ok: true, data: { pick: (await plan.getPick(pick.id)) ?? pick, state: await state(ctx, plan, pick.date) } };
      }
      case "pick.set_size": {
        const o = fields(input, ["id", "size"]);
        const pid = id(o.id);
        const sz = size(o.size);
        const before = (await plan.getPick(pid));
        if (!before) return bad(`No to-do ${pid}`, 404);
        const past = await pastRefusal(ctx, before.date);
        if (past) return bad(past, 409);
        // TX-1: re-sizing work that's under way moves its time left by the same amount.
        const cfg = await ctx.config();
        const left = resizedRemaining(before.remainingMinutes, before.size, sz, cfg?.plan.sizes ?? SIZE_MINUTES);
        // TX-1b: re-sizing its week story to this size already moved it: once, not twice.
        const monday = Temporal.PlainDate.from(before.date).subtract({ days: Temporal.PlainDate.from(before.date).dayOfWeek - 1 }).toString();
        const already = before.itemId !== null && (await plan.itemAlreadySized(before.clientKey, before.itemId, sz, monday, { pickId: pid }));
        if (left !== null && !already) await plan.setRemaining(pid, left);
        const pick = (await plan.setSize(pid, sz));
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date) } };
      }
      case "pick.move": {
        const o = fields(input, ["id", "date", "half"], ["anyway"]);
        const pid = id(o.id);
        const before = (await plan.getPick(pid));
        if (!before) return bad(`No to-do ${pid}`, 404);
        const to = date(o.date);
        if (o.anyway !== undefined && typeof o.anyway !== "boolean") throw new Invalid("anyway must be true or false");
        // WK-3: a deployment's window decides its half on the new day (its times stay; Edit changes them).
        const h = before.todoKind === "deployment" && before.window ? windowHalf(hoursOn((await clock(ctx)).model, to), before.window) : half(o.half);
        // AS-2: never into a day before today (out of a past day only forward: that is carrying it). QT-1: today's ended
        // blocks take it. Any other day
        // takes it, with a note: PTO, a weekend, Friday's catch-up, no working hours. `anyway` is still accepted.
        const at = await placeAt(ctx, to, h);
        if (at.ended) return bad(at.ended, 409);
        // Step 15.1 (D277): never two copies of one item in a block.
        if (alreadyPlanned((await plan.picksFor(to)), before, to, h, pid)) return { ok: false, status: 409, error: "Already planned here", code: "duplicate" };
        const pick = (await plan.move(pid, to, h));
        return { ok: true, data: { pick, state: await state(ctx, plan, before.date), note: at.note } };
      }
      case "pick.mark_done": {
        const o = fields(input, ["id", "done"]);
        // TX-1c: the same rule as a check-in's Done (later to-dos of the story come off the plan); done: false puts them back.
        const { pick, removed } = await plan.tickDone(id(o.id), bool(o.done, "done"));
        return { ok: true, data: { pick, removed, notice: removedNotice(removed) } };
      }
      case "deploy.add": {
        // WK-3 (DP-0): a Deployment to-do: a client, a date and a window; items and a note optional. Local only.
        const o = fields(input, ["clientKey", "date", "start", "end"], ["title", "note", "itemIds", "items"]);
        const key = clientKey(o.clientKey);
        const d = date(o.date);
        const w = deployWindow(o);
        const past = await pastRefusal(ctx, d);
        if (past) return bad(past, 409);
        const links = await deployLinks(ctx, key, o.itemIds);
        if (typeof links === "string") return bad(links, 409);
        const deployItems = await deployTicks(ctx, key, o.items, null);
        if (typeof deployItems === "string") return bad(deployItems, 409);
        const clk = await clock(ctx);
        const note = placeNote(d, { pto: !!(await ptoOf(ctx, clk.cfg, d)), hasHours: await clk.hasHours(d) });
        const title = o.title === undefined || o.title === null || o.title === "" ? DEPLOYMENT : text(o.title, "title");
        const pick = await plan.addPick({
          date: d, half: windowHalf(hoursOn(clk.model, d), w), clientKey: key, kind: "intention", title, itemType: DEPLOYMENT, size: null,
          minutes: Math.min(480, windowMinutes(w)), todoKind: "deployment", window: w, links, deployItems, notes: deployNote(o.note),
        });
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date), note } };
      }
      case "pick.set_kind": {
        // WK-3: change a to-do's kind (to-do menu › Kind): a Deployment needs its window; back to a to-do clears it.
        const o = fields(input, ["id", "kind"], ["start", "end", "note", "itemIds", "items"]);
        const pid = id(o.id);
        const before = await plan.getPick(pid);
        if (!before) return bad(`No to-do ${pid}`, 404);
        const past = await pastRefusal(ctx, before.date);
        if (past) return bad(past, 409);
        if (o.kind === "todo") {
          if (o.start !== undefined || o.end !== undefined || o.itemIds !== undefined || o.items !== undefined) throw new Invalid("a plain to-do has no window or items");
          const pick = await plan.setTodoKind(pid, { todoKind: null, window: null, links: null, ...(before.itemType === DEPLOYMENT ? { itemType: null } : {}), minutes: null, ...(o.note !== undefined ? { notes: deployNote(o.note) } : {}) });
          return { ok: true, data: { pick, state: await state(ctx, plan, pick.date) } };
        }
        if (o.kind !== "deployment") throw new Invalid("kind must be todo or deployment");
        const w = deployWindow(o);
        const links = o.itemIds === undefined && before.todoKind === "deployment" ? (before.links ?? null) : await deployLinks(ctx, before.clientKey, o.itemIds, before.itemId);
        if (typeof links === "string") return bad(links, 409);
        const deployItems = await deployTicks(ctx, before.clientKey, o.items, before);
        if (typeof deployItems === "string") return bad(deployItems, 409);
        const { model } = await clock(ctx);
        const pick = await plan.setTodoKind(pid, {
          todoKind: "deployment", window: w, links, deployItems, half: windowHalf(hoursOn(model, before.date), w), minutes: Math.min(480, windowMinutes(w)),
          ...(before.kind === "intention" && !before.followUpId ? { itemType: DEPLOYMENT } : {}),
          ...(o.note !== undefined ? { notes: deployNote(o.note) } : {}),
        });
        return { ok: true, data: { pick, state: await state(ctx, plan, pick.date) } };
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
        const dv = ctx.devops(cfg);
        const parent = dv.lookup(key, parentItemId);
        if (!parent) return bad(`Item ${parentItemId} is not among the loaded DevOps items for ${key}. Refresh and try again`, 409);
        // BD-1: from the process model: a draft goes under a type that needs breaking down (an override can turn it off).
        if (parent.level !== "portfolio" || !typeNeedsBreakdown(dv.last(key)?.types, parent.type)) return bad("Draft items go under an item that needs breaking down; this item can be a to-do directly", 422);
        return { ok: true, data: { draft: (await plan.addDraft({ clientKey: key, parentItemId, title, size: sz })) } };
      }
      case "draft.set_parent": {
        // CP-1: the parent check is shared with draft.update (below).
        // Step 14.5 (D257): a draft needs a parent before it can be created in DevOps. A story goes under an open
        // feature, a draft feature under an open epic, of the draft's own client, from the loaded DevOps items.
        const o = fields(input, ["id", "parentItemId"]);
        const draft = (await plan.getDraft(id(o.id)));
        if (!draft || draft.devopsId) return bad("No such draft, or it is already in DevOps", 404);
        const parentItemId = id(o.parentItemId, "parentItemId");
        const cfg = await ctx.config();
        if (!cfg) return bad("Fix the config first", 409);
        const problem = await parentProblem(ctx, cfg, draft.clientKey, draft.level, parentItemId);
        if (problem) return problem;
        return { ok: true, data: { draft: (await plan.setDraftParent(draft.id, parentItemId)) } };
      }
      case "draft.update": {
        // Step 15.3: the draft editor. Local only; Create in DevOps writes these values later.
        const o = fields(input, ["id"], ["title", "description", "acceptance", "clientKey", "parentItemId", "size", "startDate", "targetDate", "answers"]);
        const draft = (await plan.getDraft(id(o.id)));
        if (!draft || draft.devopsId) return bad("No such draft, or it is already in DevOps", 404);
        const patch: DraftPatch = {};
        if (o.title !== undefined) patch.title = text(o.title, "title");
        const long = (v: unknown, name: string, max = 8000) => {
          if (v === null || v === "") return null;
          if (typeof v !== "string" || v.length > max) throw new Invalid(`${name} must be text of at most ${max} characters`);
          return v.trim() || null;
        };
        // TP-1b: a TP-1 draft's description is shown with its carried words; room for them so it still saves.
        if (o.description !== undefined) patch.description = long(o.description, "description", descriptionMax(draft.carried));
        if (o.acceptance !== undefined) {
          if (draft.level !== "story" && o.acceptance) return bad("Acceptance criteria are for stories", 422);
          patch.acceptance = long(o.acceptance, "acceptance");
        }
        if (o.size !== undefined) patch.size = draftSize(o.size);
        if (o.answers !== undefined) {
          // TP-1b: the three answers (null clears them).
          try {
            patch.answers = parseAnswers(o.answers);
          } catch (e) {
            if (e instanceof AnswersError) throw new Invalid(e.message);
            throw e;
          }
        }
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
          const problem = await parentProblem(ctx, cfg, key, draft.level, parentItemId);
          if (problem) return problem;
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
