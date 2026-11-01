// Focus timer actions (step 6c). The state lives in the plan store (kv "timer"), so it survives window close and
// restarts; the server's tick (server/timer.ts) ends it on time and sends the notifications. Picks get their
// focused time in the focus log. Loops list and Reset local plan live here too, as other plan-store actions.
import type { AppConfig } from "../config/schema.ts";
import { extendTimer, MAX_MINUTES, pauseTimer, resumeTimer, startTimer, stopTimer, suggestMinutes, type Segment, type TimerKind, type TimerState } from "../plan/timer.ts";
import { DEFAULT_PLAN } from "../config/schema.ts";
import { PlanError, type Loop, type PlanStore } from "../store/plan-store.ts";
import type { Pick } from "../plan/types.ts";
import type { ActionResponse, LoopView, TimerView } from "./types.ts";

export type TimerAction = "timer.start" | "timer.pause" | "timer.resume" | "timer.stop" | "timer.extend" | "timer.done" | "timer.next" | "loops.list" | "loop.close" | "plan.reset";

export type TimerContext = {
  plan?: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  now: () => string;
};

export const TIMER_KEY = "timer";

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
class Invalid extends Error {}

export function timerView(s: TimerState | null, now: Temporal.Instant): TimerView | null {
  if (!s) return null;
  const elapsed = s.elapsedMs + (s.runningSince ? Math.max(0, now.epochMilliseconds - Temporal.Instant.from(s.runningSince).epochMilliseconds) : 0);
  const remaining = Math.max(0, s.plannedMinutes * 60_000 - elapsed);
  return {
    kind: s.kind,
    pickId: s.pickId,
    label: s.label,
    plannedMinutes: s.plannedMinutes,
    remainingMs: remaining,
    running: !!s.runningSince,
    ended: s.ended,
    endsAt: s.runningSince ? now.add({ milliseconds: remaining }).toString() : null,
    runningSince: s.runningSince,
  };
}

/** Logs a focused stretch (focus sessions only; breaks aren't focus). */
export function logSegment(plan: PlanStore, s: TimerState, seg: Segment | null): void {
  if (seg && s.kind === "focus") plan.addFocus({ pickId: s.pickId, label: s.label, ...seg });
}

/** Today's next planned pick (morning, afternoon, evening, then position), other than `except`. */
export function nextPick(plan: PlanStore, today: string, except: number | null): Pick | null {
  const order = ["AM", "PM", "EVE"];
  return plan.picksFor(today).filter((p) => p.status === "planned" && p.id !== except).sort((a, b) => order.indexOf(a.half) - order.indexOf(b.half) || a.position - b.position)[0] ?? null;
}

function loopView(plan: PlanStore, l: Loop): LoopView {
  const f = l.sourceKind === "flex" && l.sourceId !== null ? plan.getFlex(l.sourceId) : null;
  return { id: l.id, kind: l.kind, clientKey: l.clientKey, what: l.what, channel: l.channel, due: l.due, openedAt: l.openedAt, closedAt: l.closedAt, closeNote: l.closeNote, session: f ? { start: f.start, end: f.end } : null };
}

function fields(input: unknown, allowed: string[]): Record<string, unknown> {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw new Invalid(`unknown input field ${k}`);
  return input as Record<string, unknown>;
}
const minutesOf = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_MINUTES) throw new Invalid(`minutes must be a whole number from 1 to ${MAX_MINUTES}`);
  return v;
};

