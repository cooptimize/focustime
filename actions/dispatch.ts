// Named, validated actions (docs/spec.md section 5). The UI calls these through the local server;
// the future chat panel will call the same ones. Unknown actions and unexpected input are rejected.
import { clearPhotos, photoAction } from "./photo-actions.ts";
import type { PhotoCache } from "../cache/photos.ts";
import { expiringSoon } from "../plan/expiry.ts";
import { clients as defaultClients, weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import { DEFAULT_PLAN, DEFAULT_TIMEBOX, DEFAULT_UI, THEMES, type AppConfig, type DataverseConfig, type GoogleConfig, type OutlookConfig, type ParseResult } from "../config/schema.ts";
import { setValue, type WriteResult } from "../config/edit.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { loadSampleSources } from "../sources/sample.ts";
import { buildWeek } from "../week/build.ts";
import { followedKeys } from "../week/follow.ts";
import { followOptions } from "./follow.ts";
import { defaultWeekStart, localToday, mondayOf, todayTarget, weekDates7 } from "../week/dates.ts";
import { VIEW_RANGES, type TimeModel, type ViewRange } from "../week/hours.ts";
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
import type { ActionResponse, HostBrowsers, SourceSummary, PlanningSettings, WeekLoadData } from "./types.ts";
import { accountAction, storedIdentity, withMe, IDENTITY_KEY, type MicrosoftAccount, type StoredIdentity } from "./account.ts";
import { vmAction, type VmContext } from "./vm-actions.ts";
import { presenceAction, syncTeamsStatus, type PresenceContext } from "./presence-actions.ts";
import type { AzureClient } from "../sources/azure/client.ts";

export type { ActionResponse, SourceSummary, WeekLoadData };

export type ActionContext = {
  /** Step 16.4: the profile photo cache (~/.cache/coopilot/photos). Absent: photos aren't cached (demo mode, tests). */
  photoCache?: PhotoCache;
  /** Step 15.5: the notifier (test and sample notifications). Absent: notifications aren't available here. */
  notifications?: { test: () => Promise<void>; sample: (kind: string, live: boolean, gated: boolean) => Promise<boolean> };
  loadConfig: () => Promise<{ path: string; parsed: ParseResult; created?: boolean }>;
  makeDataverse: (cfg: DataverseConfig, timeZone: string) => DataverseSource;
  makeOutlook: (cfg: OutlookConfig, timeZone: string) => CalendarSource & { write?: OutlookWrite; schedule?: ScheduleReader; people?: PeopleReader };
  makeGoogle: (cfg: GoogleConfig, timeZone: string) => CalendarSource;
  makeDevOps: (cfg: DataverseConfig, timeZone: string) => DevOpsSource;
  saveSystemUserId: (id: string) => Promise<void>;
  now: () => string;
  /** Waits before a second read-back after a network error (D255); tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
  /** The local plan store (step 5); absent when it could not be opened. */
  plan?: PlanStore;
  /** Safe config write (config/edit.ts writeConfig): validate, back up, atomic replace. Absent: settings are read-only. */
  writeConfig?: (edit: (text: string) => string) => Promise<WriteResult>;
  /** Start a program from an argument array, never a shell (link.open). Rejects when it can't start. */
  launch?: (argv: string[]) => Promise<void>;
  /** Settings (step 6b): keyring presence and app secret writes, local file reads for browser profiles, plan export. */
  secrets?: SettingsContext["secrets"];
  /** The host's browsers (step 12, Q63): detection and the link command, from server/host.ts. */
  host?: HostBrowsers;
  exportPlan?: (json: string) => Promise<string>;
  /** Step 14: personal DevOps write PATs in the keyring, and the DevOps writer. Absent: DevOps stays read-only. */
  writePats?: WritePats;
  devopsWriter?: DevOpsWriter;
  /** Media control for focus (step 10): playerctl and playlist links. Absent: none (tests, no desktop). */
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

/** Actions that reach outside Coopilot or change secrets: refused while demo mode is on (D272). */
export const DEMO_REFUSED: readonly ActionName[] = [
  "link.open", "outlook.open", "playlist.open", "data.export", "secret.set",
  "auth.connect_microsoft", "auth.connect_google", "auth.connect_outlook_write", "auth.disconnect",
  "write.confirm", "write.retry", "devops.confirm", "devops.retry", "devops.set_write_pat", "devops.clear_write_pat",
  "auth.sign_in", "auth.sign_out",
];
export const DEMO_REFUSAL = "Demo data: nothing leaves Coopilot in demo mode";

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
  const r = await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).pto(...weekRange(date)).catch(() => null);
  return ptoByDate(r?.items ?? [], [date])[date] ?? null;
}

