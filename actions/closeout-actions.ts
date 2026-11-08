// Close out (step 7, end of day) and the actions it shares with Check-in: make up a pick (borrowed time), resume
// notes, add a follow-up, pay borrowed time. Local only: they write to the plan store and read DevOps results already in
// memory. Nothing here calls or writes DevOps, Outlook, Google or Dataverse.
import { storyMinutes } from "../plan/estimate.ts";
import { SIZE_MINUTES } from "../plan/types.ts";
import { dueOrder } from "../plan/due.ts";
import { weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import type { AppConfig } from "../config/schema.ts";
import { borrowMinutes, flexOffer, paybackSlot, PAYBACKS, type Payback } from "../plan/borrow.ts";
import { dayLabel, stepDay } from "../plan/days.ts";
import type { ClientWork, Half, IsoDate } from "../week/types.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import { PlanError, type Borrowed, type PlanStore, type ResumeNote } from "../store/plan-store.ts";
import { hasHoursNear, hasHoursOn } from "./plan-actions.ts";
import { mapSeq } from "./seq.ts";
import { applyFollowUpRules, internalClients, followUpView, nameOf, newestFirst, workdayOf } from "./followup-rules.ts";
import type { ActionResponse, BorrowedView, CloseOutState, ResumeNoteView } from "./types.ts";
import { userZone } from "../week/zone.ts";

export type CloseoutAction = "closeout.load" | "closeout.commit" | "checkin.done" | "pick.make_up" | "note.set" | "borrow.pay";

/** Step 16.2: the plan store marker for a day whose Check-in was done (Done in Check-in). Local only. */
export const CHECKIN_DONE_MARK = "checkin_done";

export type CloseoutContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  /** DevOps results already in memory (never a fetch here), for the follow-up rules. */
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "last">;
  /** PTO dates from a Monday for about five weeks, so "Carry over" and make-up days skip PTO. */
  ptoAhead?: (cfg: AppConfig, monday: IsoDate) => Promise<ReadonlySet<IsoDate>>;
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
function date(v: unknown, name = "date"): IsoDate {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid(`${name} must be YYYY-MM-DD`);
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid(`${name} must be a real date`);
  }
}
function text(v: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t && !allowEmpty) throw new Invalid(`${name} can't be empty`);
  if (t.length > max) throw new Invalid(`${name} must be ${max} characters or fewer`);
  return t;
}
function id(v: unknown, name = "id"): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
}
function half(v: unknown): Half {
  if (v !== "AM" && v !== "PM" && v !== "EVE") throw new Invalid("half must be AM, PM or EVE");
  return v;
}

const noteView = (n: ResumeNote): ResumeNoteView => ({ clientKey: n.clientKey, date: n.date, note: n.note });
const borrowedView = (b: Borrowed): BorrowedView => ({ id: b.id, pickId: b.pickId, fromPickId: b.fromPickId, clientKey: b.clientKey, title: b.title, date: b.date, minutes: b.minutes, payback: b.payback, paybackDate: b.paybackDate, paybackHalf: b.paybackHalf, paidAt: b.paidAt, paidBy: b.paidBy });
export { borrowedView, noteView };

async function clock(ctx: CloseoutContext) {
  const cfg = await ctx.config();
  const model = cfg?.week.hours ?? defaultWeekConfig.hours;
  const now = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(userZone(model));
  return { cfg, model, now, today: now.toPlainDate().toString() };
}

async function ptoSet(ctx: CloseoutContext, cfg: AppConfig | null, from: IsoDate): Promise<ReadonlySet<IsoDate>> {
  if (!ctx.ptoAhead || !cfg) return new Set();
  const d = Temporal.PlainDate.from(from);
  return ctx.ptoAhead(cfg, d.subtract({ days: d.dayOfWeek - 1 }).toString()).catch(() => new Set<IsoDate>());
}

/** DevOps as last fetched, for the clients in play (picks and open follow-ups), without fetching. */
async function workInMemory(ctx: CloseoutContext, cfg: AppConfig | null, plan: PlanStore, today: IsoDate): Promise<ClientWork[] | null> {
  if (!cfg) return null;
  const t = Temporal.PlainDate.from(today);
  const keys = new Set([...(await plan.picksBetween(t.subtract({ days: 14 }).toString(), today)).map((p) => p.clientKey), ...(await plan.openFollowUps()).map((l) => l.clientKey).filter((k): k is string => !!k)]);
  const dv = ctx.devops(cfg);
  return [...keys].map((k) => dv.last(k)).filter((w): w is NonNullable<typeof w> => !!w);
}

