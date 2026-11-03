// Named, validated actions (docs/spec.md section 5). The UI calls these through the local server;
// the future chat panel will call the same ones. Unknown actions and unexpected input are rejected.
import { clearPhotos, photoAction } from "./photo-actions.ts";
import type { PhotoCache } from "../host/types.ts";
import { expiringSoon } from "../plan/expiry.ts";
import { clients as defaultClients, weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import { DEFAULT_PLAN, DEFAULT_TIMEBOX, DEFAULT_UI, TEXT_SIZES, THEMES, type AppConfig, type DataverseConfig, type GoogleConfig, type OutlookConfig, type ParseResult } from "../config/schema.ts";
import { setValue, type WriteResult } from "../config/edit.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { calendarNotSetUp } from "../sources/not-set-up.ts";
import { buildWeek } from "../week/build.ts";
import { followedKeys } from "../week/follow.ts";
import { followOptions } from "./follow.ts";
import { defaultWeekStart, localToday, mondayOf, todayTarget, weekDates7 } from "../week/dates.ts";
import { hoursOn, VIEW_RANGES, type TimeModel, type ViewRange } from "../week/hours.ts";
import { ptoByDate, type PtoDay, type PtoEntry } from "../week/pto.ts";
import type { CalEvent, ClientWork, FocusPattern, IsoDate, SourceResult, Week } from "../week/types.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { timeboxAction, timeboxesFor, timeboxView } from "./timebox-actions.ts";
import { devopsWriteAction, type WritePats } from "./devops-write-actions.ts";
import type { DevOpsWriter } from "../sources/devops/write.ts";
import { ownEventIds, withoutOwn } from "../plan/timebox.ts";
import type { OutlookWrite, PeopleReader, ScheduleReader } from "../sources/graph/source.ts";
import { collabAction } from "./collab-actions.ts";
import { syncWeek } from "./outlook-sync.ts";
import { outlookLink } from "../plan/caltier.ts";
import { DEFAULT_COLLAB } from "../config/schema.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import { checkDevOpsUrl } from "../links/devops-url.ts";
import { hasHoursOn, planAction } from "./plan-actions.ts";
import { mapSeq } from "./seq.ts";
import { timeAction } from "./time-actions.ts";
import { TIMER_KEY, timerAction, timerView, type MediaControl } from "./timer-actions.ts";
import { DEFAULT_FOCUS } from "../plan/focussound.ts";
import { warnPoints, type TimerState } from "../plan/timer.ts";
import { settingsAction, type SettingsContext } from "./settings-actions.ts";
import { borrowedView, closeoutAction, noteView } from "./closeout-actions.ts";
import { applyFollowUpRules, followUpView, internalClients, nameOf, workdayOf } from "./followup-rules.ts";
import { watchedIds } from "../plan/followups.ts";
import { isActionName, type ActionName } from "./registry.ts";
import { captureAction } from "./capture-actions.ts";
import { followUpAction } from "./followup-actions.ts";
import { roadmapAction } from "./roadmap-actions.ts";
import { CHECKIN_DONE_MARK } from "./closeout-actions.ts";
import { titleFrom, weekPlanAction, weekPlanView, withTitles } from "./weekplan-actions.ts";
import { weekNudges, withCurrentTitles, type NudgeTimes } from "../plan/weekplan.ts";
import { AHEAD_SEEN_MARK, aheadRitualsDue } from "../plan/rituals.ts";

import type { HostLinks } from "../host/types.ts";
import type { ActionResponse, SourceSummary, PlanningSettings, WeekLoadData } from "./types.ts";
import { DATAVERSE_UNREACHABLE, manyDataverseMatches, noDataverseMatch, type MatchResult } from "./dataverse-words.ts";
import { accountAction, storedIdentity, withMe, IDENTITY_KEY, type MicrosoftAccount, type StoredIdentity } from "./account.ts";
import { vmAction, type VmContext } from "./vm-actions.ts";
import { presenceAction, syncTeamsStatusWith, type PresenceContext } from "./presence-actions.ts";
import type { AzureClient } from "../sources/azure/client.ts";
import { userZone } from "../week/zone.ts";
import { setupAction, type SetupClient } from "./setup-actions.ts";
import { noticeAction, type PushPort } from "./notice-actions.ts";

/** The plan store marker for the first launch (step 17.5). */
const FIRST_LAUNCH_MARK = "first_launch";
/** G1: the "Take the 2-minute tour" link on a person's first Today, once they open it or say Not now. */
const TOUR_MARK = "tour_offer";

export type { ActionResponse, SourceSummary, WeekLoadData };

export type ActionContext = {
  /** S1 (D452): where this runs: local, dev, prod or demo (runtime config). Absent: local. */
  env?: string;
  /** R1: what to do when the one-time move from Coopilot's keyring entries failed; shown on the sign-in screen. */
  renameNote?: string | null;
  /** Step 16.4: the profile photo cache (~/.cache/focustime/photos). Absent: photos aren't cached (demo mode, tests). */
  photoCache?: PhotoCache;
  /** Step 15.5: the notifier (test and sample notifications). Absent: notifications aren't available here. */
  notifications?: { test: () => Promise<void>; sample: (kind: string, live: boolean, gated: boolean) => Promise<boolean> };
  /** P1: this person's Web Push (devices, the app's VAPID key). Absent: push isn't available (demo, tests). */
  push?: PushPort;
  loadConfig: () => Promise<{ path: string; parsed: ParseResult; created?: boolean }>;
  makeDataverse: (cfg: DataverseConfig, timeZone: string) => DataverseSource;
  makeOutlook: (cfg: OutlookConfig, timeZone: string) => CalendarSource & { write?: OutlookWrite; schedule?: ScheduleReader; people?: PeopleReader };
  makeGoogle: (cfg: GoogleConfig, timeZone: string) => CalendarSource;
  makeDevOps: (cfg: DataverseConfig, timeZone: string) => DevOpsSource;
  saveSystemUserId: (id: string) => Promise<void>;
  /** A2: the signed-in person's names (their sign-in email and UPN), to find them in Dataverse. */
  signedInAs?: (() => Promise<{ email: string | null; upn: string } | undefined>) | undefined;
  now: () => string;
  /** Waits before a second read-back after a network error (D255); tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
  /** The local plan store (step 5); absent when it could not be opened. */
  plan?: PlanStore;
  /** Safe config write (config/edit.ts writeConfig): validate, back up, atomic replace. Absent: settings are read-only. */
  writeConfig?: (edit: (text: string) => string) => Promise<WriteResult>;
  /** The host's links (A1): open a link in the person's browser (link.open, outlook.open). Absent: links don't open. */
  links?: HostLinks;
  /** Settings (step 6b): secret presence and app secret writes, plan export. */
  secrets?: SettingsContext["secrets"];
  exportPlan?: (json: string) => Promise<string>;
  /** A2: the signed-in person's own data: everything as JSON (no secrets), and the delete (signs them out). */
  myData?: { export: () => Promise<Record<string, unknown>>; remove: () => Promise<{ hardDeleteOn: string }> };
  /** Step 14: personal DevOps write PATs in the keyring, and the DevOps writer. Absent: DevOps stays read-only. */
  writePats?: WritePats;
  devopsWriter?: DevOpsWriter;
  /** Media control for focus (step 10): the host's. Absent: none (tests, demo). */
  media?: MediaControl;
  /** Step 15 (D272): demo mode, whether this context is the demo one and how to switch. Absent: no demo mode. */
  demo?: { on: boolean; set: (on: boolean) => Promise<void> };
  /**
   * Step 15.4: the Microsoft sign-in for a config (null without an [outlook] app registration), and an Azure Resource
   * Manager client on a token. Absent: no sign-in here (tests that don't need it), and the config's "me" is used.
   */
  account?: (cfg: AppConfig) => MicrosoftAccount | null;
  azure?: (token: () => Promise<string>) => AzureClient;
};

/** Actions that reach outside FocusTime or change secrets: refused while demo mode is on (D272). */
export const DEMO_REFUSED: readonly ActionName[] = [
  "link.open", "outlook.open", "playlist.open", "data.export", "secret.set",
  "auth.connect_microsoft", "auth.connect_google", "auth.connect_outlook_write", "auth.disconnect",
  "write.confirm", "write.retry", "devops.confirm", "devops.retry", "devops.set_write_pat", "devops.clear_write_pat",
  "auth.sign_in", "auth.sign_out", "push.subscribe",
];
export const DEMO_REFUSAL = "Demo data: nothing leaves FocusTime in demo mode";

export type ActionRequest = { action: unknown; input: unknown };

const bad = (error: string): ActionResponse => ({ ok: false, status: 400, error });

type WeekLoadInput = { weekStart?: string; now?: string; refresh?: boolean; /** Step 15 (D271): this session's view range, not saved. */ viewRange?: ViewRange };

function validateWeekLoad(input: unknown): WeekLoadInput | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "input must be an object";
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["weekStart", "now", "refresh", "viewRange"].includes(k)) return `unknown input field ${k}`;
  const out: WeekLoadInput = {};
  if (o.weekStart !== undefined) {
    if (typeof o.weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.weekStart)) return "weekStart must be YYYY-MM-DD";
    try {
      if (Temporal.PlainDate.from(o.weekStart).dayOfWeek !== 1) return "weekStart must be a Monday";
    } catch {
      return "weekStart must be a real date";
    }
    out.weekStart = o.weekStart;
  }
  if (o.now !== undefined) {
    if (typeof o.now !== "string") return "now must be an ISO instant";
    try {
      Temporal.Instant.from(o.now);
    } catch {
      return "now must be an ISO instant";
    }
    out.now = o.now;
  }
  if (o.refresh !== undefined) {
    if (typeof o.refresh !== "boolean") return "refresh must be true or false";
    out.refresh = o.refresh;
  }
  if (o.viewRange !== undefined) {
    if (typeof o.viewRange !== "string" || !(VIEW_RANGES as readonly string[]).includes(o.viewRange)) return `viewRange must be one of ${VIEW_RANGES.join(", ")}`;
    out.viewRange = o.viewRange as ViewRange;
  }
  return out;
}

