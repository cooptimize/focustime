// Teams presence (step 16.3).
// 1. My status during focus: one sync, run after every timer action and on the server's 5-second tick, moves my Teams
//    status toward what plan/presence.ts says (Busy or Do not disturb with an expiration, or back to automatic). Only
//    my own user, only setUserPreferredPresence and clearUserPreferredPresence. No preview (my own status, reversible,
//    time-limited); every set and clear goes to the Teams status log (Settings > Data). What it last did is kept in
//    account state, so a restart still clears it, and a status I set by hand in Teams is left alone.
// 2. Teammates' presence for the people on screen: one batched read, words only, never stored, cached or logged.
import type { AppConfig } from "../config/schema.ts";
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { afterStep, checkDue, manualChange, MAX_PRESENCE_PEOPLE, NO_TEAMS_STATUS, presenceWord, teamsStep, type FocusSession, type FocusStatus, type TeamsStatusState } from "../plan/presence.ts";
import { remainingMs, type TimerState } from "../plan/timer.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { PresenceClient } from "../sources/graph/presence.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { storedIdentity, type MicrosoftAccount } from "./account.ts";
import { TIMER_KEY } from "./timer-actions.ts";
import type { ActionResponse } from "./types.ts";

export const PRESENCE_ACTIONS = ["presence.status", "presence.people", "presence.log"] as const;
export type PresenceAction = (typeof PRESENCE_ACTIONS)[number];
export const TEAMS_STATUS_KEY = "teams_status";

export type PresenceTeammate = { name: string; email: string; aadId: string | null };
export type PresenceContext = {
  plan?: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  account: MicrosoftAccount | null;
  /** Cooptimize teammates with their Entra object IDs (Dataverse); null when they can't be read. */
  team: (cfg: AppConfig) => Promise<PresenceTeammate[] | null>;
  now: () => string;
};

import type { PresencePeopleData, TeamsAccess, TeamsStatusView } from "./types.ts";
export type { PresencePeopleData, TeamsAccess, TeamsStatusView };

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });

function accessOf(e: unknown): { access: TeamsAccess; message: string } {
  if (e instanceof AuthFailure) {
    if (e.kind === "consent") return { access: "consent", message: "FocusTime needs your OK to use Teams status. Choose Allow Teams status" };
    if (e.kind === "not_connected" || e.kind === "expired") return { access: "signed_out", message: "Sign in with Microsoft to set your Teams status" };
    return { access: "unavailable", message: e.message };
  }
  if (e instanceof HttpError) return e.status === 403 ? { access: "consent", message: "Teams status isn't allowed for this sign-in (403). Choose Allow Teams status" } : { access: "unavailable", message: `Teams status failed (HTTP ${e.status})` };
  if (e instanceof NetworkError) return { access: "unavailable", message: "Teams unreachable" };
  return { access: "unavailable", message: "Teams status failed" };
}

const settingsOf = (cfg: AppConfig | null) => {
  const f = cfg?.focus ?? DEFAULT_FOCUS;
  return { teamsStatus: f.teamsStatus, plainFocus: f.plainFocusStatus };
};

export function sessionOf(s: TimerState | null, now: Temporal.Instant): FocusSession {
  if (!s) return null;
  return { kind: s.kind, startedAt: s.startedAt, running: !!s.runningSince, ended: s.ended, deep: !!s.deep, plannedMinutes: s.plannedMinutes, remainingMs: remainingMs(s, now) };
}

const readState = (plan: PlanStore) => plan.accountState<TeamsStatusState>(TEAMS_STATUS_KEY) ?? NO_TEAMS_STATUS;

// One sync at a time per store (the tick and an action can meet).
const running = new WeakMap<PlanStore, Promise<TeamsStatusState>>();

/** Moves my Teams status toward what the timer and Settings say. Never throws; returns the state after. */
export function syncTeamsStatus(ctx: PresenceContext): Promise<TeamsStatusState> {
  const plan = ctx.plan;
  if (!plan) return Promise.resolve(NO_TEAMS_STATUS);
  const prev = running.get(plan) ?? Promise.resolve(NO_TEAMS_STATUS);
  const next = prev.catch(() => NO_TEAMS_STATUS).then(() => syncOnce(ctx, plan));
  running.set(plan, next);
  return next;
}

async function syncOnce(ctx: PresenceContext, plan: PlanStore): Promise<TeamsStatusState> {
  let state = readState(plan);
  const save = (s: TeamsStatusState) => {
    plan.setAccountState(TEAMS_STATUS_KEY, s);
    return (state = s);
  };
  const nowIso = ctx.now();
  const now = Temporal.Instant.from(nowIso);
  const cfg = await ctx.config().catch(() => null);
  const session = sessionOf(plan.getState<TimerState>(TIMER_KEY) ?? null, now);
  const step = teamsStep(state, session, settingsOf(cfg), nowIso);
  const client = ctx.account?.presence ?? null;
  const me = storedIdentity(plan);
  if (!client || !me) {
    // Signed out: nothing can be set; forget a set status (its expiration ends it).
    if (state.set && step.do === "clear") save(afterStep(state, step, session, nowIso));
    return state;
  }
  const fail = (op: "set" | "clear", e: unknown, status: FocusStatus | null, minutes: number | null) => {
    const { message } = accessOf(e);
    // A repeated failure is logged once, not every minute.
    if (state.error !== message) plan.logTeamsStatus({ op, status, minutes, result: "failed", message });
    save({ ...state, error: message, errorAt: nowIso });
  };
  if (step.do === "set") {
    try {
      await client.setMine(me.oid, step.status, step.minutes);
    } catch (e) {
      fail("set", e, step.status, step.minutes);
      return state;
    }
    plan.logTeamsStatus({ op: "set", status: step.status, minutes: step.minutes, result: "done", message: null });
    return save(afterStep(state, step, session, nowIso));
  }
  if (step.do === "clear") {
    try {
      await client.clearMine(me.oid);
    } catch (e) {
      fail("clear", e, null, null);
      return state;
    }
    plan.logTeamsStatus({ op: "clear", status: null, minutes: null, result: "done", message: null });
    return save(afterStep(state, step, session, nowIso));
  }
  // Nothing to change: now and then, check whether I changed my status in Teams myself.
  if (checkDue(state, nowIso)) {
    try {
      const mine = await client.mine();
      if (manualChange(state, mine.availability, nowIso)) {
        plan.logTeamsStatus({ op: "left", status: state.set, minutes: null, result: "done", message: "Changed in Teams: FocusTime leaves it until the next session" });
        return save({ ...state, manual: true, checkedAt: nowIso });
      }
      return save({ ...state, checkedAt: nowIso });
    } catch {
      return save({ ...state, checkedAt: nowIso });
    }
  }
  return state;
}

