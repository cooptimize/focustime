// TX-1: the check-in's answers. Local only: they write the plan store and never call DevOps, Outlook or Teams. The
// check-in itself shows in the two moments that already exist (Today's Midday check-in and Close out, and their Teams
// cards); these actions are what those moments call. Every answer applies at once and comes back with what Undo needs.
import { markResolved } from "./carry-actions.ts";
import type { AppConfig } from "../config/schema.ts";
import { outcomeOf, planOutcome, SESSION_ANSWERS, sessionRows, validLeft, type SessionAnswer } from "../plan/progress.ts";
import { SIZE_MINUTES } from "../plan/types.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { ActionResponse, SessionView } from "./types.ts";
import type { IsoDate } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";

export const PROGRESS_ACTIONS = ["checkin.sessions", "checkin.answer", "checkin.all_to_plan", "checkin.undo", "checkin.offer_close"] as const;
export type ProgressAction = (typeof PROGRESS_ACTIONS)[number];
export const CHECKIN_MOMENTS = ["midday", "end"] as const;
export type CheckinMoment = (typeof CHECKIN_MOMENTS)[number];
/** The plan store marker for a day's DevOps offer, made once: answered or skipped. */
export const PROGRESS_OFFER_MARK = "progress_offer";

export type ProgressContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  now: () => string;
  /** Which of these DevOps items are resolved, closed or removed ("client\u0000id"); absent: none known. */
  resolved?: (cfg: AppConfig, items: readonly { clientKey: string; itemId: number | null }[]) => Promise<ReadonlySet<string>>;
};

class Invalid extends Error {}
const isDate = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
function dateOf(v: unknown): IsoDate {
  if (!isDate(v)) throw new Invalid("date must be YYYY-MM-DD");
  return v;
}
function id(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
}

/**
 * What a check-in asks about. Midday asks only about today; end of day about the day being closed out, until it is
 * closed out: after that, unanswered timeboxes are left as they were and nothing asks again.
 */
export async function checkinSessions(ctx: ProgressContext, plan: PlanStore, date: IsoDate, moment: CheckinMoment): Promise<SessionView[]> {
  const cfg = await ctx.config();
  const zone = userZone(cfg?.week.hours ?? defaultWeekConfig.hours);
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(zone).toPlainDate().toString();
  if (date > today || (moment === "midday" && date !== today)) return [];
  if ((await plan.day(date))?.closedOutAt) return [];
  const boxes = await plan.timeboxesBetween(date, date);
  if (!boxes.some((b) => !b.removedAt && !b.settled && b.pickId !== null)) return [];
  let picks = await plan.picksFor(date);
  if (cfg && ctx.resolved) {
    const seen = await ctx.resolved(cfg, picks.filter((p) => p.itemId !== null)).catch(() => new Set<string>());
    if (seen.size) picks = markResolved(picks, seen);
  }
  const name = (k: string) => cfg?.clientSettings[k]?.name ?? k;
  return sessionRows(date, boxes, picks, ctx.now(), cfg?.plan.sizes ?? SIZE_MINUTES).map((r) => ({ ...r, clientName: name(r.clientKey) }));
}

async function run(ctx: ProgressContext, action: ProgressAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return { ok: false, status: 409, error: "Plan store isn't available" };
  const momentOf = (v: unknown): CheckinMoment => {
    if (!(CHECKIN_MOMENTS as readonly unknown[]).includes(v)) throw new Invalid('moment must be "midday" or "end"');
    return v as CheckinMoment;
  };
  switch (action) {
    case "checkin.sessions": {
      const o = fields(input, ["date", "moment"]);
      return { ok: true, data: { rows: await checkinSessions(ctx, plan, dateOf(o.date), momentOf(o.moment)) } };
    }
    case "checkin.answer": {
      const o = fields(input, ["date", "pickId", "answer", "moment"], ["left"]);
      const answer = o.answer as SessionAnswer;
      if (!SESSION_ANSWERS.includes(answer)) throw new Invalid("answer is done, partly or none");
      if (answer === "partly" && !validLeft(o.left)) throw new Invalid("left must be 5 minutes to 40 hours, in 5 minute steps");
      const pickId = id(o.pickId, "pickId");
      const row = (await checkinSessions(ctx, plan, dateOf(o.date), momentOf(o.moment))).find((r) => r.pickId === pickId);
      if (!row) return { ok: false, status: 409, error: "That timebox was already answered" };
      const p = await plan.getPick(pickId);
      const out = outcomeOf(answer, row, p?.spentMinutes ?? 0, o.left as number | undefined);
      await plan.settleSessions({ pickId, timeboxIds: row.timeboxIds, as: out.as, spent: out.spent, remaining: out.remaining });
      return { ok: true, data: { timeboxIds: row.timeboxIds, pick: await plan.getPick(pickId), as: out.as, remaining: out.remaining } };
    }
    case "checkin.all_to_plan": {
      const o = fields(input, ["date", "moment"]);
      const rows = await checkinSessions(ctx, plan, dateOf(o.date), momentOf(o.moment));
      const timeboxIds: number[] = [];
      const done: number[] = [];
      for (const row of rows) {
        const p = await plan.getPick(row.pickId);
        const out = planOutcome(row, p?.spentMinutes ?? 0);
        await plan.settleSessions({ pickId: row.pickId, timeboxIds: row.timeboxIds, as: out.as, spent: out.spent, remaining: out.remaining });
        timeboxIds.push(...row.timeboxIds);
        if (out.as === "done") done.push(row.pickId);
      }
      return { ok: true, data: { timeboxIds, done, partly: rows.length - done.length } };
    }
    case "checkin.undo": {
      const o = fields(input, ["timeboxIds"]);
      if (!Array.isArray(o.timeboxIds) || o.timeboxIds.length === 0 || o.timeboxIds.length > 200) throw new Invalid("timeboxIds needs 1 to 200 timeboxes");
      const picks = await plan.unsettleSessions(o.timeboxIds.map((x) => id(x, "timeboxIds")));
      return { ok: true, data: { pickIds: picks } };
    }
    case "checkin.offer_close": {
      const o = fields(input, ["date"]);
      await plan.markOnce(PROGRESS_OFFER_MARK, dateOf(o.date));
      return { ok: true, data: {} };
    }
  }
}

export async function progressAction(ctx: ProgressContext, action: ProgressAction, input: unknown): Promise<ActionResponse> {
  try {
    return await run(ctx, action, input);
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, status: 400, error: e.message };
    if (e instanceof PlanError) return { ok: false, status: 409, error: e.message };
    throw e;
  }
}