/** Mon to Fri of a date's week: the range PTO is read in for the week view and pick checks (shared memo). */
const weekRange = (date: string): [string, string] => {
  const mon = mondayOf(date);
  return [mon, Temporal.PlainDate.from(mon).add({ days: 4 }).toString()];
};
/** How far ahead PTO is read for Plan the day's target (D106): this week plus four more. */
const AHEAD_DAYS = 7 * 5 - 3;

/** PTO for one date, for the server-side pick check. Null when there is none or Dataverse can't say. */
async function ptoOn(ctx: ActionContext, cfg: AppConfig, date: string): Promise<PtoDay | null> {
  if (!cfg.dataverse.mySystemUserId) return null;
  const r = await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).pto(...weekRange(date)).catch(() => null);
  return ptoByDate(r?.items ?? [], [date])[date] ?? null;
}

/** PTO dates from a Monday for AHEAD_DAYS: the same read as week.load's look-ahead, so usually a memory hit. */
async function ptoAheadOf(ctx: ActionContext, cfg: AppConfig, monday: string): Promise<ReadonlySet<string>> {
  if (!cfg.dataverse.mySystemUserId) return new Set();
  const to = Temporal.PlainDate.from(monday).add({ days: AHEAD_DAYS }).toString();
  const r = await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).pto(monday, to).catch(() => null);
  return new Set((r?.items ?? []).map((e) => e.date));
}

/** Working hours or a flex session on a date: the day can be planned (step 6b, D127). */
/** On the loaded week, today's dayIndex is its column (weekend columns show only when they have something on them). */
function columnOf(t: ReturnType<typeof todayTarget>, week: Week): ReturnType<typeof todayTarget> {
  if (t.weekStart !== week.weekStart) return t;
  const date = Temporal.PlainDate.from(t.weekStart).add({ days: t.dayIndex }).toString();
  const i = week.days.findIndex((d) => d.date === date);
  return i < 0 ? t : { ...t, dayIndex: i };
}

/** The week nudge times from Settings > Planning (step 8). */
export const nudgeTimes = (cfg: AppConfig): NudgeTimes => ({ thu: cfg.plan.weekNudgeThu, fri: cfg.plan.weekNudgeFri, mon: cfg.plan.weekNudgeMon });

/** Settings > Planning as the UI uses it (defaults when the config is invalid). */
export function planningOf(cfg: AppConfig | null): PlanningSettings {
  if (!cfg) return { ...DEFAULT_PLAN, sizes: { ...DEFAULT_PLAN.sizes } };
  const { pickablePortfolioTypes: _ignored, ...rest } = cfg.plan;
  return rest;
}

const hasHoursFor = (ctx: Pick<ActionContext, "plan">, model: TimeModel, date: string) => hasHoursOn(ctx.plan, model, date);

/** Anything planned on a date: working hours, a flex session, unavailable time or picks. */
async function hasPlansOn(ctx: Pick<ActionContext, "plan">, model: TimeModel, date: string): Promise<boolean> {
  if ((await hasHoursFor(ctx, model, date))) return true;
  if (!ctx.plan) return false;
  return (await ctx.plan.unavailableBetween(date, date)).length > 0 || (await ctx.plan.picksFor(date)).some((p) => p.status === "planned" || p.status === "done");
}

const summarize = (s: SourceResult<unknown>): SourceSummary => {
  const { items, ...rest } = s;
  return { ...rest, itemCount: items.length };
};

/**
 * Clients for DevOps this week: every client with a focus block Mon–Thu (Dataverse or standing), first
 * appearance first, plus the standing-block clients (Cooptimize) even in a week where their block is missing,
 * since Open half-days can take Cooptimize work (Q19).
 */
export function weekClients(week: Week, standing: readonly { clientKey: string; clientName: string }[] = []): ClientRef[] {
  const seen = new Map<string, ClientRef>();
  for (const day of week.days.slice(0, 4))
    for (const slot of [day.am, day.pm]) for (const b of slot.focus) if (!seen.has(b.clientKey)) seen.set(b.clientKey, { clientKey: b.clientKey, clientName: b.clientName });
  for (const b of standing) if (!seen.has(b.clientKey)) seen.set(b.clientKey, { clientKey: b.clientKey, clientName: b.clientName });
  return [...seen.values()];
}

/**
 * The clients for a week (step 6d): the week's followed focus-block clients and standing-block clients, then my other
 * followed clients. `fetch`: those with DevOps, as week.load and Plan the week read them.
 */
async function devopsClients(ctx: ActionContext, cfg: AppConfig, weekStart: string, todayDate: string, refresh: { refresh?: boolean }, patterns: readonly FocusPattern[]): Promise<{ planClients: ClientRef[]; fetch: ClientRef[] }> {
  const weekConfig = cfg.week;
  const dvSource = ctx.makeDataverse(cfg.dataverse, userZone(weekConfig));
  const [mineR, follow] = await Promise.all([dvSource.myClients?.().catch(() => null), followOptions(dvSource, cfg, todayDate, refresh, patterns)]);
  const mine = mineR ?? [];
  const clients = followedKeys(weekClients(buildWeek({ weekStart, patterns, events: [], config: weekConfig }), weekConfig.standingBlocks), follow.patterns, follow.options);
  const planClients = [...clients];
  for (const c of followedKeys(mine, follow.patterns, follow.options)) if (!planClients.some((p) => p.clientKey === c.clientKey)) planClients.push({ clientKey: c.clientKey, clientName: c.clientName });
  const fetch = [...clients, ...followedKeys(mine, follow.patterns, follow.options).filter((c) => c.devops && !clients.some((w) => w.clientKey === c.clientKey)).map(({ clientKey, clientName }) => ({ clientKey, clientName }))];
  return { planClients, fetch };
}