/** PTO dates from a Monday for AHEAD_DAYS: the same read as week.load's look-ahead, so usually a memory hit. */
async function ptoAheadOf(ctx: ActionContext, cfg: AppConfig, monday: string): Promise<ReadonlySet<string>> {
  if (!cfg.dataverse.mySystemUserId) return new Set();
  const to = Temporal.PlainDate.from(monday).add({ days: AHEAD_DAYS }).toString();
  const r = await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).pto(monday, to).catch(() => null);
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
function hasPlansOn(ctx: Pick<ActionContext, "plan">, model: TimeModel, date: string): boolean {
  if (hasHoursFor(ctx, model, date)) return true;
  if (!ctx.plan) return false;
  return ctx.plan.unavailableBetween(date, date).length > 0 || ctx.plan.picksFor(date).some((p) => p.status === "planned" || p.status === "done");
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
  const dvSource = ctx.makeDataverse(cfg.dataverse, weekConfig.hours.timeZone);
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

/** The week's blocks from focus patterns and standing blocks only (no calendars): where a feature can go (step 8). */
async function patternWeek(ctx: ActionContext, cfg: AppConfig, weekStart: string): Promise<Week> {
  const r = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).load(weekStart).catch(() => null) : null;
  return buildWeek({ weekStart, patterns: r?.items ?? [], events: [], config: cfg.week });
}