export async function closeOutState(ctx: CloseoutContext, plan: PlanStore, d: IsoDate): Promise<CloseOutState> {
  const { cfg, model, today } = await clock(ctx);
  const work = (await workInMemory(ctx, cfg, plan, today));
  const known = new Map((work ?? []).map((w) => [w.clientKey, w.clientName]));
  const clientName = nameOf(cfg, (k) => known.get(k));
  // The rules run here too, so ticks and moves made in Close out open their follow-ups at once.
  (await plan.openFlexFollowUps(Temporal.Instant.from(ctx.now())));
  await applyFollowUpRules(plan, { today, work, internal: internalClients(cfg), clientName, isWorkday: workdayOf(cfg) });
  (await plan.settleBorrowed());
  const picks = (await plan.picksFor(d));
  const focused = (await plan.focusedSeconds(picks.map((p) => p.id)));
  const pto = await ptoSet(ctx, cfg, today);
  const hasHours = await hasHoursNear(plan, model, d < today ? today : d);
  // Carry over: the next day that can be planned after this one, never before today.
  const carryTo = d < today && (await hasHoursOn(plan, model, today)) && !pto.has(today) ? today : stepDay(d < today ? today : d, 1, pto, hasHours);
  const worked = new Map<string, string>();
  for (const p of picks) if (p.status === "done" || (focused[p.id] ?? 0) >= 60) worked.set(p.clientKey, clientName(p.clientKey));
  for (const f of (await plan.flexBetween(d, d))) worked.set(f.clientKey, clientName(f.clientKey));
  const dayPlan = (await plan.day(d));
  const prevDay = Temporal.PlainDate.from(d).subtract({ days: 1 }).toString();
  return {
    date: d,
    today,
    access: d < today ? "past" : "today",
    committedAt: dayPlan?.committedAt ?? null,
    closedOutAt: dayPlan?.closedOutAt ?? null,
    picks,
    movedTo: Object.fromEntries(
      (
        await mapSeq(
          picks.filter((p) => p.status === "moved"),
          async (p) => {
            const to = await plan.movedTo(p.id);
            return to ? [[p.id, { date: to.date, half: to.half }] as const] : [];
          },
        )
      ).flat(),
    ),
    focused,
    carryTo,
    worked: [...worked].map(([clientKey, name]) => ({ clientKey, clientName: name })),
    notes: Object.fromEntries((await plan.notesOn(d)).map((n) => [n.clientKey, noteView(n)])),
    previous: Object.fromEntries(Object.entries((await plan.latestNotes(prevDay))).map(([k, n]) => [k, noteView(n)])),
    // Step 13.5: what is due by the day being closed comes first; snoozed ones stay hidden until their day.
    followUps: await mapSeq(dueOrder((await plan.openFollowUps()).filter((l) => !l.snoozedUntil || l.snoozedUntil <= today).sort(newestFirst), d, (l) => l.due, (l) => l.openedAt), (l) => followUpView(plan, l, today, clientName)),
    borrowed: (await plan.borrowedFor(d, d)).map(borrowedView),
    captures: (await plan.inboxCount()),
  };
}

export async function closeoutAction(ctx: CloseoutContext, action: CloseoutAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store is not available", 503);
  try {
    const { cfg, model, now, today } = await clock(ctx);
    const notFuture = (d: IsoDate) => (d > today ? `${dayLabel(d)} hasn't happened yet. Close out is for today or an earlier day` : null);
    switch (action) {
      case "closeout.load":
      case "closeout.commit": {
        const d = date(fields(input, ["date"]).date);
        const future = notFuture(d);
        if (future) return bad(future, 422);
        if (action === "closeout.commit") (await plan.closeOut(d));
        return { ok: true, data: await closeOutState(ctx, plan, d) };
      }
      case "checkin.done": {
        // Step 16.2: Done in Check-in marks today checked in (the ✓ on the Check-in mode). Only today has a Check-in.
        const d = date(fields(input, ["date"]).date);
        if (d !== today) return bad("Check-in is for today", 422);
        (await plan.markOnce(CHECKIN_DONE_MARK, d));
        return { ok: true, data: { date: d, done: true } };
      }
      case "pick.make_up": {
        const o = fields(input, ["id", "when"], ["date", "half", "minutes"]);
        const pid = id(o.id);
        if (typeof o.when !== "string" || !(PAYBACKS as readonly string[]).includes(o.when)) throw new Invalid("when must be tonight, friday or day");
        const when = o.when as Payback;
        const p = (await plan.getPick(pid));
        if (!p) return bad(`No to-do ${pid}`, 404);
        if (p.status !== "planned") return bad("Only a planned to-do can be made up", 409);
        const chosen = { ...(o.date !== undefined ? { date: date(o.date) } : {}), ...(o.half !== undefined ? { half: half(o.half) } : {}) };
        const slot = paybackSlot(when, today, chosen);
        if (typeof slot === "string") return bad(slot, 422);
        const pto = await ptoSet(ctx, cfg, slot.date);
        if (pto.has(slot.date)) return bad(`${dayLabel(slot.date)} is a PTO day. Choose another day`, 422);
        let minutes = borrowMinutes(p.remainingMinutes ?? storyMinutes(p.size, cfg?.plan.sizes ?? SIZE_MINUTES), (await plan.focusedSeconds([pid]))[pid] ?? 0);
        if (o.minutes !== undefined) {
          if (typeof o.minutes !== "number" || !Number.isInteger(o.minutes) || o.minutes < 5 || o.minutes > 480) throw new Invalid("minutes must be a whole number from 5 to 480");
          minutes = o.minutes;
        }
        const r = (await plan.makeUp(pid, slot, { minutes, payback: when }));
        return { ok: true, data: { pick: r.pick, borrowed: borrowedView(r.borrowed), flexOffer: flexOffer(slot, minutes, model, now) } };
      }
      case "note.set": {
        const o = fields(input, ["clientKey", "date", "note"]);
        const key = text(o.clientKey, "clientKey", 100);
        const d = date(o.date);
        const future = notFuture(d);
        if (future) return bad(future, 422);
        const n = (await plan.setResumeNote(key, d, text(o.note, "note", 200, true)));
        return { ok: true, data: { note: n ? noteView(n) : null } };
      }
      case "borrow.pay": {
        const b = (await plan.payBorrowed(id(fields(input, ["id"]).id)));
        return { ok: true, data: { borrowed: borrowedView(b) } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, /^No /.test(e.message) ? 404 : 409);
    throw e;
  }
}