/** Weeks whose committed features the DevOps read brings along: the week shown, today's week and next week. */
const featureWeeks = (weekStart: string, todayDate: string) => {
  const thisWeek = mondayOf(todayDate);
  return [weekStart, thisWeek, Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString()];
};

/**
 * The week's blocks from focus patterns and standing blocks: where a feature can go (step 8). S1 (D453): PTO comes the
 * same way as week.load's, so Plan the week's checks agree with Week: Dataverse PTO for the week, and out-of-office time
 * from Outlook (only those events; meetings don't change where a feature can go). Reads are the memoized ones.
 */
async function patternWeek(ctx: ActionContext, cfg: AppConfig, weekStart: string): Promise<Week> {
  const tz = userZone(cfg);
  const dv = cfg.dataverse.mySystemUserId ? ctx.makeDataverse(cfg.dataverse, tz) : null;
  const [r, ptoR, o] = await Promise.all([
    dv ? dv.load(weekStart).catch(() => null) : null,
    dv ? dv.pto(...weekRange(weekStart)).catch(() => null) : null,
    cfg.outlook ? ctx.makeOutlook(cfg.outlook, tz).load(weekStart).catch(() => null) : null,
  ]);
  const away = (o?.items ?? []).filter((e) => e.showAs === "oof" && !e.isPersonal);
  return buildWeek({ weekStart, patterns: r?.items ?? [], events: away, config: cfg.week, pto: ptoByDate(ptoR?.items ?? [], weekDates7(weekStart)) });
}

/**
 * Step 17: Plan ahead's week models. One focus-pattern read (everything running from week 1 on) and one PTO read for
 * the 12 weeks; meetings and personal events only for the first `withCalendars` weeks (as week.load reads them; none
 * for a calendar that isn't set up), so "mostly meetings" counts as in Plan the week.
 */
async function aheadWeekModels(ctx: ActionContext, cfg: AppConfig, weekStarts: string[], withCalendars: number, refresh: boolean): Promise<Week[]> {
  const tz = userZone(cfg);
  const opts = refresh ? { refresh: true } : {};
  const first = weekStarts[0]!;
  const last = Temporal.PlainDate.from(weekStarts[weekStarts.length - 1]!).add({ days: 6 }).toString();
  const dv = cfg.dataverse.mySystemUserId ? ctx.makeDataverse(cfg.dataverse, tz) : null;
  const [patterns, ptoR] = await Promise.all([dv ? dv.following(first, opts).catch(() => null) : null, dv ? dv.pto(first, last, opts).catch(() => null) : null]);
  const own = ctx.plan ? ownEventIds((await ctx.plan.ownEvents())) : new Set<string>();
  return Promise.all(
    weekStarts.map(async (w, i) => {
      let events: CalEvent[] = [];
      if (i < withCalendars) {
        const [o, g] = await Promise.all([
          cfg.outlook ? ctx.makeOutlook(cfg.outlook, tz).load(w, opts).catch(() => null) : null,
          cfg.google ? ctx.makeGoogle(cfg.google, tz).load(w, opts).catch(() => null) : null,
        ]);
        events = withoutOwn([...(o?.items ?? []), ...(g?.items ?? [])], own);
      }
      const sunday = Temporal.PlainDate.from(w).add({ days: 6 }).toString();
      return buildWeek({ weekStart: w, patterns: patterns?.items ?? [], events, config: cfg.week, pto: ptoByDate(ptoR?.items ?? [], weekDates7(w)), unavailable: (await ctx.plan?.unavailableBetween(w, sunday)) ?? [] });
    }),
  );
}

