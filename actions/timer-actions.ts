// Focus timer actions (step 6c). The state lives in the plan store (kv "timer"), so it survives window close and
// restarts; the server's tick (server/timer.ts) ends it on time and sends the notifications. Picks get their
// focused time in the focus log. Reset local plan lives here too.
import type { AppConfig } from "../config/schema.ts";
import { extendTimer, MAX_MINUTES, pauseTimer, resumeTimer, startTimer, stopTimer, suggestMinutes, type Segment, type TimerKind, type TimerState } from "../plan/timer.ts";
import { DEFAULT_PLAN } from "../config/schema.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { Pick } from "../plan/types.ts";
import { minutesOf as boxMinutes } from "../plan/timebox.ts";
import { DEFAULT_FOCUS, playlistLink, playlistTarget, type TimerLike } from "../plan/focussound.ts";
import type { ActionResponse, TimerView } from "./types.ts";

export type TimerAction = "timer.start" | "timer.pause" | "timer.resume" | "timer.stop" | "timer.extend" | "timer.done" | "timer.next" | "timer.deep" | "playlist.open" | "plan.reset";

/** Media control (step 10): pausing players and playlist links; the host's (host/types.ts). */
import type { MediaControl } from "../host/types.ts";
export type { MediaControl };

export type TimerContext = {
  plan?: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  now: () => string;
  media?: MediaControl | undefined;
};

/** The part of the stored timer the sound and media rules look at. */
export const timerLike = (s: TimerState | null): TimerLike => (s ? { kind: s.kind, running: !!s.runningSince, ended: s.ended, startedAt: s.startedAt } : null);

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
    deep: !!s.deep,
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
  const before = action.startsWith("timer.") ? (ctx.plan?.getState<TimerState>(TIMER_KEY) ?? null) : undefined;
  const r = await timerActionInner(ctx, action, input);
  // Step 10: media players follow focus (pause on end or break, resume what was paused when focus starts again).
  if (r.ok && before !== undefined && ctx.media && ctx.plan) {
    const after = ctx.plan.getState<TimerState>(TIMER_KEY) ?? null;
    const cfg = await ctx.config();
    await ctx.media.transition(timerLike(before), timerLike(after), (cfg?.focus ?? DEFAULT_FOCUS).pauseMedia);
  }
  return r;
}

