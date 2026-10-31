// Named, validated actions (docs/spec.md section 5). The UI calls these through the local server;
// the future chat panel will call the same ones. Unknown actions and unexpected input are rejected.
import { clients as defaultClients, weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import { DEFAULT_UI, THEMES, type AppConfig, type DataverseConfig, type GoogleConfig, type OutlookConfig, type ParseResult } from "../config/schema.ts";
import { setValue, type WriteResult } from "../config/edit.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { loadSampleSources } from "../sources/sample.ts";
import { buildWeek } from "../week/build.ts";
import { defaultWeekStart, localToday, mondayOf, todayTarget, weekDates7 } from "../week/dates.ts";
import type { TimeModel } from "../week/hours.ts";
import { ptoByDate, type PtoDay, type PtoEntry } from "../week/pto.ts";
import type { CalEvent, ClientWork, FocusPattern, SourceResult, Week } from "../week/types.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { checkDevOpsUrl, launchPlan } from "../links/edge.ts";
import { hasHoursOn, planAction } from "./plan-actions.ts";
import { timeAction } from "./time-actions.ts";
import { settingsAction, type SettingsContext } from "./settings-actions.ts";
import { isActionName, type ActionName } from "./registry.ts";
import type { ActionResponse, SourceSummary, WeekLoadData } from "./types.ts";

export type { ActionResponse, SourceSummary, WeekLoadData };

export type ActionContext = {
  loadConfig: () => Promise<{ path: string; parsed: ParseResult; created?: boolean }>;
  makeDataverse: (cfg: DataverseConfig, timeZone: string) => DataverseSource;
  makeOutlook: (cfg: OutlookConfig, timeZone: string) => CalendarSource;
  makeGoogle: (cfg: GoogleConfig, timeZone: string) => CalendarSource;
  makeDevOps: (cfg: DataverseConfig, timeZone: string) => DevOpsSource;
  saveSystemUserId: (id: string) => Promise<void>;
  now: () => string;
  /** The local plan store (step 5); absent when it could not be opened. */
  plan?: PlanStore;
  /** Safe config write (config/edit.ts writeConfig): validate, back up, atomic replace. Absent: settings are read-only. */
  writeConfig?: (edit: (text: string) => string) => Promise<WriteResult>;
  /** Start a program from an argument array, never a shell (link.open). Rejects when it can't start. */
  launch?: (argv: string[]) => Promise<void>;
  /** Settings (step 6b): keyring presence and app secret writes, local file reads for browser profiles, plan export. */
  secrets?: SettingsContext["secrets"];
  readText?: (path: string) => string | null;
  home?: string;
  exportPlan?: (json: string) => Promise<string>;
};

export type ActionRequest = { action: unknown; input: unknown };

const bad = (error: string): ActionResponse => ({ ok: false, status: 400, error });

type WeekLoadInput = { weekStart?: string; now?: string; refresh?: boolean };

function validateWeekLoad(input: unknown): WeekLoadInput | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "input must be an object";
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["weekStart", "now", "refresh"].includes(k)) return `unknown input field ${k}`;
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
  // A flex session that has ended opens its update loop (D126), on any read.
  ctx.plan?.openFlexLoops(Temporal.Instant.from(now));
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
      const dvSource = ctx.makeDataverse(dv, tz);
      const mine = (await dvSource.myClients?.().catch(() => null)) ?? [];
      const clients = weekClients(buildWeek({ weekStart, patterns: dataverse.items, events: [], config: weekConfig }), weekConfig.standingBlocks);
      planClients = [...clients];
      for (const c of mine) if (!planClients.some((p) => p.clientKey === c.clientKey)) planClients.push({ clientKey: c.clientKey, clientName: c.clientName });
      const fetch = [...clients, ...mine.filter((c) => c.devops && !clients.some((w) => w.clientKey === c.clientKey)).map(({ clientKey, clientName }) => ({ clientKey, clientName }))];
      devopsP = ctx.makeDevOps(dv, tz).load(fetch, refresh).catch(() => null);
    }
  }

  const [outlook, google, devops, ptoResult, ahead] = await Promise.all([outlookP, googleP, devopsP, ptoP, aheadP]);
  const pto = ptoByDate(ptoResult?.items ?? [], weekDates7(weekStart));
  const ptoAhead = [...new Set((ahead?.items ?? []).map((e) => e.date))].sort();
  const sunday = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
  const unavailable = ctx.plan?.unavailableBetween(weekStart, sunday) ?? [];
  const flex = ctx.plan?.flexBetween(weekStart, sunday) ?? [];
  const weekendPlanned = new Set(weekDates7(weekStart).slice(5).filter((d) => (ctx.plan?.picksFor(d) ?? []).some((p) => p.status === "planned" || p.status === "done")));
  const week = buildWeek({ weekStart, patterns: dataverse.items, events: [...outlook.items, ...google.items], config: weekConfig, pto, unavailable, flex, viewRange: cfg?.ui.viewRange ?? DEFAULT_UI.viewRange, weekendPlanned });
  const todayDay = week.days.find((d) => d.date === todayDate);
  const clientColors = cfg ? cfg.clients : Object.fromEntries(Object.values(defaultClients).map((c) => [c.shortName, c.color]));

  const todayPlan = ctx.plan?.day(todayDate) ?? null;
  const todayOff = ptoAhead.includes(todayDate) || !!pto[todayDate];
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
    ui: cfg?.ui ?? DEFAULT_UI,
    config: { ok: parsed.ok, path: loaded.path, created: !!loaded.created, errors: parsed.ok ? [] : parsed.errors },
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

export async function dispatch(ctx: ActionContext, req: ActionRequest): Promise<ActionResponse> {
  // Only registered actions (actions/registry.ts). The switch below is exhaustive over them: an action added
  // to the registry without a case, or a case for a name not in the registry, fails the type check.
  if (!isActionName(req.action)) return bad("unknown action");
  const action: ActionName = req.action;
  switch (action) {
    case "auth.connect_microsoft":
    case "auth.connect_google": {
      if (!noInput(req.input)) return bad(`${req.action} takes no input`);
      return { ok: true, data: await connect(ctx, req.action === "auth.connect_microsoft" ? "outlook" : "google") };
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
      if (!ctx.launch) return { ok: false, status: 503, error: "Opening links is not available here" };
      const plan = launchPlan(cfg.edge, key, cfg.clientSettings[key]?.name ?? key, checked.url, { setting: cfg.clientSettings[key], chromium: cfg.chromium.command });
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
    case "settings.load":
    case "settings.save":
    case "secret.set":
    case "data.export":
      return settingsAction(
        {
          loadConfig: ctx.loadConfig,
          makeDataverse: ctx.makeDataverse,
          ...(ctx.writeConfig ? { writeConfig: ctx.writeConfig } : {}),
          ...(ctx.plan ? { plan: ctx.plan } : {}),
          ...(ctx.secrets ? { secrets: ctx.secrets } : {}),
          ...(ctx.readText ? { readText: ctx.readText } : {}),
          ...(ctx.home ? { home: ctx.home } : {}),
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
    case "planday.start":
    case "planday.commit":
    case "pick.add":
    case "pick.remove":
    case "pick.set_size":
    case "pick.move":
    case "pick.mark_done":
    case "draft.add_story":
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