async function weekLoad(ctx: ActionContext, input: WeekLoadInput): Promise<WeekLoadData> {
  const loaded = await ctx.loadConfig();
  const parsed = loaded.parsed;
  const cfg = parsed.ok ? parsed.config : null;
  // With an invalid config nothing is guessed: no standing blocks either.
  const weekConfig = cfg?.week ?? { ...defaultWeekConfig, standingBlocks: [] };
  const model = weekConfig.hours;
  const tz = userZone(model);
  const now = input.now ?? ctx.now();
  const todayDate = localToday(now, tz);
  // A flex session that has ended opens its update follow-up (D126), on any read. By the server's clock, never the UI's
  // ?now (a check could otherwise open follow-ups for sessions still ahead; step 6c, like D118).
  (await ctx.plan?.openFlexFollowUps(Temporal.Instant.from(ctx.now())));
  const todayPlans = (await hasPlansOn(ctx, model, todayDate));
  const weekStart = input.weekStart ?? defaultWeekStart(todayDate, todayPlans);

  const refresh = input.refresh ? { refresh: true } : {};
  // A calendar that isn't set up says so (no-demo-leak): no stand-in meetings, ever.
  const outlookP: Promise<SourceResult<CalEvent>> = cfg?.outlook ? ctx.makeOutlook(cfg.outlook, tz).load(weekStart, refresh) : Promise.resolve(calendarNotSetUp("outlook"));
  const googleP: Promise<SourceResult<CalEvent>> = cfg?.google ? ctx.makeGoogle(cfg.google, tz).load(weekStart, refresh) : Promise.resolve(calendarNotSetUp("google"));

  let dataverse: SourceResult<FocusPattern>;
  let ptoP: Promise<SourceResult<PtoEntry> | null> = Promise.resolve(null);
  let aheadP: Promise<SourceResult<PtoEntry> | null> = Promise.resolve(null);
  let devopsP: Promise<ClientWork[] | null> = Promise.resolve(null);
  let planClients: ClientRef[] = [];
  if (!cfg) {
    const n = parsed.ok ? 0 : parsed.errors.length;
    dataverse = {
      source: "dataverse",
      status: "misconfigured",
      fetchedAt: null,
      fromCache: false,
      items: [],
      message: `Config needs attention (${n} ${n === 1 ? "field" : "fields"})`,
      fixAction: "open_settings",
    };
  } else {
    let dv = cfg.dataverse;
    let resolveError: Extract<MatchResult, { ok: false }> | null = null;
    if (!dv.mySystemUserId) {
      const r = await matchMe(ctx, dv, tz);
      if (r.ok) {
        await ctx.saveSystemUserId(r.id);
        dv = { ...dv, mySystemUserId: r.id };
      } else resolveError = r;
    }
    dataverse = resolveError
      ? resolveError.reason === "failed"
        ? { source: "dataverse", status: "unreachable", fetchedAt: null, fromCache: false, items: [], message: resolveError.message }
        : { source: "dataverse", status: "misconfigured", fetchedAt: null, fromCache: false, items: [], message: resolveError.message, fixAction: "open_settings" }
      : await ctx.makeDataverse(dv, tz).load(weekStart, refresh);
    if (!resolveError) {
      // PTO (step 6) alongside everything else; a failure falls back to its cache inside the source.
      const ptoSource = ctx.makeDataverse(dv, tz);
      ptoP = ptoSource.pto(...weekRange(weekStart), refresh).catch(() => null);
      // Ahead of today for the planning target; its failure only means the target can't skip PTO.
      const aheadFrom = mondayOf(todayDate);
      aheadP = ptoSource.pto(aheadFrom, Temporal.PlainDate.from(aheadFrom).add({ days: AHEAD_DAYS }).toString(), refresh).catch(() => null);
      // Start DevOps as soon as the week's clients are known, alongside the calendars. Each client is isolated
      // inside the source; anything unexpected here only drops DevOps, never the week.
      // Plus every client I'm an Account Worker on (Q21), so Open half-days can take their work. Only those
      // with DevOps set up are fetched; the rest can still take a typed intention.
      // Only followed clients (step 6d, replaces Q21 for DevOps): the rest get no PAT read, no call and no status.
      const picked = await devopsClients(ctx, { ...cfg, dataverse: dv }, weekStart, todayDate, refresh, dataverse.items);
      planClients = picked.planClients;
      // Items an open follow-up is about are read by id too, so a completed one can close its follow-up (step 7).
      const watch = ctx.plan ? watchedIds((await ctx.plan.openFollowUps())) : {};
      // Features on the week lists of this week, today's week and next (step 8), so Plan the day can offer their
      // stories. Every list item (features and stories) is also read by id, done ones included, so progress can count
      // what DevOps shows as Completed (step 11).
      const features: Record<string, number[]> = {};
      if (ctx.plan)
        for (const f of (await ctx.plan.weekFeaturesFor(featureWeeks(weekStart, todayDate)))) {
          if (f.level === "feature") (features[f.clientKey] ??= []).includes(f.itemId) || features[f.clientKey]!.push(f.itemId);
          (watch[f.clientKey] ??= []).includes(f.itemId) || watch[f.clientKey]!.push(f.itemId);
        }
      devopsP = ctx.makeDevOps(dv, tz).load(picked.fetch, { ...refresh, watch, features }).catch(() => null);
    }
  }

  // Step 13: with write access, scan the week for edit facts and sync FocusTime's own events (Outlook changes come
  // back to the timeboxes; Q69 rebuilds lost records). Its failure only means no sync and no edit facts this time.
  const ow = cfg?.outlook ? ctx.makeOutlook(cfg.outlook, tz).write ?? null : null;
  const syncP = (async () => {
    if (!cfg || !ow || !ctx.plan) return { canWrite: false, facts: {} };
    const access = await ow.access().catch(() => null);
    if (access?.status !== "write") return { canWrite: false, facts: {} };
    const known = [...new Map([[INTERNAL_CLIENT, INTERNAL_CLIENT], ...Object.entries(cfg.clientSettings).map(([k, v]) => [k, v.name ?? k] as [string, string]), ...planClients.map((c) => [c.clientKey, c.clientName] as [string, string])]).entries()].map(([key, name]) => ({ key, name }));
    const r = await syncWeek({ plan: ctx.plan, ow, cfg, weekStart, refresh: !!input.refresh, now: ctx.now, clients: known }).catch(() => null);
    return { canWrite: true, facts: r?.facts ?? {} };
  })();
  const [outlook, google, devops, ptoResult, ahead, synced] = await Promise.all([outlookP, googleP, devopsP, ptoP, aheadP, syncP]);
  (await ctx.plan?.closeHelpFollowUps(Temporal.Instant.from(ctx.now())));
  const pto = ptoByDate(ptoResult?.items ?? [], weekDates7(weekStart));
  const ptoAhead = [...new Set((ahead?.items ?? []).map((e) => e.date))].sort();
  const sunday = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
  const unavailable = (await ctx.plan?.unavailableBetween(weekStart, sunday)) ?? [];
  const flex = (await ctx.plan?.flexBetween(weekStart, sunday)) ?? [];
  const weekendPicks = (await ctx.plan?.picksBetween(weekDates7(weekStart)[5]!, sunday)) ?? [];
  const weekendPlanned = new Set(weekDates7(weekStart).slice(5).filter((d) => weekendPicks.some((p) => p.date === d && (p.status === "planned" || p.status === "done"))));
  // FocusTime's own Outlook events show once, as timeboxes, and never count as meetings in risk rules (step 12).
  const own = ctx.plan ? ownEventIds((await ctx.plan.ownEvents())) : new Set<string>();
  const week = buildWeek({ weekStart, patterns: dataverse.items, events: withoutOwn([...outlook.items, ...google.items], own), config: weekConfig, pto, unavailable, flex, viewRange: input.viewRange ?? cfg?.ui.viewRange ?? DEFAULT_UI.viewRange, weekendPlanned });
  const todayDay = week.days.find((d) => d.date === todayDate);
  const clientColors = cfg ? cfg.clients : Object.fromEntries(Object.values(defaultClients).map((c) => [c.shortName, c.color]));

  // Follow-up rules (step 7) on the fresh DevOps results, and borrowed time paid by done payback picks. By the server's
  // clock, like the flex follow-ups.
  const serverToday = localToday(ctx.now(), tz);
  const names = new Map([...planClients.map((c) => [c.clientKey, c.clientName] as const), ...(devops ?? []).map((w) => [w.clientKey, w.clientName] as const)]);
  if (ctx.plan) {
    await applyFollowUpRules(ctx.plan, { today: serverToday, work: devops, internal: internalClients(cfg), clientName: nameOf(cfg, (k) => names.get(k)), isWorkday: workdayOf(cfg) });
    (await ctx.plan.settleBorrowed());
  }
  const todayPlan = (await ctx.plan?.day(todayDate)) ?? null;
  // The focus timer warns 5 minutes before meetings and block ends (server/timer.ts); keep today's points fresh.
  if (ctx.plan && todayDay) (await ctx.plan.setState("warn_points", { date: todayDate, points: warnPoints(todayDay, tz) }));
  const todayOff = ptoAhead.includes(todayDate) || !!pto[todayDate];
  // Q51: committed features show their current DevOps title (fresh results only); the stored one is the fallback.
  const currentTitle = titleFrom(devops);
  // A3: what the view reads from the store, read before it is put together (the store is async).
  const plan = ctx.plan;
  const open = plan ? await plan.openFollowUps() : [];
  const weekPlans = plan ? await plan.week(week.days.map((d) => d.date)) : null;
  const committedWeeks = plan ? await plan.committedWeeks() : new Set<IsoDate>();
  const aheadSeen = plan ? await plan.markedDates(AHEAD_SEEN_MARK) : new Set<IsoDate>();
  const clientName = nameOf(cfg, (k) => names.get(k));
  const writeLog = plan ? await plan.writeLog(1000) : [];
  return {
    weekStart,
    week,
    today: columnOf(todayTarget(now, model, { todayHasPlans: todayPlans, hasEve: !!todayDay?.eve }), week),
    plan: weekPlans,
    planClients,
    planDay: { date: todayDate, workday: (await hasHoursFor(ctx, model, todayDate)) && !todayOff, committed: !!todayPlan?.committedAt, available: !!ctx.plan },
    ptoAhead,
    sources: [dataverse, ...(ptoResult ? [ptoResult] : []), outlook, google].map(summarize),
    devops,
    clients: clientColors,
    hours: model,
    thresholds: weekConfig.thresholds,
    planning: planningOf(cfg),
    focus: cfg?.focus ?? DEFAULT_FOCUS,
    media: ctx.media ? await ctx.media.status() : { players: false, spotify: false },
    timer: timerView((await ctx.plan?.getState<TimerState>(TIMER_KEY)) ?? null, Temporal.Instant.from(ctx.now())),
    openFollowUps: open.length,
    captures: (await ctx.plan?.inboxCount()) ?? 0,
    followUps: plan ? await mapSeq(open.filter((f) => !f.snoozedUntil || f.snoozedUntil <= serverToday), (f) => followUpView(plan, f, serverToday, clientName)) : [],
    focused: plan && weekPlans ? await plan.focusedSeconds(Object.values(weekPlans).flatMap((d) => d.picks.map((p) => p.id))) : {},
    resumeNotes: ctx.plan ? Object.fromEntries(Object.entries((await ctx.plan.latestNotes())).map(([k, n]) => [k, noteView(n)])) : {},
    borrowed: ctx.plan ? (await ctx.plan.borrowedFor(weekStart, sunday)).map(borrowedView) : [],
    closeOut: { date: todayDate, done: !!todayPlan?.closedOutAt },
    checkIn: { date: todayDate, done: !!(await ctx.plan?.marked(CHECKIN_DONE_MARK, todayDate)) },
    weekPlan: ctx.plan ? withTitles(weekPlanView((await ctx.plan.weekPlan(weekStart))), currentTitle) : null,
    weekFeatures: ctx.plan ? withCurrentTitles((await ctx.plan.weekFeaturesFor(featureWeeks(weekStart, todayDate))), currentTitle) : [],
    // Step 17: the Plan ahead rituals due now (a dot on Roadmap's Plan ahead).
    aheadDue: ctx.plan
      ? aheadRitualsDue({ today: todayDate, time: Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainTime().toString().slice(0, 5), workStart: hoursOn(model, todayDate).segments[0]?.start ?? null, pto: todayOff, weekCommitted: (w) => committedWeeks.has(w), seen: (k) => aheadSeen.has(k) }).map((r) => r.kind)
      : [],
    weekNudge: { badge: ctx.plan && cfg ? weekNudges(Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz), nudgeTimes(cfg), (w) => committedWeeks.has(w)).badge : null },
    // Step 16.2: Planned ✓ on the Week tab's mode switch, for this week, next week and the week shown.
    weekCommitted: Object.fromEntries([...new Set([mondayOf(todayDate), Temporal.PlainDate.from(mondayOf(todayDate)).add({ days: 7 }).toString(), week.days[0]!.date])].map((w) => [w, committedWeeks.has(w)])),
    timeboxes: plan ? await mapSeq(await timeboxesFor(plan, weekStart, sunday), (t) => timeboxView(t, plan, cfg)) : [],
    timeboxSettings: cfg?.timebox ?? DEFAULT_TIMEBOX,
    eventEdit: synced.facts,
    canWrite: synced.canWrite,
    invites: plan ? (await plan.invitesFrom(Temporal.PlainDate.from(weekStart).subtract({ days: 7 }).toString())).map((i) => ({ writeId: writeLog.find((e) => e.uid === i.uid && e.op === "create" && e.status === "confirmed" && !e.undoneBy)?.id ?? null, uid: i.uid, clientKey: i.clientKey, itemId: i.itemId, pickId: i.pickId, timeboxId: i.timeboxId, title: i.title, start: i.start, end: i.end, names: i.attendees.map((a) => a.name), teams: i.teams, status: i.status })) : [],
    collab: cfg?.collab ?? DEFAULT_COLLAB,
    devopsWrite: ctx.plan && ctx.devopsWriter && ctx.writePats ? (await ctx.plan.devopsIdentities()).map((i) => i.clientKey) : [],
    // Step 14.5 (D256): write PATs and app secrets that expire within 14 days, for Today.
    expiring: (await expiringFor(ctx.plan, cfg, serverToday, (k) => names.get(k))),
    ui: cfg?.ui ?? DEFAULT_UI,
    config: { ok: parsed.ok, path: loaded.path, created: !!loaded.created, errors: parsed.ok ? [] : parsed.errors },
    demo: !!ctx.demo?.on,
  };
}