const onlyKeys = (input: unknown, keys: string[]) =>
  input === undefined || input === null || (typeof input === "object" && !Array.isArray(input) && Object.keys(input as object).every((k) => keys.includes(k)));

function list(v: unknown, name: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim() || x.length > 200)) throw new Error(`${name} must be a list of text`);
  return [...new Set((v as string[]).map((x) => x.trim().toLowerCase()))];
}

export async function presenceAction(ctx: PresenceContext, action: PresenceAction, input: unknown): Promise<ActionResponse> {
  switch (action) {
    case "presence.status": {
      if (!onlyKeys(input, ["check"])) return bad("presence.status takes { check? }");
      const check = (input as { check?: unknown } | null)?.check;
      if (check !== undefined && typeof check !== "boolean") return bad("check must be true or false");
      const cfg = await ctx.config().catch(() => null);
      const s = settingsOf(cfg);
      const st = ctx.plan ? readState(ctx.plan) : NO_TEAMS_STATUS;
      let access: TeamsAccess | null = null;
      if (check) {
        if (!ctx.account?.presence || !storedIdentity(ctx.plan)) access = "signed_out";
        else access = await ctx.account.presence.mine().then(() => "ok" as const, (e: unknown) => accessOf(e).access);
      }
      const view: TeamsStatusView = { enabled: s.teamsStatus, plainFocus: s.plainFocus, access, set: st.set, until: st.until, manual: st.manual, error: st.error };
      return { ok: true, data: view };
    }
    case "presence.people": {
      if (!onlyKeys(input, ["emails", "names", "me"])) return bad("presence.people takes { emails?, names?, me? }");
      const wantMe = (input as { me?: unknown } | null)?.me;
      if (wantMe !== undefined && typeof wantMe !== "boolean") return bad("me must be true or false");
      let emails: string[];
      let names: string[];
      try {
        emails = list((input as { emails?: unknown } | null)?.emails, "emails");
        names = list((input as { names?: unknown } | null)?.names, "names");
      } catch (e) {
        return bad((e as Error).message);
      }
      if (emails.length + names.length > MAX_PRESENCE_PEOPLE) return bad(`At most ${MAX_PRESENCE_PEOPLE} people at once`);
      const none = (reason: TeamsAccess): ActionResponse => ({ ok: true, data: { available: false, reason, people: [] } satisfies PresencePeopleData });
      const client = ctx.account?.presence ?? null;
      if (!client || !storedIdentity(ctx.plan)) return none("signed_out");
      // Step 16.4: my own presence for the top bar (GET /me/presence; availability and activity only).
      let me: PresencePeopleData["me"];
      if (wantMe) {
        try {
          const m = await client.mine();
          me = presenceWord(m.availability, m.activity);
        } catch (e) {
          return none(accessOf(e).access);
        }
      }
      const withMe = (d: PresencePeopleData): PresencePeopleData => (wantMe ? { ...d, me: me ?? null } : d);
      if (!emails.length && !names.length) return { ok: true, data: withMe({ available: true, reason: null, people: [] }) };
      const cfg = await ctx.config().catch(() => null);
      const team = cfg ? await ctx.team(cfg).catch(() => null) : null;
      if (!team) return none("unavailable");
      // Only Cooptimizers (the Dataverse team) with an Entra object ID; names must match one person exactly.
      const byName = new Map<string, PresenceTeammate | null>();
      for (const t of team) {
        const k = t.name.trim().toLowerCase();
        byName.set(k, byName.has(k) ? null : t);
      }
      const wanted = new Map<string, PresenceTeammate>();
      for (const e of emails) {
        const t = team.find((x) => x.email === e);
        if (t?.aadId) wanted.set(t.aadId, t);
      }
      for (const n of names) {
        const t = byName.get(n);
        if (t?.aadId) wanted.set(t.aadId, t);
      }
      if (!wanted.size) return { ok: true, data: withMe({ available: true, reason: null, people: [] }) };
      let raw: Awaited<ReturnType<PresenceClient["people"]>>;
      try {
        raw = await client.people([...wanted.keys()]);
      } catch (e) {
        return none(accessOf(e).access);
      }
      const people: PresencePeopleData["people"] = [];
      for (const [id, t] of wanted) {
        const p = raw.get(id);
        const word = p ? presenceWord(p.availability, p.activity) : null;
        if (word) people.push({ email: t.email, name: t.name, word });
      }
      return { ok: true, data: withMe({ available: true, reason: null, people }) };
    }
    case "presence.log": {
      if (!onlyKeys(input, [])) return bad("presence.log takes no input");
      return { ok: true, data: { entries: ctx.plan?.teamsStatusLog(100) ?? [] } };
    }
  }
}