export async function timerAction(ctx: TimerContext, action: TimerAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store is not available", 503);
  const now = Temporal.Instant.from(ctx.now());
  const cfg = await ctx.config();
  const planning = cfg?.plan ?? { ...DEFAULT_PLAN, pickablePortfolioTypes: [] };
  const tz = cfg?.week.hours.timeZone ?? "America/New_York";
  const today = now.toZonedDateTimeISO(tz).toPlainDate().toString();
  const current = () => plan.getState<TimerState>(TIMER_KEY);
  const save = (s: TimerState | null) => {
    plan.setState(TIMER_KEY, s);
    return s;
  };
  const respond = (s: TimerState | null, extra: Record<string, unknown> = {}): ActionResponse => ({ ok: true, data: { timer: timerView(s, now), ...extra } });
  /** Ends whatever runs now, logging its running part. */
  const finish = () => {
    const s = current();
    if (s) logSegment(plan, s, stopTimer(s, now).segment);
    save(null);
    return s;
  };
  const startFor = (p: Pick, minutes?: number) => save(startTimer(now, { kind: "focus", pickId: p.id, label: p.title, minutes: minutes ?? suggestMinutes(p.size, planning.sizes) }));

  try {
    switch (action) {
      case "timer.start": {
        const o = fields(input, ["kind", "minutes", "pickId"]);
        const kind: TimerKind = o.kind === undefined ? "focus" : o.kind === "focus" || o.kind === "break" ? o.kind : (() => { throw new Invalid("kind must be focus or break"); })();
        const minutes = o.minutes === undefined ? undefined : minutesOf(o.minutes);
        if (o.pickId !== undefined) {
          if (kind !== "focus") throw new Invalid("A break isn't for a pick");
          if (typeof o.pickId !== "number" || !Number.isInteger(o.pickId)) throw new Invalid("pickId must be a number");
          const p = plan.getPick(o.pickId);
          if (!p) return bad(`No pick ${o.pickId}`, 404);
          if (p.status !== "planned") return bad("Only a planned pick can be timeboxed", 409);
          finish();
          return respond(startFor(p, minutes));
        }
        const m = minutes ?? (kind === "focus" ? planning.focusMinutes : planning.breakMinutes);
        if (!m) return bad("Breaks are set to 0 minutes in Settings > Planning", 409);
        finish();
        return respond(save(startTimer(now, { kind, pickId: null, label: kind === "focus" ? "Focus" : "Break", minutes: m })));
      }
      case "timer.pause":
      case "timer.resume":
      case "timer.stop":
      case "timer.extend":
      case "timer.done":
      case "timer.next": {
        const o = fields(input, action === "timer.extend" ? ["minutes"] : []);
        const s = current();
        if (!s) return bad("No timer is running", 409);
        if (action === "timer.pause") {
          const p = pauseTimer(s, now);
          logSegment(plan, s, p.segment);
          return respond(save(p.state));
        }
        if (action === "timer.resume") return respond(save(resumeTimer(s, now)));
        if (action === "timer.extend") return respond(save(extendTimer(s, now, o.minutes === undefined ? 15 : minutesOf(o.minutes))));
        if (action === "timer.stop") {
          finish();
          return respond(null);
        }
        // Done ends the session and ticks its pick done; Next pick ends it and timeboxes today's next pick.
        finish();
        if (action === "timer.done") {
          if (s.kind === "focus" && s.pickId !== null && plan.getPick(s.pickId)?.status === "planned") plan.setDone(s.pickId, true);
          return respond(null);
        }
        const next = nextPick(plan, today, s.pickId);
        return next ? respond(startFor(next)) : respond(null, { notice: "No planned picks left today" });
      }
      case "loops.list": {
        const o = fields(input, ["includeClosed"]);
        if (o.includeClosed !== undefined && typeof o.includeClosed !== "boolean") throw new Invalid("includeClosed must be true or false");
        plan.openFlexLoops(now);
        const loops = (o.includeClosed ? plan.allLoops() : plan.openLoops()).map((l) => loopView(plan, l));
        return { ok: true, data: { loops } };
      }
      case "loop.close": {
        const o = fields(input, ["id", "note"]);
        if (typeof o.id !== "number" || !Number.isInteger(o.id)) throw new Invalid("id must be a number");
        let note: string | null = null;
        if (o.note !== undefined && o.note !== null) {
          if (typeof o.note !== "string" || o.note.length > 500) throw new Invalid("note must be text of at most 500 characters");
          note = o.note.trim() || null;
        }
        return { ok: true, data: { loop: loopView(plan, plan.closeLoop(o.id, note)) } };
      }
      case "plan.reset": {
        const o = fields(input, ["confirm"]);
        // A typed confirmation, so neither a stray click nor a suggestion can reset by accident.
        if (o.confirm !== "reset") return bad('Type "reset" to confirm', 422);
        const s = current();
        if (s) logSegment(plan, s, stopTimer(s, now).segment);
        const backup = plan.reset();
        return { ok: true, data: { backup: backup ? backup.split("/").pop() : null } };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, /No loop/.test(e.message) ? 404 : 409);
    throw e;
  }
}