const noInput = (input: unknown) => input === undefined || (typeof input === "object" && input !== null && !Array.isArray(input) && Object.keys(input).length === 0);

async function configured(ctx: ActionContext): Promise<AppConfig | null> {
  const loaded = await ctx.loadConfig();
  return loaded.parsed.ok ? loaded.parsed.config : null;
}

async function connect(ctx: ActionContext, which: "outlook" | "google") {
  const cfg = await configured(ctx);
  if (!cfg) return { status: "failed", message: "Fix the config first" };
  const tz = userZone(cfg);
  if (which === "outlook") return cfg.outlook ? ctx.makeOutlook(cfg.outlook, tz).connect() : { status: "failed", message: "Add outlook.client_id to config first" };
  return cfg.google ? ctx.makeGoogle(cfg.google, tz).connect() : { status: "failed", message: "Add google.client_id to config first" };
}

/** The context with config's "me" taken from the sign-in, and a found Dataverse user kept with the sign-in. */
function withSignedIn(ctx: ActionContext): ActionContext {
  const me = storedIdentity(ctx.plan);
  if (!me) return ctx;
  return {
    ...ctx,
    loadConfig: async () => {
      const r = await ctx.loadConfig();
      return { ...r, parsed: withMe(r.parsed, (await storedIdentity(ctx.plan))) };
    },
    saveSystemUserId: async (id) => {
      const cur = (await storedIdentity(ctx.plan));
      const r = await ctx.loadConfig();
      const email = r.parsed.ok ? withMe(r.parsed, cur) : null;
      if (cur && email?.ok) (await ctx.plan!.setAccountState(IDENTITY_KEY, { ...cur, systemUserId: id, systemUserEmail: email.config.dataverse.myEmail } satisfies StoredIdentity));
      else await ctx.saveSystemUserId(id);
    },
  };
}

/** Step 16.3: Teams presence (my status during focus, teammates' presence). */
export async function presenceContext(ctx: ActionContext): Promise<PresenceContext> {
  return {
    ...(ctx.plan ? { plan: ctx.plan } : {}),
    config: () => configured(ctx),
    account: await accountOf(ctx),
    team: async (cfg) => {
      const r = await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).teammates();
      return r.ok ? r.people : null;
    },
    now: ctx.now,
  };
}

/** The pieces the account and VM actions need. */
async function accountOf(ctx: ActionContext): Promise<MicrosoftAccount | null> {
  const cfg = await configured(ctx);
  return cfg && ctx.account ? ctx.account(cfg) : null;
}
export async function vmContext(ctx: ActionContext): Promise<VmContext> {
  const account = await accountOf(ctx);
  return {
    ...(ctx.plan ? { plan: ctx.plan } : {}),
    config: () => configured(ctx),
    account,
    azure: ctx.azure ?? null,
    now: ctx.now,
    ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
    focusRunning: async () => !!(await ctx.plan?.getState<TimerState>(TIMER_KEY))?.runningSince,
    workday: async (cfg, date) => (await hasHoursOn(ctx.plan, cfg.week.hours, date)) && !(await ptoOn(ctx, cfg, date)),
  };
}