async function weekLoad(ctx: ActionContext, input: WeekLoadInput): Promise<WeekLoadData> {
  const loaded = await ctx.loadConfig();
  const parsed = loaded.parsed;
  const cfg = parsed.ok ? parsed.config : null;
  // With an invalid config nothing is guessed: no standing blocks either.
  const weekConfig = cfg?.week ?? { ...defaultWeekConfig, standingBlocks: [] };
  const model = weekConfig.hours;
  const tz = model.timeZone;
  const now = input.now ?? ctx.now();
  const todayDate = localToday(now, tz);
  // A flex session that has ended opens its update follow-up (D126), on any read. By the server's clock, never the UI's
  // ?now (a check could otherwise open follow-ups for sessions still ahead; step 6c, like D118).
  ctx.plan?.openFlexFollowUps(Temporal.Instant.from(ctx.now()));
  const todayPlans = hasPlansOn(ctx, model, todayDate);
  const weekStart = input.weekStart ?? defaultWeekStart(todayDate, todayPlans);

  const sample = loadSampleSources();
  const refresh = input.refresh ? { refresh: true } : {};
  // Sample meetings stay only for a calendar source that is not configured at all.
  const outlookP: Promise<SourceResult<CalEvent>> = cfg?.outlook ? ctx.makeOutlook(cfg.outlook, tz).load(weekStart, refresh) : Promise.resolve(sample.outlook);
  const googleP: Promise<SourceResult<CalEvent>> = cfg?.google ? ctx.makeGoogle(cfg.google, tz).load(weekStart, refresh) : Promise.resolve(sample.google);

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
    let resolveError: string | null = null;
    if (!dv.mySystemUserId) {
      const r = await ctx.makeDataverse(dv, tz).resolveUserId(dv.myEmail);
      if (r.ok) {
        await ctx.saveSystemUserId(r.id);
        dv = { ...dv, mySystemUserId: r.id };
      } else resolveError = r.message;
    }
    dataverse = resolveError
      ? { source: "dataverse", status: "misconfigured", fetchedAt: null, fromCache: false, items: [], message: resolveError, fixAction: "open_settings" }
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
      const watch = ctx.plan ? watchedIds(ctx.plan.openFollowUps()) : {};
      // Features on the week lists of this week, today's week and next (step 8), so Plan the day can offer their
      // stories. Every list item (features and stories) is also read by id, done ones included, so progress can count
      // what DevOps shows as Completed (step 11).
      const features: Record<string, number[]> = {};
      if (ctx.plan)
        for (const f of ctx.plan.weekFeaturesFor(featureWeeks(weekStart, todayDate))) {
          if (f.level === "feature") (features[f.clientKey] ??= []).includes(f.itemId) || features[f.clientKey]!.push(f.itemId);
          (watch[f.clientKey] ??= []).includes(f.itemId) || watch[f.clientKey]!.push(f.itemId);
        }
      devopsP = ctx.makeDevOps(dv, tz).load(picked.fetch, { ...refresh, watch, features }).catch(() => null);
    }
  }

  // Step 13: with write access, scan the week for edit facts and sync Coopilot's own events (Outlook changes come
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
  ctx.plan?.closeHelpFollowUps(Temporal.Instant.from(ctx.now()));
  const pto = ptoByDate(ptoResult?.items ?? [], weekDates7(weekStart));
  const ptoAhead = [...new Set((ahead?.items ?? []).map((e) => e.date))].sort();
  const sunday = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
  const unavailable = ctx.plan?.unavailableBetween(weekStart, sunday) ?? [];
  const flex = ctx.plan?.flexBetween(weekStart, sunday) ?? [];
  const weekendPlanned = new Set(weekDates7(weekStart).slice(5).filter((d) => (ctx.plan?.picksFor(d) ?? []).some((p) => p.status === "planned" || p.status === "done")));
  // Coopilot's own Outlook events show once, as timeboxes, and never count as meetings in risk rules (step 12).
  const own = ctx.plan ? ownEventIds(ctx.plan.ownEvents()) : new Set<string>();
  const week = buildWeek({ weekStart, patterns: dataverse.items, events: withoutOwn([...outlook.items, ...google.items], own), config: weekConfig, pto, unavailable, flex, viewRange: input.viewRange ?? cfg?.ui.viewRange ?? DEFAULT_UI.viewRange, weekendPlanned });
  const todayDay = week.days.find((d) => d.date === todayDate);
  const clientColors = cfg ? cfg.clients : Object.fromEntries(Object.values(defaultClients).map((c) => [c.shortName, c.color]));

  // Follow-up rules (step 7) on the fresh DevOps results, and borrowed time paid by done payback picks. By the server's
  // clock, like the flex follow-ups.
  const serverToday = localToday(ctx.now(), tz);
  const names = new Map([...planClients.map((c) => [c.clientKey, c.clientName] as const), ...(devops ?? []).map((w) => [w.clientKey, w.clientName] as const)]);
  if (ctx.plan) {
    applyFollowUpRules(ctx.plan, { today: serverToday, work: devops, internal: internalClients(cfg), clientName: nameOf(cfg, (k) => names.get(k)), isWorkday: workdayOf(cfg) });
    ctx.plan.settleBorrowed();
  }
  const todayPlan = ctx.plan?.day(todayDate) ?? null;
  // The focus timer warns 5 minutes before meetings and block ends (server/timer.ts); keep today's points fresh.
  if (ctx.plan && todayDay) ctx.plan.setState("warn_points", { date: todayDate, points: warnPoints(todayDay, tz) });
  const todayOff = ptoAhead.includes(todayDate) || !!pto[todayDate];
  // Q51: committed features show their current DevOps title (fresh results only); the stored one is the fallback.
  const currentTitle = titleFrom(devops);
  return {
    weekStart,
    week,
    today: columnOf(todayTarget(now, model, { todayHasPlans: todayPlans, hasEve: !!todayDay?.eve }), week),
    plan: ctx.plan ? ctx.plan.week(week.days.map((d) => d.date)) : null,
    planClients,
    planDay: { date: todayDate, workday: hasHoursFor(ctx, model, todayDate) && !todayOff, committed: !!todayPlan?.committedAt, available: !!ctx.plan },
    ptoAhead,
    sources: [dataverse, ...(ptoResult ? [ptoResult] : []), outlook, google].map(summarize),
    devops,
    clients: clientColors,
    hours: model,
    thresholds: weekConfig.thresholds,
    planning: planningOf(cfg),
    focus: cfg?.focus ?? DEFAULT_FOCUS,
    media: ctx.media ? await ctx.media.status() : { playerctl: false, spotify: false },
    timer: timerView(ctx.plan?.getState<TimerState>(TIMER_KEY) ?? null, Temporal.Instant.from(ctx.now())),
    openFollowUps: ctx.plan?.openFollowUps().length ?? 0,
    captures: ctx.plan?.inboxCount() ?? 0,
    followUps: ctx.plan ? ctx.plan.openFollowUps().filter((f) => !f.snoozedUntil || f.snoozedUntil <= serverToday).map((f) => followUpView(ctx.plan!, f, serverToday, nameOf(cfg, (k) => names.get(k)))) : [],
    focused: ctx.plan ? ctx.plan.focusedSeconds(Object.values(ctx.plan.week(week.days.map((d) => d.date))).flatMap((d) => d.picks.map((p) => p.id))) : {},
    resumeNotes: ctx.plan ? Object.fromEntries(Object.entries(ctx.plan.latestNotes()).map(([k, n]) => [k, noteView(n)])) : {},
    borrowed: ctx.plan ? ctx.plan.borrowedFor(weekStart, sunday).map(borrowedView) : [],
    closeOut: { date: todayDate, done: !!todayPlan?.closedOutAt },
    checkIn: { date: todayDate, done: !!ctx.plan?.marked(CHECKIN_DONE_MARK, todayDate) },
    weekPlan: ctx.plan ? withTitles(weekPlanView(ctx.plan.weekPlan(weekStart)), currentTitle) : null,
    weekFeatures: ctx.plan ? withCurrentTitles(ctx.plan.weekFeaturesFor(featureWeeks(weekStart, todayDate)), currentTitle) : [],
    weekNudge: { badge: ctx.plan && cfg ? weekNudges(Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz), nudgeTimes(cfg), (w) => !!ctx.plan!.weekPlan(w).committedAt).badge : null },
    // Step 16.2: Planned ✓ on the Week tab's mode switch, for this week, next week and the week shown.
    weekCommitted: Object.fromEntries([...new Set([mondayOf(todayDate), Temporal.PlainDate.from(mondayOf(todayDate)).add({ days: 7 }).toString(), week.days[0]!.date])].map((w) => [w, !!ctx.plan?.weekPlan(w).committedAt])),
    timeboxes: ctx.plan ? timeboxesFor(ctx.plan, weekStart, sunday).map((t) => timeboxView(t, ctx.plan!, cfg)) : [],
    timeboxSettings: cfg?.timebox ?? DEFAULT_TIMEBOX,
    eventEdit: synced.facts,
    canWrite: synced.canWrite,
    invites: ctx.plan ? ctx.plan.invitesFrom(Temporal.PlainDate.from(weekStart).subtract({ days: 7 }).toString()).map((i, _n, _a, log = ctx.plan!.writeLog(1000)) => ({ writeId: log.find((e) => e.uid === i.uid && e.op === "create" && e.status === "confirmed" && !e.undoneBy)?.id ?? null, uid: i.uid, clientKey: i.clientKey, itemId: i.itemId, pickId: i.pickId, timeboxId: i.timeboxId, title: i.title, start: i.start, end: i.end, names: i.attendees.map((a) => a.name), teams: i.teams, status: i.status })) : [],
    collab: cfg?.collab ?? DEFAULT_COLLAB,
    devopsWrite: ctx.plan && ctx.devopsWriter && ctx.writePats ? ctx.plan.devopsIdentities().map((i) => i.clientKey) : [],
    // Step 14.5 (D256): write PATs and app secrets that expire within 14 days, for Today.
    expiring: expiringFor(ctx.plan, cfg, serverToday, (k) => names.get(k)),
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
  const tz = cfg.week.hours.timeZone;
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
      return { ...r, parsed: withMe(r.parsed, storedIdentity(ctx.plan)) };
    },
    saveSystemUserId: async (id) => {
      const cur = storedIdentity(ctx.plan);
      const r = await ctx.loadConfig();
      const email = r.parsed.ok ? withMe(r.parsed, cur) : null;
      if (cur && email?.ok) ctx.plan!.setAccountState(IDENTITY_KEY, { ...cur, systemUserId: id, systemUserEmail: email.config.dataverse.myEmail } satisfies StoredIdentity);
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
      const r = await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).teammates();
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
    focusRunning: () => !!ctx.plan?.getState<TimerState>(TIMER_KEY)?.runningSince,
    workday: async (cfg, date) => hasHoursOn(ctx.plan, cfg.week.hours, date) && !(await ptoOn(ctx, cfg, date)),
  };
}