async function timerActionInner(ctx: TimerContext, action: TimerAction, input: unknown): Promise<ActionResponse> {
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
  let deep = false;
  const startFor = (p: Pick, minutes?: number) => save(startTimer(now, { kind: "focus", pickId: p.id, label: p.title, minutes: minutes ?? suggestMinutes(p.size, planning.sizes), deep }));

  try {
    switch (action) {
      case "timer.start": {
        const o = fields(input, ["kind", "minutes", "pickId", "playlist", "timeboxId", "deep"]);
        const kind: TimerKind = o.kind === undefined ? "focus" : o.kind === "focus" || o.kind === "break" ? o.kind : (() => { throw new Invalid("kind must be focus or break"); })();
        // Step 16.3: deep focus sets my Teams status to Do not disturb (plain focus: Busy, per Settings > Focus).
        if (o.deep !== undefined && typeof o.deep !== "boolean") throw new Invalid("deep must be true or false");
        if (o.deep && kind !== "focus") throw new Invalid("Deep focus is for focus, not a break");
        deep = o.deep === true;
        const minutes = o.minutes === undefined ? undefined : minutesOf(o.minutes);
        // Step 10: a saved playlist (by name) opens as focus starts: the Spotify app when installed, else the browser.
        let openList: () => Promise<Record<string, unknown>> = async () => ({});
        if (o.playlist !== undefined) {
          if (kind !== "focus") throw new Invalid("A playlist is for focus, not a break");
          if (typeof o.playlist !== "string" || o.playlist.length > 60) throw new Invalid("playlist must be a saved playlist's name");
          const saved = (cfg?.focus ?? DEFAULT_FOCUS).playlists.find((p) => p.name === o.playlist);
          const link = saved ? playlistLink(saved.url) : null;
          if (!link) return bad(`No saved playlist named "${o.playlist}"`, 422);
          const spotifyApp = ctx.media ? (await ctx.media.status()).spotify : false;
          const target = playlistTarget(link, spotifyApp);
          // Opened only once the timer has started (a bad pick opens nothing).
          openList = async () =>
            ctx.media ? ctx.media.open(target).then(() => ({ playlist: saved!.name }), () => ({ notice: `Couldn't open ${saved!.name}` })) : { notice: "Playlists can't be opened here" };
        }
        // Step 12: from a timebox. Its pick when it has one; the length defaults to the timebox's.
        if (o.timeboxId !== undefined) {
          if (kind !== "focus" || o.pickId !== undefined) throw new Invalid("A timebox starts focus on its own pick");
          if (typeof o.timeboxId !== "number" || !Number.isInteger(o.timeboxId)) throw new Invalid("timeboxId must be a number");
          const tb = plan.timebox(o.timeboxId);
          if (!tb || tb.removedAt) return bad("No such timebox", 404);
          const m = minutes ?? Math.min(MAX_MINUTES, boxMinutes(tb));
          const p = tb.pickId !== null ? plan.getPick(tb.pickId) : null;
          finish();
          const started = p && p.status === "planned" ? startFor(p, m) : save(startTimer(now, { kind: "focus", pickId: null, label: tb.title, minutes: m, deep }));
          return respond(started, await openList());
        }
        if (o.pickId !== undefined) {
          if (kind !== "focus") throw new Invalid("A break isn't for a pick");
          if (typeof o.pickId !== "number" || !Number.isInteger(o.pickId)) throw new Invalid("pickId must be a number");
          const p = plan.getPick(o.pickId);
          if (!p) return bad(`No pick ${o.pickId}`, 404);
          if (p.status !== "planned") return bad("Only a planned pick can be timeboxed", 409);
          finish();
          const started = startFor(p, minutes);
          return respond(started, await openList());
        }
        const m = minutes ?? (kind === "focus" ? planning.focusMinutes : planning.breakMinutes);
        if (!m) return bad("Breaks are set to 0 minutes in Settings > Planning", 409);
        finish();
        const started = save(startTimer(now, { kind, pickId: null, label: kind === "focus" ? "Focus" : "Break", minutes: m, deep }));
        return respond(started, await openList());
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
        // Next pick keeps deep focus as it was.
        deep = !!s.deep;
        const next = nextPick(plan, today, s.pickId);
        return next ? respond(startFor(next)) : respond(null, { notice: "No planned picks left today" });
      }
      case "timer.deep": {
        // Step 16.3: switch the running focus session between deep (Do not disturb) and plain (Busy).
        const o = fields(input, ["on"]);
        if (typeof o.on !== "boolean") throw new Invalid("on must be true or false");
        const s = current();
        if (!s || s.kind !== "focus") return bad("No focus session is running", 409);
        const next: TimerState = { ...s };
        if (o.on) next.deep = true;
        else delete next.deep;
        return respond(save(next));
      }
      case "playlist.open": {
        // Step 10: open a saved playlist now (the focus screen's per-session choice). Spotify or YouTube only.
        const o = fields(input, ["name"]);
        if (typeof o.name !== "string" || o.name.length > 60) throw new Invalid("name must be a saved playlist's name");
        const saved = (cfg?.focus ?? DEFAULT_FOCUS).playlists.find((p) => p.name === o.name);
        const link = saved ? playlistLink(saved.url) : null;
        if (!link) return bad(`No saved playlist named "${o.name}"`, 422);
        if (!ctx.media) return bad("Playlists can't be opened here", 503);
        const target = playlistTarget(link, (await ctx.media.status()).spotify);
        try {
          await ctx.media.open(target);
        } catch {
          return bad(`Couldn't open ${saved!.name}`, 502);
        }
        return { ok: true, data: { opened: saved!.name, app: target.startsWith("spotify:") ? "spotify" : "browser" } };
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
    if (e instanceof PlanError) return bad(e.message, /No followUp/.test(e.message) ? 404 : 409);
    throw e;
  }
}