export async function dispatch(ctx: ActionContext, req: ActionRequest): Promise<ActionResponse> {
  // Only registered actions (actions/registry.ts). The switch below is exhaustive over them: an action added
  // to the registry without a case, or a case for a name not in the registry, fails the type check.
  if (!isActionName(req.action)) return bad("unknown action");
  const action: ActionName = req.action;
  // Step 15.4: "me" comes from the Microsoft sign-in (config's my_email stays the fallback). Settings writes the file as
  // is (raw), but shows "me" and finds the Dataverse user the same way as every other action (settingsCtx below): it
  // once read the raw file only, so a person whose Dataverse user was kept with their sign-in saw no clients (A5 fix).
  const raw = ctx;
  if (action !== "settings.load" && action !== "settings.save") ctx = withSignedIn(ctx);
  if (ctx.demo?.on && DEMO_REFUSED.includes(action)) return { ok: false, status: 403, error: DEMO_REFUSAL, code: "demo" };
  switch (action) {
    case "demo.set": {
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "on") || typeof i.on !== "boolean") return bad("demo.set takes { on: true | false }");
      if (!ctx.demo) return { ok: false, status: 503, error: "Demo mode isn't available here" };
      await ctx.demo.set(i.on);
      return { ok: true, data: { demo: i.on } };
    }
    case "auth.connect_outlook_write": {
      // Step 12: the same sign-in, asking for Calendars.ReadWrite as well. Reading keeps its own token.
      if (!noInput(req.input)) return bad(`${req.action} takes no input`);
      const cfg = await configured(ctx);
      if (!cfg?.outlook) return { ok: true, data: { status: "failed", message: "Add outlook.client_id to config first" } };
      return { ok: true, data: await ctx.makeOutlook(cfg.outlook, userZone(cfg)).connect({ write: true }) };
    }
    case "outlook.open": {
      // Step 13: Outlook on the web, for meetings FocusTime won't change. Only Outlook links, in the person's browser.
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "url")) return bad("outlook.open takes { url }");
      const url = outlookLink(i.url);
      if (!url) return { ok: false, status: 422, error: "Only Outlook on the web links open from here" };
      if (!ctx.links) return { ok: false, status: 503, error: "Opening links is not available here" };
      return openLink(ctx.links, url);
    }
    case "collab.candidates":
    case "collab.suggest":
    case "collab.preview_invite":
      return collabAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          dataverse: (cfg) => ctx.makeDataverse(cfg.dataverse, userZone(cfg)),
          outlook: (cfg) => {
            if (!cfg.outlook) return null;
            const o = ctx.makeOutlook(cfg.outlook, userZone(cfg));
            return { write: o.write ?? null, schedule: o.schedule ?? null, source: o };
          },
          google: (cfg) => (cfg.google ? ctx.makeGoogle(cfg.google, userZone(cfg)) : null),
          blocks: (cfg, w) => patternWeek(ctx, cfg, w),
          now: ctx.now,
        },
        action,
        req.input,
      );
    case "timebox.resolve":
    case "timebox.add":
    case "timebox.add_many":
    case "timebox.update":
    case "timebox.remove":
    case "timebox.set_outlook":
    case "write.status":
    case "write.preview":
    case "write.confirm":
    case "write.retry":
    case "write.log":
      return timeboxAction(
        { plan: ctx.plan, config: () => configured(ctx), outlook: (cfg) => (cfg.outlook ? ctx.makeOutlook(cfg.outlook, userZone(cfg)).write ?? null : null), now: ctx.now, ...(ctx.sleep ? { sleep: ctx.sleep } : {}) },
        action,
        req.input,
      );
    case "devops.set_write_pat":
    case "devops.clear_write_pat":
    case "devops.write_status":
    case "devops.states":
    case "devops.preview":
    case "devops.confirm":
    case "devops.retry":
    case "devops.log":
      return devopsWriteAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          // Never the company read PAT: this read doesn't select it.
          targets: (cfg, keys) => ctx.makeDataverse(cfg.dataverse, userZone(cfg)).devopsTargets(keys, { withPat: false }),
          writer: ctx.devopsWriter ?? null,
          pats: ctx.writePats ?? null,
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
          now: ctx.now,
          ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
        },
        action,
        req.input,
      );
    case "auth.status":
    case "auth.sign_in":
    case "auth.sign_out":
      return accountAction({ ...(ctx.plan ? { plan: ctx.plan } : {}), account: await accountOf(ctx), now: ctx.now, clearPhotos: () => clearPhotos(ctx.photoCache ?? null), renameNote: ctx.renameNote ?? null }, action, req.input);
    case "vm.find":
    case "vm.choose":
    case "vm.status":
    case "vm.preview":
    case "vm.confirm":
    case "vm.restore":
    case "vm.dismiss_prompt":
    case "vm.log":
    case "vm.start_now":
      return vmAction(await vmContext(ctx), action, req.input);
    case "notify.test": {
      if (!noInput(req.input)) return bad("notify.test takes no input");
      if (!ctx.notifications) return { ok: false, status: 503, error: "Notifications aren't available here" };
      await ctx.notifications.test();
      return { ok: true, data: { sent: true } };
    }
    case "notify.sample": {
      const i = req.input as { kind?: unknown; live?: unknown; gated?: unknown } | null;
      if (!i || typeof i !== "object" || Object.keys(i).some((k) => !["kind", "live", "gated"].includes(k)) || typeof i.kind !== "string" || (i.live !== undefined && typeof i.live !== "boolean") || (i.gated !== undefined && typeof i.gated !== "boolean"))
        return bad("notify.sample takes { kind, live?, gated? }");
      if (!ctx.notifications) return { ok: false, status: 503, error: "Notifications aren't available here" };
      if (!(await ctx.notifications.sample(i.kind, i.live === true, i.gated === true))) return bad("Unknown notification kind");
      return { ok: true, data: { sent: i.kind } };
    }
    case "auth.connect_microsoft":
      // Step 15.4: Outlook's connect is the one Microsoft sign-in.
      if (!noInput(req.input)) return bad(`${req.action} takes no input`);
      if (ctx.account) return accountAction({ ...(ctx.plan ? { plan: ctx.plan } : {}), account: await accountOf(ctx), now: ctx.now }, "auth.sign_in", {});
      return { ok: true, data: await connect(ctx, "outlook") };
    case "auth.connect_google": {
      if (!noInput(req.input)) return bad(`${req.action} takes no input`);
      return { ok: true, data: await connect(ctx, "google") };
    }
    case "auth.disconnect": {
      const input = req.input as { source?: unknown } | undefined;
      if (typeof input !== "object" || input === null || Object.keys(input).length !== 1) return bad("auth.disconnect takes { source }");
      if (input.source === "dataverse") return bad("Dataverse uses an app secret set up outside FocusTime; remove it with secret-tool if needed");
      if (input.source !== "outlook" && input.source !== "google") return bad("source must be outlook or google");
      const cfg = await configured(ctx);
      const tz = userZone(cfg);
      const section = input.source === "outlook" ? cfg?.outlook : cfg?.google;
      if (!section) return { ok: true, data: { status: "not_configured" } };
      const src = input.source === "outlook" ? ctx.makeOutlook(section as OutlookConfig, tz) : ctx.makeGoogle(section as GoogleConfig, tz);
      await src.disconnect();
      // Outlook's token is the Microsoft sign-in (step 15.4): disconnecting it signs out.
      if (input.source === "outlook") (await ctx.plan?.setAccountState(IDENTITY_KEY, null));
      return { ok: true, data: { status: "disconnected" } };
    }
    case "week.load": {
      const input = validateWeekLoad(req.input ?? {});
      if (typeof input === "string") return bad(input);
      return { ok: true, data: await weekLoad(ctx, input) };
    }
    case "link.open": {
      // Open a work item link in the person's browser. The link must be on the client's own DevOps org.
      const input = req.input as { clientKey?: unknown; url?: unknown } | undefined;
      if (typeof input !== "object" || input === null || Array.isArray(input)) return bad("link.open takes { clientKey, url }");
      for (const k of Object.keys(input)) if (k !== "clientKey" && k !== "url") return bad(`unknown input field ${k}`);
      if (typeof input.clientKey !== "string" || !input.clientKey.trim() || input.clientKey.length > 100) return bad("clientKey must be text");
      const key = input.clientKey;
      const cfg = await configured(ctx);
      if (!cfg) return { ok: false, status: 409, error: "Fix the config first" };
      const org = ctx.makeDevOps(cfg.dataverse, userZone(cfg)).orgOf(key);
      const checked = checkDevOpsUrl(input.url, org);
      if (!checked.ok) return { ok: false, status: 422, error: checked.error };
      if (!ctx.links) return { ok: false, status: 503, error: "Opening links is not available here" };
      return openLink(ctx.links, checked.url);
    }
    case "source.status": {
      if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Object.keys(req.input).length)) return bad("source.status takes no input");
      const d = await weekLoad(ctx, {});
      return { ok: true, data: { sources: d.sources, config: d.config } };
    }
    case "ui.set_theme": {
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "theme")) return bad("input must be { theme }");
      if (typeof i.theme !== "string" || !(THEMES as readonly string[]).includes(i.theme)) return bad(`theme must be one of ${THEMES.join(", ")}`);
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => setValue(text, "ui", "theme", i.theme as string, "Display (step 6b). Changed from Settings or the command menu."));
      if (!r.ok) return { ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` };
      return { ok: true, data: { ui: r.parsed.config.ui } };
    }
    case "ui.first_launch": {
      // Step 17.5: the welcome moment shows once, ever: the first call marks it in the plan store. Not in demo mode
      // (its store is in memory, so it would show on every start) and not without a plan store.
      if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Object.keys(req.input).length)) return bad("ui.first_launch takes no input");
      if (ctx.demo?.on || !ctx.plan) return { ok: true, data: { first: false } };
      return { ok: true, data: { first: (await ctx.plan.markOnce(FIRST_LAUNCH_MARK, "once")) } };
    }
    case "notices.list":
    case "notices.read":
    case "push.status":
    case "push.subscribe":
    case "push.remove":
      return noticeAction({ plan: ctx.plan, push: ctx.push, demo: !!ctx.demo?.on }, action, req.input);
    case "setup.load":
    case "setup.prefill":
    case "setup.mark":
    case "setup.reset": {
      return setupAction(
        {
          plan: ctx.plan,
          demo: !!ctx.demo?.on,
          env: ctx.env ?? "local",
          config: () => configured(ctx),
          clients: async (cfg): Promise<SetupClient[] | null> => {
            const dv = ctx.makeDataverse(cfg.dataverse, userZone(cfg));
            const mine = await dv.myClients();
            if (!mine) return null;
            // The DevOps organization per client (for the PAT page link); never the company PAT.
            const t = mine.length ? await dv.devopsTargets(mine.map((c) => c.clientKey), { withPat: false }).catch(() => null) : null;
            return Promise.all(
              mine.map(async (c) => {
                const w = (await ctx.plan?.devopsIdentity(c.clientKey)) ?? null;
                const org = t?.ok ? (t.targets.find((x) => x.clientKey === c.clientKey)?.org ?? null) : null;
                return { key: c.clientKey, name: c.clientName, org, write: w ? { name: w.name, email: w.email } : null };
              }),
            );
          },
          workingHours: async (cfg) => {
            // Outlook's working hours are the mailbox settings'; getSchedule on my own address returns them on the
            // read token (Calendars.ReadBasic), so no new permission.
            const reader = cfg.outlook ? ctx.makeOutlook(cfg.outlook, userZone(cfg)).schedule : undefined;
            const me = (await ctx.signedInAs?.())?.email ?? cfg.dataverse.myEmail;
            if (!reader || !me) return null;
            const zone = userZone(cfg);
            const day = Temporal.PlainDate.from(localToday(ctx.now(), zone)).toZonedDateTime({ timeZone: zone });
            const [mine] = await reader.schedule([me], day.toInstant().toString(), day.add({ days: 1 }).toInstant().toString(), zone);
            return mine && !mine.hoursUnknown && !mine.problem ? mine.workingHours : null;
          },
        },
        action,
        req.input ?? {},
      );
    }
    case "ui.tour_offer": {
      // G1: the tour link shows on a person's first Today until they open the Guide from it or dismiss it; then
      // never again, on any device (a plan store marker, per user). {} asks; { done: true } records it.
      const i = req.input as Record<string, unknown> | null | undefined;
      const done = i !== undefined && i !== null && typeof i === "object" && !Array.isArray(i) && Object.keys(i).length === 1 && i.done === true;
      if (i !== undefined && !done && (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).length)) return bad("input must be {} or { done: true }");
      if (ctx.demo?.on || !ctx.plan) return { ok: true, data: { show: false } };
      if (done) {
        await ctx.plan.markOnce(TOUR_MARK, "once");
        return { ok: true, data: { show: false } };
      }
      return { ok: true, data: { show: !(await ctx.plan.marked(TOUR_MARK, "once")) } };
    }
    case "ui.set_reduce_motion": {
      // Step 17.5: Settings > Display "Reduce motion", besides the system's reduced motion setting.
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "on") || typeof i.on !== "boolean") return bad("input must be { on: true or false }");
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => setValue(text, "ui", "reduce_motion", i.on as boolean, "Display (step 17.5): no opening and closing animation."));
      if (!r.ok) return { ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` };
      return { ok: true, data: { ui: r.parsed.config.ui } };
    }
    case "ui.set_text_size": {
      // U5 (D401): Settings > Display "Text size", Ctrl+plus, Ctrl+minus and Ctrl+0. Saved in [ui] text_size.
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "size") || typeof i.size !== "string" || !(TEXT_SIZES as readonly string[]).includes(i.size))
        return bad(`input must be { size: ${TEXT_SIZES.map((x) => `"${x}"`).join(" | ")} }`);
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => setValue(text, "ui", "text_size", i.size as string, "Display (U5): text size, default, large or larger."));
      if (!r.ok) return { ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` };
      return { ok: true, data: { ui: r.parsed.config.ui } };
    }
    case "ui.set_show_personal": {
      // U5.1 (D408): G, Week's and Today's ⋯ and Settings > Display "Personal events". Saved in [ui] show_personal.
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "show") || typeof i.show !== "boolean") return bad("input must be { show: boolean }");
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => setValue(text, "ui", "show_personal", i.show as boolean, "Display (U5.1): show personal events on Week and Today."));
      if (!r.ok) return { ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` };
      return { ok: true, data: { ui: r.parsed.config.ui } };
    }
    case "data.export_mine": {
      if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Object.keys(req.input).length)) return bad("data.export_mine takes {}");
      if (!ctx.myData) return { ok: false, status: 503, error: "Export isn't available here" };
      return { ok: true, data: { fileName: `focustime-export-${ctx.now().slice(0, 10)}.json`, export: await ctx.myData.export() } };
    }
    case "data.delete_mine": {
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Object.keys(i).some((k) => k !== "confirm") || i.confirm !== "delete") return bad('input must be { confirm: "delete" }');
      if (!ctx.myData) return { ok: false, status: 503, error: "Delete isn't available here" };
      return { ok: true, data: await ctx.myData.remove() };
    }
    case "settings.load":
    case "settings.save":
    case "secret.set":
    case "data.export":
      return settingsAction(
        settingsCtx(raw, ctx),
        action,
        req.input,
      );
    case "ui.set_view_range":
    case "hours.set_day":
    case "hours.clear_day":
    case "unavailable.add":
    case "unavailable.remove":
    case "flex.add":
    case "flex.remove":
      return timeAction(
        { plan: ctx.plan, config: () => configured(ctx), ...(ctx.writeConfig ? { writeConfig: ctx.writeConfig } : {}), devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)) },
        action,
        req.input,
      );
    case "timer.start":
    case "timer.pause":
    case "timer.resume":
    case "timer.stop":
    case "timer.extend":
    case "timer.done":
    case "timer.next":
    case "timer.deep":
    case "playlist.open":
    case "plan.reset": {
      const r = await timerAction({ plan: ctx.plan, config: () => configured(ctx), now: ctx.now, media: ctx.media }, action, req.input);
      // Step 16.3: my Teams status follows the session (not waited for; the server's tick also runs it).
      if (r.ok && action.startsWith("timer.")) void syncTeamsStatusWith(ctx.plan, () => presenceContext(ctx)).catch(() => {});
      return r;
    }
    case "presence.status":
    case "presence.people":
    case "presence.log":
      return presenceAction(await presenceContext(ctx), action, req.input);
    case "people.photos":
      return photoAction({ ...(await presenceContext(ctx)), cache: ctx.photoCache ?? null }, req.input);
    case "media.status": {
      // Step 10: read-only check of the host's media control and the Spotify app. Nothing is run or installed.
      if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Object.keys(req.input).length)) return bad("media.status takes {}");
      return { ok: true, data: ctx.media ? await ctx.media.status() : { players: false, spotify: false } };
    }
    case "closeout.load":
    case "closeout.commit":
    case "checkin.done":
    case "pick.make_up":
    case "note.set":
    case "borrow.pay":
      return closeoutAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
          ptoAhead: (cfg, monday) => ptoAheadOf(ctx, cfg, monday),
          now: ctx.now,
        },
        action,
        req.input,
      );
    case "followups.list":
    case "followup.add":
    case "followup.edit":
    case "followup.close":
    case "followup.not_needed":
    case "followup.snooze":
    case "followup.delete":
    case "followup.people":
    case "followups.review":
      return followUpAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          dataverse: (cfg) => ctx.makeDataverse(cfg.dataverse, userZone(cfg)),
          people: (cfg) => (cfg.outlook ? ctx.makeOutlook(cfg.outlook, userZone(cfg)).people ?? null : null),
          now: ctx.now,
        },
        action,
        req.input,
      );
    case "capture.add":
    case "capture.load":
    case "capture.route":
    case "capture.features":
    case "draft.add_feature":
      return captureAction(
        {
          plan: ctx.plan,
          config: async () => {
            const loaded = await ctx.loadConfig().catch(() => null);
            return loaded?.parsed.ok ? loaded.parsed.config : null;
          },
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
          clients: async (cfg, weekStart) => {
            const today = localToday(ctx.now(), userZone(cfg));
            const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).load(weekStart, {}).catch(() => null) : null;
            return (await devopsClients(ctx, cfg, weekStart, today, {}, dv?.items ?? [])).fetch;
          },
          now: ctx.now,
        },
        action,
        req.input,
      );
    case "roadmap.load":
    case "roadmap.ahead":
    case "roadmap.set_dates":
      // Step 16 (D278): read-only; the same followed clients and portfolio read as Plan the week, for this week.
      // Step 17: Plan ahead's 12 weeks; dragged dates stay in the plan store until saved to DevOps.
      return roadmapAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
          clients: async (cfg, weekStart, refresh) => {
            const today = localToday(ctx.now(), userZone(cfg));
            const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).load(weekStart, refresh ? { refresh } : {}).catch(() => null) : null;
            return (await devopsClients(ctx, cfg, weekStart, today, refresh ? { refresh } : {}, dv?.items ?? [])).fetch;
          },
          now: ctx.now,
          team: async (cfg) => {
            const r = await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).teammates();
            return r.ok ? r.people : null;
          },
          weeks: (cfg, weekStarts, withCalendars, refresh) => aheadWeekModels(ctx, cfg, weekStarts, withCalendars, refresh),
        },
        action,
        req.input,
      );
    case "weekplan.load":
    case "weekplan.set_feature":
    case "weekplan.place":
    case "weekplan.commit":
    case "weekplan.add":
    case "weekplan.set_tier":
    case "weekplan.set_estimate":
    case "weekplan.set_size":
    case "weekplan.reorder":
    case "weekplan.remove":
    case "weekplan.mark_done":
    case "weekplan.headsup":
    case "weekplan.add_draft":
    case "weekplan.draft_tier":
    case "weekplan.nothing":
    case "feature.brief":
    case "feature.mark_breakdown":
    case "followup.ask_priorities":
      return weekPlanAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
          clients: async (cfg, weekStart, refresh) => {
            const today = localToday(ctx.now(), userZone(cfg));
            const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).load(weekStart, refresh ? { refresh } : {}).catch(() => null) : null;
            return (await devopsClients(ctx, cfg, weekStart, today, refresh ? { refresh } : {}, dv?.items ?? [])).fetch;
          },
          blocks: (cfg, weekStart) => patternWeek(ctx, cfg, weekStart),
          now: ctx.now,
        },
        action,
        req.input,
      );
    case "planday.start":
    case "planday.commit":
    case "pick.add":
    case "pick.remove":
    case "pick.set_size":
    case "pick.move":
    case "pick.mark_done":
    case "draft.add_story":
    case "draft.set_parent":
    case "draft.remove":
    case "draft.update":
      return planAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
          pto: (cfg, date) => ptoOn(ctx, cfg, date),
          ptoAhead: (cfg, monday) => ptoAheadOf(ctx, cfg, monday),
          now: ctx.now,
        },
        action,
        req.input,
      );
    default: {
      const unhandled: never = action;
      return bad(`unknown action ${String(unhandled)}`);
    }
  }
}