export async function dispatch(ctx: ActionContext, req: ActionRequest): Promise<ActionResponse> {
  // Only registered actions (actions/registry.ts). The switch below is exhaustive over them: an action added
  // to the registry without a case, or a case for a name not in the registry, fails the type check.
  if (!isActionName(req.action)) return bad("unknown action");
  const action: ActionName = req.action;
  // Step 15.4: "me" comes from the Microsoft sign-in (config's my_email stays the fallback); Settings shows the file as is.
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
      return { ok: true, data: await ctx.makeOutlook(cfg.outlook, cfg.week.hours.timeZone).connect({ write: true }) };
    }
    case "outlook.open": {
      // Step 13: Outlook on the web, for meetings Coopilot won't change. Only Outlook links, in Cooptimize's profile.
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "url")) return bad("outlook.open takes { url }");
      const url = outlookLink(i.url);
      if (!url) return { ok: false, status: 422, error: "Only Outlook on the web links open from here" };
      const cfg = await configured(ctx);
      if (!cfg) return { ok: false, status: 409, error: "Fix the config first" };
      if (!ctx.launch || !ctx.host) return { ok: false, status: 503, error: "Opening links is not available here" };
      const cmd = ctx.host.linkCommand(cfg, INTERNAL_CLIENT, url);
      try {
        await ctx.launch(cmd.argv);
      } catch {
        return { ok: false, status: 500, error: "Could not start the browser" };
      }
      return { ok: true, data: { opened: cmd.profile ? "edge" : "default" } };
    }
    case "collab.candidates":
    case "collab.suggest":
    case "collab.preview_invite":
      return collabAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          dataverse: (cfg) => ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone),
          outlook: (cfg) => {
            if (!cfg.outlook) return null;
            const o = ctx.makeOutlook(cfg.outlook, cfg.week.hours.timeZone);
            return { write: o.write ?? null, schedule: o.schedule ?? null, source: o };
          },
          google: (cfg) => (cfg.google ? ctx.makeGoogle(cfg.google, cfg.week.hours.timeZone) : null),
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
        { plan: ctx.plan, config: () => configured(ctx), outlook: (cfg) => (cfg.outlook ? ctx.makeOutlook(cfg.outlook, cfg.week.hours.timeZone).write ?? null : null), now: ctx.now, ...(ctx.sleep ? { sleep: ctx.sleep } : {}) },
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
          targets: (cfg, keys) => ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).devopsTargets(keys, { withPat: false }),
          writer: ctx.devopsWriter ?? null,
          pats: ctx.writePats ?? null,
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone),
          now: ctx.now,
          ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
        },
        action,
        req.input,
      );
    case "auth.status":
    case "auth.sign_in":
    case "auth.sign_out":
      return accountAction({ ...(ctx.plan ? { plan: ctx.plan } : {}), account: await accountOf(ctx), now: ctx.now, clearPhotos: () => clearPhotos(ctx.photoCache ?? null) }, action, req.input);
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
      if (input.source === "dataverse") return bad("Dataverse uses an app secret set up outside Coopilot; remove it with secret-tool if needed");
      if (input.source !== "outlook" && input.source !== "google") return bad("source must be outlook or google");
      const cfg = await configured(ctx);
      const tz = cfg?.week.hours.timeZone ?? "UTC";
      const section = input.source === "outlook" ? cfg?.outlook : cfg?.google;
      if (!section) return { ok: true, data: { status: "not_configured" } };
      const src = input.source === "outlook" ? ctx.makeOutlook(section as OutlookConfig, tz) : ctx.makeGoogle(section as GoogleConfig, tz);
      await src.disconnect();
      // Outlook's token is the Microsoft sign-in (step 15.4): disconnecting it signs out.
      if (input.source === "outlook") ctx.plan?.setAccountState(IDENTITY_KEY, null);
      return { ok: true, data: { status: "disconnected" } };
    }
    case "week.load": {
      const input = validateWeekLoad(req.input ?? {});
      if (typeof input === "string") return bad(input);
      return { ok: true, data: await weekLoad(ctx, input) };
    }
    case "link.open": {
      // Open a work item link in that client's Edge profile. The link must be on the client's own DevOps org.
      const input = req.input as { clientKey?: unknown; url?: unknown } | undefined;
      if (typeof input !== "object" || input === null || Array.isArray(input)) return bad("link.open takes { clientKey, url }");
      for (const k of Object.keys(input)) if (k !== "clientKey" && k !== "url") return bad(`unknown input field ${k}`);
      if (typeof input.clientKey !== "string" || !input.clientKey.trim() || input.clientKey.length > 100) return bad("clientKey must be text");
      const key = input.clientKey;
      const cfg = await configured(ctx);
      if (!cfg) return { ok: false, status: 409, error: "Fix the config first" };
      const org = ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone).orgOf(key);
      const checked = checkDevOpsUrl(input.url, org);
      if (!checked.ok) return { ok: false, status: 422, error: checked.error };
      if (!ctx.launch || !ctx.host) return { ok: false, status: 503, error: "Opening links is not available here" };
      const plan = ctx.host.linkCommand(cfg, key, checked.url);
      try {
        await ctx.launch(plan.argv);
      } catch {
        return { ok: false, status: 500, error: plan.profile ? "Could not start Edge. Check [edge] command in config" : "Could not start the default browser" };
      }
      return { ok: true, data: { opened: plan.profile ? "edge" : "default", notice: plan.notice } };
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
    case "ui.set_timelines": {
      // Step 15.1 (D276): the saved default for the compact timelines; V switches them for the session only.
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "on") || typeof i.on !== "boolean") return bad("input must be { on: true or false }");
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => setValue(text, "ui", "show_timelines", i.on as boolean));
      if (!r.ok) return { ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` };
      return { ok: true, data: { ui: r.parsed.config.ui } };
    }
    case "settings.load":
    case "settings.save":
    case "secret.set":
    case "data.export":
      return settingsAction(
        {
          loadConfig: ctx.loadConfig,
          makeDataverse: ctx.makeDataverse,
          now: ctx.now,
          ...(ctx.writeConfig ? { writeConfig: ctx.writeConfig } : {}),
          ...(ctx.plan ? { plan: ctx.plan } : {}),
          ...(ctx.secrets ? { secrets: ctx.secrets } : {}),
          ...(ctx.host ? { host: ctx.host } : {}),
          ...(ctx.exportPlan ? { exportPlan: ctx.exportPlan } : {}),
        },
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
        { plan: ctx.plan, config: () => configured(ctx), ...(ctx.writeConfig ? { writeConfig: ctx.writeConfig } : {}), devops: (cfg) => ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone) },
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
      if (r.ok && action.startsWith("timer.")) void presenceContext(ctx).then(syncTeamsStatus).catch(() => {});
      return r;
    }
    case "presence.status":
    case "presence.people":
    case "presence.log":
      return presenceAction(await presenceContext(ctx), action, req.input);
    case "people.photos":
      return photoAction({ ...(await presenceContext(ctx)), cache: ctx.photoCache ?? null }, req.input);
    case "media.status": {
      // Step 10: read-only check for playerctl (MPRIS) and the Spotify app. Nothing is run or installed.
      if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Object.keys(req.input).length)) return bad("media.status takes {}");
      return { ok: true, data: ctx.media ? await ctx.media.status() : { playerctl: false, spotify: false } };
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
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone),
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
          dataverse: (cfg) => ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone),
          people: (cfg) => (cfg.outlook ? ctx.makeOutlook(cfg.outlook, cfg.week.hours.timeZone).people ?? null : null),
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
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone),
          clients: async (cfg, weekStart) => {
            const today = localToday(ctx.now(), cfg.week.hours.timeZone);
            const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).load(weekStart, {}).catch(() => null) : null;
            return (await devopsClients(ctx, cfg, weekStart, today, {}, dv?.items ?? [])).fetch;
          },
          now: ctx.now,
        },
        action,
        req.input,
      );
    case "roadmap.load":
      // Step 16 (D278): read-only; the same followed clients and portfolio read as Plan the week, for this week.
      return roadmapAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone),
          clients: async (cfg, weekStart, refresh) => {
            const today = localToday(ctx.now(), cfg.week.hours.timeZone);
            const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).load(weekStart, refresh ? { refresh } : {}).catch(() => null) : null;
            return (await devopsClients(ctx, cfg, weekStart, today, refresh ? { refresh } : {}, dv?.items ?? [])).fetch;
          },
          now: ctx.now,
          team: async (cfg) => {
            const r = await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).teammates();
            return r.ok ? r.people : null;
          },
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
    case "weekplan.set_blocks":
    case "weekplan.set_size":
    case "weekplan.reorder":
    case "weekplan.remove":
    case "weekplan.mark_done":
    case "weekplan.headsup":
    case "feature.brief":
    case "feature.mark_breakdown":
    case "followup.ask_priorities":
      return weekPlanAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone),
          clients: async (cfg, weekStart, refresh) => {
            const today = localToday(ctx.now(), cfg.week.hours.timeZone);
            const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, cfg.week.hours.timeZone).load(weekStart, refresh ? { refresh } : {}).catch(() => null) : null;
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
          devops: (cfg) => ctx.makeDevOps(cfg.dataverse, cfg.week.hours.timeZone),
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
export function expiringFor(plan: PlanStore | undefined, cfg: AppConfig | null, today: IsoDate, known: (key: string) => string | undefined = () => undefined) {
  return expiringSoon(
    [
      ...(plan ? plan.devopsIdentities() : []).filter((i) => i.expires).map((i) => ({ key: `pat:${i.clientKey}`, label: `${nameOf(cfg, known)(i.clientKey)} DevOps write access`, expires: i.expires!, section: "clients" })),
      ...Object.entries(cfg?.secretExpiry ?? {}).map(([k, v]) => ({ key: `secret:${k}`, label: k === "dataverse-client-secret" ? "The Dataverse app secret" : "The Google app secret", expires: v!, section: "connections" })),
    ],
    today,
  );
}