/** Step 14.5 (D256): write PATs and app secrets that expire within 14 days (Today, and step 15.5's notification). */
export async function expiringFor(plan: PlanStore | undefined, cfg: AppConfig | null, today: IsoDate, known: (key: string) => string | undefined = () => undefined) {
  return expiringSoon(
    [
      ...(plan ? (await plan.devopsIdentities()) : []).filter((i) => i.expires).map((i) => ({ key: `pat:${i.clientKey}`, label: `${nameOf(cfg, known)(i.clientKey)} DevOps write access`, expires: i.expires!, section: "clients" })),
      ...Object.entries(cfg?.secretExpiry ?? {}).map(([k, v]) => ({ key: `secret:${k}`, label: k === "dataverse-client-secret" ? "The Dataverse app secret" : "The Google app secret", expires: v!, section: "connections" })),
    ],
    today,
  );
}

/**
 * A1: a checked link opens in the person's browser through the host. "browser": the host opened it; "page": the page
 * that asked opens it (the hosted app), so the link comes back.
 */
async function openLink(links: HostLinks, url: string): Promise<ActionResponse> {
  try {
    return (await links.open(url)) === "opened" ? { ok: true, data: { opened: "browser" } } : { ok: true, data: { opened: "page", url } };
  } catch {
    return { ok: false, status: 500, error: "Could not start the browser" };
  }
}

/** Settings' context: writes go to the file as is; what it shows and the Dataverse user come from the sign-in. */
function settingsCtx(raw: ActionContext, ctx: ActionContext): SettingsContext {
  const signed = withSignedIn(raw);
  return {
    loadConfig: ctx.loadConfig,
    viewConfig: signed.loadConfig,
    findMe: async (dv, tz) => {
      const r = await matchMe(signed, dv, tz);
      if (r.ok) await signed.saveSystemUserId(r.id);
      return r;
    },
    makeDataverse: ctx.makeDataverse,
    now: ctx.now,
    ...(ctx.writeConfig ? { writeConfig: ctx.writeConfig } : {}),
    ...(ctx.plan ? { plan: ctx.plan } : {}),
    ...(ctx.secrets ? { secrets: ctx.secrets } : {}),
    ...(ctx.exportPlan ? { exportPlan: ctx.exportPlan } : {}),
  };
}

/**
 * A2: who the signed-in person is in Dataverse (Account Worker, Focus Time and Time Off are read for them): the
 * first Dataverse user that has their email, else their UPN. A stored my_systemuserid (from an earlier match, or set
 * by hand in Settings) is used as is and skips this. A failure says which case it is (dataverse-words.ts).
 */
export async function matchMe(ctx: Pick<ActionContext, "makeDataverse" | "signedInAs">, dv: DataverseConfig, tz: string): Promise<MatchResult> {
  const me = await ctx.signedInAs?.();
  const names = [...new Set([dv.myEmail, me?.email ?? "", me?.upn ?? ""].map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@")))];
  const src = ctx.makeDataverse(dv, tz);
  for (const name of names) {
    const r = await src.resolveUserId(name);
    if (r.ok) return r;
    // Not found under this name: try the next. Anything else (more than one, Dataverse down) is the answer.
    if (r.reason === "many") return { ok: false, reason: "many", message: manyDataverseMatches(name) };
    if (r.reason !== "none") return { ok: false, reason: "failed", message: DATAVERSE_UNREACHABLE };
  }
  return { ok: false, reason: "none", message: noDataverseMatch(names[0] ?? null) };
}
