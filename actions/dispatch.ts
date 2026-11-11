// Named, validated actions (docs/spec.md section 5). The UI calls these through the local server;
// the future chat panel will call the same ones. Unknown actions and unexpected input are rejected.
import { exactCaseDefault } from "../plan/common-words.ts";
import { boundaryCheck } from "./boundary-actions.ts";
import type { DayPromise } from "../plan/conversation-views.ts";
import { afterHours } from "../plan/deploy.ts";
import { deployItemAction, type DeployItemAction } from "./deploy-item-actions.ts";
import { pickNeed } from "../plan/types.ts";
import { scopeDepsOf } from "./scope-deps.ts";
import { TEAMS_KINDS, type TeamsKind } from "../plan/teams-rhythm.ts";
import { checkinGhosts } from "../plan/carry.ts";
import { isClosed, isCompleted } from "../plan/process.ts";
import { clearPhotos, photoAction } from "./photo-actions.ts";
import { chatAction, type ChatContext } from "./chat-actions.ts";
import { DEFAULT_DRAFT_MONTHS, storyAction, type StoryContext } from "./story-actions.ts";
import { forgetCard, itemCardAction, type ItemCardContext } from "./item-card-actions.ts";
import { wrapUpAction, type WrapUpContext } from "./wrapup-actions.ts";
import { serveChatImage, type ServedImage } from "./chat-images.ts";
import { peoplePicker, pickerPeopleOf } from "./people-picker.ts";
import { conversationPeople, conversationAction, dayPromises, inboxFacts, loopChatOf, loopChatPromise, loopOpenChatPromises, type ConversationContext } from "./conversation-actions.ts";
import { loopAction, type LoopContext, type LoopPromise } from "./loop-actions.ts";
import { insideDomain } from "../plan/loop.ts";
import type { PersonRef } from "../plan/person-ref.ts";
import { refreshStatus } from "./conversations-pipeline.ts";
import type { ConversationsPort } from "./devops-write-actions.ts";
import { isClientLead } from "./client-lead.ts";
import { clientsOf, isInternalKey, onlyClients } from "./client-accounts.ts";
import { clientAccounts } from "../plan/client-accounts.ts";
import { requestAction, urgentRequests, visibleChats, type RequestContext, type RequestsPort } from "./request-actions.ts";
import { aiAction, type AiActionName, type AiRuntime } from "./ai-actions.ts";
import { createAi, type AiService } from "../ai/service.ts";
import { assistantAction, type AssistantGate } from "../assistant/actions.ts";
import { RUNS as ASSISTANT_RUNS } from "../assistant/allowlist.ts";
import type { ReadDeps } from "../assistant/reads.ts";
import { createAssistant, type AssistantService } from "../assistant/service.ts";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, type AssistantContext, type Channel, type TranscribeResult } from "../assistant/types.ts";
import type { ClientEntry } from "../ai/guard.ts";
import type { AudienceRules } from "../plan/boundary.ts";
import type { ChosenVm } from "./account-types.ts";
import type { Logger } from "../log/logger.ts";
import type { PhotoCache } from "../host/types.ts";
import { expiringSoon } from "../plan/expiry.ts";
import { clients as defaultClients, weekConfig as defaultWeekConfig } from "../config/defaults.ts";
import { colorCss, DEFAULT_PLAN, DEFAULT_TIMEBOX, DEFAULT_UI, INBOX_GROUPINGS, INBOX_GROUPS, INBOX_SORTS, INBOX_VIEW_NAMES, TEXT_SIZES, THEMES, type AppConfig, type DataverseConfig, type GoogleConfig, type OutlookConfig, type ParseResult } from "../config/schema.ts";
import { setValue, type WriteResult } from "../config/edit.ts";
import type { CalendarSource } from "../sources/calendar/source.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { ClientRef, DevOpsSource } from "../sources/devops/source.ts";
import { calendarNotSetUp } from "../sources/not-set-up.ts";
import { buildWeek } from "../week/build.ts";
import { dotDays, type DotDay } from "../plan/status-dot.ts";
import { followedKeys } from "../week/follow.ts";
import { followOptions } from "./follow.ts";
import { guideAction } from "./guide-actions.ts";
import { docsAccessAction } from "./docs-actions.ts";
import { defaultWeekStart, localToday, minutesOn, mondayOf, todayTarget, weekDates7 } from "../week/dates.ts";
import { hoursOn, VIEW_RANGES, type TimeModel, type ViewRange } from "../week/hours.ts";
import { ptoByDate, type PtoDay, type PtoEntry } from "../week/pto.ts";
import type { CalEvent, ClientWork, FocusPattern, IsoDate, SourceResult, Week, WorkItem } from "../week/types.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { timeboxAction, timeboxesFor, timeboxView } from "./timebox-actions.ts";
import { devopsWriteAction, type DevOpsWriteContext, type WritePats, type AheadPort } from "./devops-write-actions.ts";
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
import { progressAction, type ProgressContext } from "./progress-actions.ts";
import { applyFollowUpRules, followUpView, internalClients, nameOf, workdayOf } from "./followup-rules.ts";
import { watchedIds } from "../plan/followups.ts";
import { pastUrgency } from "../plan/asks-ai.ts";
import { isActionName, type ActionName } from "./registry.ts";
import { captureAction, featuresOf, type CaptureContext } from "./capture-actions.ts";
import { draftAiAction, type PrepareContext } from "./draft-prepare.ts";
import { standardsForQuestion, standardsLookup, type StandardsLookup, type StandardsPort } from "./standards.ts";
import { followUpAction } from "./followup-actions.ts";
import { roadmapAction } from "./roadmap-actions.ts";
import { aheadAction, type AheadAction, type AheadContext } from "./ahead-actions.ts";
import { CHECKIN_DONE_MARK } from "./closeout-actions.ts";
import { placeFeature, titleFrom, weekPlanAction, weekPlanView, withTitles, type WeekPlanContext } from "./weekplan-actions.ts";
import { markScheduled, publishWeek, reportTeam, sendFacts, teamAction, type TeamAction, type TeamContext } from "./team-actions.ts";
import { inboxAction } from "./inbox-actions.ts";
import { diagnosticsAction } from "./diagnostics.ts";
import { snoozeDayOf } from "../plan/inbox-items.ts";
import { statusAction, type StatusAction, type StatusContext } from "./status-actions.ts";
import { freshAction, type FreshContext } from "./devops-fresh-actions.ts";
import { reportWindow } from "../plan/status-report.ts";
import { carryAction, idsByClient, markResolved, planBitsFor, resolvedKeys, type CarryContext } from "./carry-actions.ts";
import { weekNudges, withCurrentTitles, type NudgeTimes } from "../plan/weekplan.ts";
import { AHEAD_SEEN_MARK, aheadRitualsDue } from "../plan/rituals.ts";

import type { HostLinks } from "../host/types.ts";
import type { ActionResponse, SourceSummary, PlanningSettings, WeekLoadData } from "./types.ts";
import { DATAVERSE_UNREACHABLE, manyDataverseMatches, noDataverseMatch, type MatchResult } from "./dataverse-words.ts";
import { accountAction, storedIdentity, withMe, IDENTITY_KEY, type MicrosoftAccount, type StoredIdentity } from "./account.ts";
import { vmAction, vmKey, type VmContext } from "./vm-actions.ts";
import { presenceAction, syncTeamsStatusWith, type PresenceContext } from "./presence-actions.ts";
import type { BackgroundPolicy } from "../config/background-policy.ts";
import type { CheckNowResult } from "../plan/meetings.ts";
import type { AzureClient } from "../sources/azure/client.ts";
import { userZone } from "../week/zone.ts";
import { inList } from "./admin.ts";
import { adminAction, type AdminAction, type AdminOps } from "./admin-actions.ts";
import type { OrgRuntime } from "./org.ts";
import { aheadIdentities } from "./identities.ts";
import { clientRules, teamColors } from "../config/org.ts";
import { GAP_KINDS, TOP_N } from "../plan/fixnext.ts";
import { DEFAULT_AI_RULES, type AiRules } from "../ai/types.ts";
import { feedbackAction, type FeedbackBackend, type FeedbackContext } from "./feedback-actions.ts";
import { devopsFeedbackBackend } from "./feedback-devops.ts";
import type { FeedbackWriteTarget } from "./devops-write-actions.ts";
import type { Sender } from "../plan/feedback.ts";
import { setupAction, type SetupClient } from "./setup-actions.ts";
import { noticeAction, type PushPort } from "./notice-actions.ts";
import { meetingAction, type CaptureContext as MeetingCaptureContext, type MeetingAction, type MeetingContext, type MeetingUser } from "./meeting-actions.ts";
import type { MeetingStore } from "../store/meeting-store.ts";
import { MEETING_CHAT } from "../store/conversation-store.ts";
import type { MeetingSeries } from "../plan/meetings.ts";
import type { ClientChat } from "../plan/requests.ts";
import { inviteDomains } from "../config/schema.ts";
import type { LinkCalendars } from "../sources/ics/source.ts";
import { calendarLinkAction } from "./calendar-link-actions.ts";

/** The plan store marker for the first launch (step 17.5). */
const FIRST_LAUNCH_MARK = "first_launch";
/** G1: the "Take the 2-minute tour" link on a person's first Today, once they open it or say Not now. */
const TOUR_MARK = "tour_offer";

export type { ActionResponse, SourceSummary, WeekLoadData };

export type ActionContext = {
  /** KB-1: the synced standards. Absent: none here. */
  standards?: StandardsPort;
  /** AI-0: the app's AI runtime (settings, provider, the app's spend). Absent: AI isn't available here (demo). */
  ai?: AiRuntime;
  /** Shared polling (D514): the shared Teams store and the poll job's Refresh. Absent: no client chats or Requests. */
  requests?: RequestsPort;
  /** D522: a plain list of admins (Entra object ids), for tests and contexts without `adminOps`. */
  admins?: readonly string[];
  /** ADM-1: the admin console's server side (the one admin check, the org settings, people, health). Absent: no Admin. */
  adminOps?: AdminOps;
  /** ADM-1: the team's settings and people (levels, client leads), for every action. Absent: built-in defaults. */
  org?: OrgRuntime;
  /** AP-1: the structured logger (counts and kinds only). Absent: nothing is logged (tests, demo). */
  log?: Logger;
  /** S1 (D452): where this runs: local, dev, prod or demo (runtime config). Absent: local. */
  env?: string;
  /**
   * ENV-1: what may run here (config/background-policy.ts), computed once by server/main.ts. Only the few on-demand
   * paths that differ on a test site read it (Teams status, Refresh, Check now). Absent: as in production (tests).
   */
  background?: BackgroundPolicy;
  /** R1: what to do when the one-time move from Coopilot's keyring entries failed; shown on the sign-in screen. */
  renameNote?: string | null;
  /** Step 16.4: the profile photo cache (~/.cache/focustime/photos). Absent: photos aren't cached (demo mode, tests). */
  photoCache?: PhotoCache;
  /** Step 15.5: the notifier (test and sample notifications). Absent: notifications aren't available here. */
  notifications?: { test: () => Promise<void>; sample: (kind: string, live: boolean, gated: boolean) => Promise<boolean> };
  /** TB-2: the bot's rhythm for this person (Settings › Notifications › In Teams); absent without the Teams bot. */
  teams?: { status: () => Promise<{ chat: boolean; blocked: boolean }>; test: (kind: TeamsKind) => Promise<{ ok: true } | { ok: false; message: string }> };
  /** P1: this person's Web Push (devices, the app's VAPID key). Absent: push isn't available (demo, tests). */
  push?: PushPort;
  loadConfig: () => Promise<{ path: string; parsed: ParseResult; created?: boolean }>;
  makeDataverse: (cfg: DataverseConfig, timeZone: string) => DataverseSource;
  makeOutlook: (cfg: OutlookConfig, timeZone: string) => CalendarSource & { write?: OutlookWrite; schedule?: ScheduleReader; people?: PeopleReader };
  makeGoogle: (cfg: GoogleConfig, timeZone: string) => CalendarSource;
  /** CAL-1: this person's calendars added by link (read only); absent where there are none (tests). */
  linkCalendars?: LinkCalendars;
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
  /** Settings (step 6b): plan export. App secrets are never set from Settings (ST-1). */
  exportPlan?: (json: string) => Promise<string>;
  /** A2: the signed-in person's own data: everything as JSON (no secrets), and the delete (signs them out). */
  myData?: { export: () => Promise<Record<string, unknown>>; remove: () => Promise<{ hardDeleteOn: string }> };
  /** Step 14: personal DevOps write PATs in the keyring, and the DevOps writer. Absent: DevOps stays read-only. */
  writePats?: WritePats;
  devopsWriter?: DevOpsWriter;
  /** PV-1: Take one's notices (an app table shared by everyone); absent in the demo and tests that don't need it. */
  takes?: import("../store/devops-takes.ts").TakesStore;
  /** AH-1 (D664): notices to a new assignee and to owners whose dates moved (an app table). Absent: none sent. */
  devopsNotes?: import("../store/devops-notes.ts").NotesStore;
  /** AH-1 (D660): a write's read-back into the central DevOps store and its change log. Absent: the next check has it. */
  devopsStored?: (clientKey: string, value: { id: number; fields: Record<string, unknown> }) => Promise<void>;
  /** SW-1: sends, week commitments, client priorities and Ask to look (app tables). Absent: none of it here. */
  team?: import("../store/team-store.ts").TeamStore;
  /** MC-1: the registered client calls (app tables) and the FocusTime users they name. Absent: no meeting capture here. */
  meetings?: MeetingsPort;
  /** SW-1: whether a person has signed in to FocusTime (can receive sends). Absent: their entry has a sign-in. */
  onFocusTime?: (personId: string) => boolean;
  /** Media control for focus (step 10): the host's. Absent: none (tests, demo). */
  media?: MediaControl;
  /** Step 15 (D272): demo mode, whether this context is the demo one and how to switch. Absent: no demo mode. */
  demo?: { on: boolean; set: (on: boolean) => Promise<void>; /** DM-1: Reset demo (absent: not offered here). */ reset?: () => Promise<void>; /** DM-1: how the demo's AI has answered (counts and the last reason, never text). */ status?: () => DemoStatus; /** DV-2: a teammate's change in the demo's DevOps (not through FocusTime), to watch it arrive. */ devopsChange?: (clientKey: string, change: unknown) => { ok: true; id: number } | { ok: false; error: string } };
  /**
   * Step 15.4: the Microsoft sign-in for a config (null without an [outlook] app registration), and an Azure Resource
   * Manager client on a token. Absent: no sign-in here (tests that don't need it), and the config's "me" is used.
   */
  account?: (cfg: AppConfig) => MicrosoftAccount | null;
  azure?: (token: () => Promise<string>) => AzureClient;
  /**
   * F1, FB-1: Send feedback: who is sending and where it goes (the org.feedback Rule); it is created through the write
   * framework with their own write PAT. The demo hands in its pretend backlog instead. Absent: feedback isn't available here.
   */
  feedback?: { sender: () => Promise<Sender | null>; target?: () => Promise<FeedbackWriteTarget | null>; demo?: FeedbackBackend };
};

/**
 * Actions that reach outside FocusTime or change secrets: refused while demo mode is on (D272). DM-1: the demo's
 * Outlook and DevOps writes (write.confirm, devops.confirm and their retries) run against the session's in-memory
 * DevOps and calendar (server/demo.ts), so they are no longer refused; secrets, connecting accounts, sign-in, export and
 * opening links still are.
 */
export const DEMO_REFUSED: readonly ActionName[] = [
  "link.open", "outlook.open", "playlist.open", "data.export",
  "auth.connect_microsoft", "auth.connect_google", "auth.connect_outlook_write", "auth.disconnect",
  "devops.set_write_pat", "devops.clear_write_pat",
  "auth.sign_in", "auth.sign_out", "push.subscribe",
];
/** DM-1: what the preflight reads about a demo session (counts only). */
export type DemoStatus = { ai: { realProvider: boolean; real: number; samples: number; lastReason: string | null } };
export const DEMO_REFUSAL = "Demo data: nothing leaves FocusTime in demo mode";

export type ActionRequest = { action: unknown; input: unknown };

const bad = (error: string): ActionResponse => ({ ok: false, status: 400, error });

type WeekLoadInput = {
  weekStart?: string;
  now?: string;
  refresh?: boolean;
  /** DV-1: a background reload (window focus, the 5-minute timer): calendars as `refresh` says, DevOps from the store. */
  quiet?: boolean;
  /** Step 15 (D271): this session's view range, not saved. */
  viewRange?: ViewRange;
  /** WK-3: Show weekend (the viewer's switch, kept in their browser): Saturday and Sunday always. */
  weekend?: boolean;
};

function validateWeekLoad(input: unknown): WeekLoadInput | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "input must be an object";
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["weekStart", "now", "refresh", "quiet", "viewRange", "weekend"].includes(k)) return `unknown input field ${k}`;
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
  if (o.quiet !== undefined) {
    if (typeof o.quiet !== "boolean") return "quiet must be true or false";
    out.quiet = o.quiet;
  }
  if (o.weekend !== undefined) {
    if (typeof o.weekend !== "boolean") return "weekend must be true or false";
    out.weekend = o.weekend;
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
  const { pickablePortfolioTypes: _ignored, backgroundTypes: _bg, ...rest } = cfg.plan;
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
  const ca = await clientsOf(ctx.org);
  const planClients = clients.filter((c) => !ca || ca.isClient(c.clientKey));
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
        const [o, g, l] = await Promise.all([
          cfg.outlook ? ctx.makeOutlook(cfg.outlook, tz).load(w, opts).catch(() => null) : null,
          cfg.google ? ctx.makeGoogle(cfg.google, tz).load(w, opts).catch(() => null) : null,
          ctx.linkCalendars ? ctx.linkCalendars.load(w, opts).catch(() => []) : [],
        ]);
        events = withoutOwn([...(o?.items ?? []), ...(g?.items ?? []), ...l.flatMap((x) => x.items)], own);
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
  // CAL-1: calendars added by link, one result each (none when there are none); a failure keeps the last good events.
  const linksP: Promise<SourceResult<CalEvent>[]> = ctx.linkCalendars ? ctx.linkCalendars.load(weekStart, refresh).catch(() => []) : Promise.resolve([]);

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
      // AP-2: and the items promises are linked to, so a promise closes when its item is done.
      if (ctx.plan)
        for (const p of (await ctx.plan.promises().catch(() => []))) if (p.status === "linked" && p.itemId !== null) (watch[p.clientKey] ??= []).includes(p.itemId) || watch[p.clientKey]!.push(p.itemId);
      // Features on the week lists of this week, today's week and next (step 8), so Plan the day can offer their
      // stories. Every list item (features and stories) is also read by id, done ones included, so progress can count
      // what DevOps shows as Completed (step 11).
      const features: Record<string, number[]> = {};
      if (ctx.plan)
        for (const f of (await ctx.plan.weekFeaturesFor(featureWeeks(weekStart, todayDate)))) {
          if (f.level === "feature") (features[f.clientKey] ??= []).includes(f.itemId) || features[f.clientKey]!.push(f.itemId);
          (watch[f.clientKey] ??= []).includes(f.itemId) || watch[f.clientKey]!.push(f.itemId);
        }
      // DV-1: only R and the Refresh button make DevOps check now (once per 30 s per client); a quiet reload reads the store.
      devopsP = ctx.makeDevOps(dv, tz).load(picked.fetch, { ...(input.refresh && !input.quiet ? { refresh: true } : {}), watch, features }).catch(() => null);
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
  const [outlook, google, devops, ptoResult, ahead, synced, linked] = await Promise.all([outlookP, googleP, devopsP, ptoP, aheadP, syncP, linksP]);
  (await ctx.plan?.closeHelpFollowUps(Temporal.Instant.from(ctx.now())));
  const pto = ptoByDate(ptoResult?.items ?? [], weekDates7(weekStart));
  const ptoAhead = [...new Set((ahead?.items ?? []).map((e) => e.date))].sort();
  const sunday = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
  const unavailable = (await ctx.plan?.unavailableBetween(weekStart, sunday)) ?? [];
  const flex = (await ctx.plan?.flexBetween(weekStart, sunday)) ?? [];
  const weekendPicks = (await ctx.plan?.picksBetween(weekDates7(weekStart)[5]!, sunday)) ?? [];
  // WK-3: a weekend day shows when something lands on it: a to-do (a Deployment too), a timebox, a promise due (one
  // I added or one from a chat), or always with Show weekend on. Calendar events count inside buildWeek.
  const chatPromises: DayPromise[] = cfg && ctx.requests?.conversations ? await conversationContext(ctx).then((c) => dayPromises(c, cfg)).catch(() => []) : [];
  const weekendBoxes = (await ctx.plan?.timeboxesBetween(weekDates7(weekStart)[5]!, sunday)) ?? [];
  const weekendFollowUps = ctx.plan ? (await ctx.plan.openFollowUps()).filter((f) => !!f.due && f.due >= weekDates7(weekStart)[5]! && f.due <= sunday) : [];
  const weekendPlanned = new Set(
    weekDates7(weekStart).slice(5).filter((d) =>
      input.weekend ||
      weekendPicks.some((p) => p.date === d && (p.status === "planned" || p.status === "done")) ||
      weekendBoxes.some((t) => t.date === d && !t.removedAt) ||
      weekendFollowUps.some((f) => f.due === d) ||
      chatPromises.some((k) => k.dueDate === d)),
  );
  // FocusTime's own Outlook events show once, as timeboxes, and never count as meetings in risk rules (step 12).
  const own = ctx.plan ? ownEventIds((await ctx.plan.ownEvents())) : new Set<string>();
  const week = buildWeek({ weekStart, patterns: dataverse.items, events: withoutOwn([...outlook.items, ...google.items, ...linked.flatMap((l) => l.items)], own), config: weekConfig, pto, unavailable, flex, viewRange: input.viewRange ?? cfg?.ui.viewRange ?? DEFAULT_UI.viewRange, weekendPlanned });
  const todayDay = week.days.find((d) => d.date === todayDate);
  let clientColors = cfg ? cfg.clients : Object.fromEntries(Object.values(defaultClients).map((c) => [c.shortName, c.color]));
  // ADM-1: every client on the week has a team color (suggested the first time), unless the person picked their own.
  if (cfg && ctx.org) {
    const keys = [...new Set([...dataverse.items.map((p) => p.clientKey), ...planClients.map((c) => c.clientKey)])];
    await ctx.org.suggestColors(keys).catch(() => undefined);
    const team = teamColors(await ctx.org.rules());
    clientColors = { ...Object.fromEntries(Object.entries(team).map(([k, c]) => [k, colorCss(c)])), ...cfg.clients };
  }

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
  const weekPlans0 = plan ? await plan.week(week.days.map((d) => d.date)) : null;
  // PL-1: what DevOps resolved, the check-ins and Keep open: one set of budget inputs for Commit and the Board; and
  // a pick of a resolved item counts zero and shows as done.
  const listed = plan ? (await plan.weekPlan(weekStart)).features : [];
  const carry = cfg && plan
    ? await (async () => planBitsFor({ cfg, plan, devops: ctx.makeDevOps(cfg.dataverse, tz), refs: (devops ?? []).map((w) => ({ clientKey: w.clientKey, clientName: w.clientName })), weekStart, items: [...listed, ...Object.values(weekPlans0 ?? {}).flatMap((d) => d.picks)] }))().catch(() => null)
    : null;
  const weekPlans = weekPlans0 && carry?.resolved.size ? Object.fromEntries(Object.entries(weekPlans0).map(([d, v]) => [d, { ...v, picks: markResolved(v.picks, carry.resolved) }])) : weekPlans0;
  // CF-1: weeks with anything placed (this week, next week, the week shown and the Look ahead week) stand in for
  // "confirmed" in the week's reminders and Look ahead.
  const nextMon = Temporal.PlainDate.from(mondayOf(todayDate)).add({ days: 7 }).toString();
  const workWeeks = plan ? await plan.weeksWithWork([mondayOf(todayDate), nextMon, Temporal.PlainDate.from(nextMon).add({ days: 7 }).toString(), Temporal.PlainDate.from(mondayOf(todayDate)).subtract({ days: 7 }).toString(), weekStart]) : new Set<IsoDate>();
  const aheadSeen = plan ? await plan.markedDates(AHEAD_SEEN_MARK) : new Set<IsoDate>();
  const clientName = nameOf(cfg, (k) => names.get(k));
  const writeLog = plan ? await plan.writeLog(1000) : [];
  // WK-3: the week's after-hours time (plan/deploy.ts afterHours: deployment windows outside the day shape, to-dos I
  // put in an evening or on a weekend, FocusTime's own timeboxes after hours; never calendar events).
  const weekBoxes = plan ? await timeboxesFor(plan, weekStart, sunday) : [];
  const local = (t: { date: IsoDate; start: string; end: string }) => ({ start: Math.max(0, minutesOn(t.date, t.start, tz)), end: Math.min(1440, minutesOn(t.date, t.end, tz)) });
  const sizes = planningOf(cfg).sizes;
  const after = afterHours({
    model,
    dates: weekDates7(weekStart),
    picks: plan ? await plan.picksBetween(weekStart, sunday) : [],
    pickSpans: new Map(weekBoxes.filter((t) => t.pickId !== null).map((t) => [t.pickId!, local(t)])),
    looseSpans: weekBoxes.filter((t) => t.pickId === null).map((t) => ({ date: t.date, title: t.title, span: local(t) })),
    pto: new Set(Object.entries(pto).filter(([, v]) => !v.half).map(([d]) => d)),
    minutesOf: (p) => pickNeed(p, sizes),
  });
  return {
    weekStart,
    week,
    afterHours: after,
    today: columnOf(todayTarget(now, model, { todayHasPlans: todayPlans, hasEve: !!todayDay?.eve }), week),
    plan: weekPlans,
    planClients,
    planDay: { date: todayDate, workday: (await hasHoursFor(ctx, model, todayDate)) && !todayOff, available: !!ctx.plan },
    ptoAhead,
    sources: [dataverse, ...(ptoResult ? [ptoResult] : []), outlook, google, ...linked].map(summarize),
    devops,
    clients: clientColors,
    guidance: cfg?.org?.guidance ?? null,
    planBits: carry?.bits ?? null,
    checkins: plan ? checkinGhosts(await plan.weekWatches(weekStart)) : [],
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
      ? aheadRitualsDue({ today: todayDate, time: Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainTime().toString().slice(0, 5), workStart: hoursOn(model, todayDate).segments[0]?.start ?? null, pto: todayOff, weekHasWork: (w) => workWeeks.has(w), seen: (k) => aheadSeen.has(k) }).map((r) => r.kind)
      : [],
    weekNudge: { badge: ctx.plan && cfg ? weekNudges(Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz), nudgeTimes(cfg), (w) => workWeeks.has(w)).badge : null },
    // WD-1: Thursday's and Friday's "Next week is empty".
    nextWeekEmpty: plan ? await (async () => {
      const next = Temporal.PlainDate.from(mondayOf(todayDate)).add({ days: 7 });
      if ((await plan.weekPlan(next.toString())).features.length) return false;
      const days = Array.from({ length: 7 }, (_, i) => next.add({ days: i }).toString());
      return !Object.values(await plan.week(days)).some((d) => d.picks.some((p) => p.status === "planned" || p.status === "done"));
    })() : false,
    timeboxes: plan ? await mapSeq(await timeboxesFor(plan, weekStart, sunday), (t) => timeboxView(t, plan, cfg)) : [],
    timeboxSettings: cfg?.timebox ?? DEFAULT_TIMEBOX,
    eventEdit: synced.facts,
    canWrite: synced.canWrite,
    invites: plan ? (await plan.invitesFrom(Temporal.PlainDate.from(weekStart).subtract({ days: 7 }).toString())).map((i) => ({ writeId: writeLog.find((e) => e.uid === i.uid && e.op === "create" && e.status === "confirmed" && !e.undoneBy)?.id ?? null, uid: i.uid, clientKey: i.clientKey, itemId: i.itemId, pickId: i.pickId, timeboxId: i.timeboxId, title: i.title, start: i.start, end: i.end, names: i.attendees.map((a) => a.name), teams: i.teams, status: i.status })) : [],
    collab: cfg?.collab ?? DEFAULT_COLLAB,
    devopsWrite: ctx.plan && ctx.devopsWriter && ctx.writePats ? (await ctx.plan.devopsIdentities()).map((i) => i.clientKey) : [],
    // Step 14.5 (D256): write PATs and app secrets that expire within 14 days, for Today.
    expiring: (await expiringFor(ctx.plan, cfg, serverToday, (k) => names.get(k))),
    requests: await urgentFor(ctx, now, tz, (k) => names.get(k) ?? cfg?.clientSettings[k]?.name ?? k).catch(() => ({ urgent: [], pastUrgency: 0 })),
    promises: chatPromises,
    ui: cfg?.ui ?? DEFAULT_UI,
    config: { ok: parsed.ok, path: loaded.path, created: !!loaded.created, errors: parsed.ok ? [] : parsed.errors },
    demo: !!ctx.demo?.on,
  };
}

/**
 * AP-2: open requests sorted as urgent "now" (Today), and the open ones past their urgency window (Check-in), in the
 * chats this person sees. Requests that weren't sorted have no urgency and count in neither.
 */
async function urgentFor(ctx: ActionContext, now: string, zone: string, name: (k: string) => string): Promise<WeekLoadData["requests"]> {
  const teams = ctx.requests?.teams;
  if (!teams) return { urgent: [], pastUrgency: 0 };
  const c = await chatContext(ctx);
  const me = await c.me();
  const open = await urgentRequests(me ? teams.viewer(me) : null, await c.clientKeys().catch(() => null));
  // CV-2: each line opens its conversation (#/inbox/conversation/<id>) when its message is in one I see.
  const convs = me && ctx.requests?.conversations ? ctx.requests.conversations.viewer(me) : null;
  const urgent = [];
  for (const a of open.filter((x) => x.sort!.urgency === "now")) {
    const place = convs ? await convs.placeOf(a.chatId, a.messageId).catch(() => null) : null;
    urgent.push({ chatId: a.chatId, messageId: a.messageId, clientKey: a.clientKey, clientName: name(a.clientKey), title: a.sort!.title, at: a.createdAt, conversationId: place?.conversationId ?? null });
  }
  return {
    urgent,
    pastUrgency: open.filter((a) => pastUrgency(a.sort!.urgency, a.createdAt, now, zone)).length,
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
    // ENV-1: outside production the focus timer never sets or clears Teams status.
    writes: ctx.background ? ctx.background.allows("teams_status") : true,
    team: async (cfg) => {
      const r = await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).teammates();
      return r.ok ? r.people : null;
    },
    now: ctx.now,
  };
}

/** T-2: delivery chats: the sign-in, Cooptimize's tenant, and the person's clients as Settings lists them. */
export async function chatContext(ctx: ActionContext): Promise<ChatContext> {
  return {
    ...(ctx.plan ? { plan: ctx.plan } : {}),
    ...(ctx.requests ? { teams: ctx.requests.teams } : {}),
    me: async () => (await storedIdentity(ctx.plan))?.oid ?? null,
    isAdmin: () => amAdmin(ctx),
    account: await accountOf(ctx),
    homeTenant: async () => (await configured(ctx))?.outlook?.tenantId ?? (await storedIdentity(ctx.plan))?.tid ?? null,
    clientKeys: async () => {
      const cfg = await configured(ctx);
      if (!cfg) return null;
      const mine = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).myClients().catch(() => null) : null;
      if (!mine) return null;
      const kept = Object.entries(cfg.clientSettings).filter(([, v]) => v.follow).map(([k]) => k);
      return new Set([INTERNAL_CLIENT, ...mine.map((c) => c.clientKey), ...kept, ...cfg.week.standingBlocks.map((b) => b.clientKey)]);
    },
    now: ctx.now,
  };
}

/** DevOps project names from a work item's link (https://dev.azure.com/<org>/<project>/_workitems/...). */
const projectOf = (url: string): string | null => {
  const m = /^https:\/\/dev\.azure\.com\/[^/]+\/([^/_][^/]*)\//.exec(url);
  if (!m) return null;
  const p = decodeURIComponent(m[1]!);
  return /^[0-9a-f-]{36}$/i.test(p) ? null : p;
};

/**
 * AI-0: every client the guard must know (all but the internal one): its key, Dataverse and display names, and the
 * DevOps projects and work item ids already read (Week, Plan the week). Nothing is fetched for this: a client whose
 * DevOps wasn't read yet is known by its names only.
 */
async function aiDirectory(ctx: ActionContext, cfg: AppConfig): Promise<ClientEntry[]> {
  const zone = userZone(cfg);
  const mine = cfg.dataverse.mySystemUserId ? ((await ctx.makeDataverse(cfg.dataverse, zone).myClients().catch(() => null)) ?? []) : [];
  const keys = new Set([...mine.map((c) => c.clientKey), ...Object.keys(cfg.clientSettings), ...cfg.week.standingBlocks.map((b) => b.clientKey)]);
  keys.delete(INTERNAL_CLIENT);
  const devops = ctx.makeDevOps(cfg.dataverse, zone);
  // AP-2: item ids from the remembered map (every read, kept across restarts), plus what this process read last.
  const remembered = (await ctx.plan?.itemClients().catch(() => null)) ?? new Map<string, number[]>();
  for (const k of remembered.keys()) if (k !== INTERNAL_CLIENT) keys.add(k);
  return [...keys].map((key) => {
    const w = devops.last(key);
    const items = w ? [...w.items, ...w.children, ...(w.watched ?? []), ...(w.committed ?? [])] : [];
    const names = [mine.find((c) => c.clientKey === key)?.clientName, cfg.clientSettings[key]?.name].filter((n): n is string => !!n && n !== key);
    // GD-2: an admin's aliases for the client (Admin › Clients), matched like its names.
    const aliases = cfg.org?.clients[key]?.aliases ?? [];
    // HK-7: "Match only as written", the admin's choice or the default rule (on for a name that is an ordinary word).
    const exactCase = cfg.org?.clients[key]?.exactCase ?? exactCaseDefault([key, ...names]);
    return { key, names: [...new Set(names)], ...(aliases.length ? { aliases: [...aliases] } : {}), ...(exactCase ? { exactCase: true } : {}), projects: [...new Set(items.map((i) => projectOf(i.url)).filter((p): p is string => !!p))], itemIds: [...new Set([...items.map((i) => i.id), ...(remembered.get(key) ?? [])])] };
  });
}

/**
 * GD-1, GD-2: the client boundary for one client: Internal (clientAccounts()'s why "internal") may name clients;
 * any other client gets the person's directory of the rest (names, aliases, projects, item ids) to check against.
 */
export async function boundaryOf(ctx: ActionContext, clientKey: string | null): Promise<{ internal: boolean; directory: ClientEntry[] }> {
  if (clientKey && (await isInternalKey(ctx.org, clientKey))) return { internal: true, directory: [] };
  const cfg = await configured(ctx);
  return { internal: false, directory: cfg ? await aiDirectory(ctx, cfg) : [] };
}

/** GD-2: the Cooptimizer rule a chat's members are read against (the people rule: tenant, guests, automation, domains). */
export async function audienceRulesOf(org: ActionContext["org"], homeTenant: string | null): Promise<AudienceRules> {
  if (!org) return { homeTenant, automation: [], domains: [] };
  const [r, lv] = await Promise.all([org.rules().catch(() => null), org.levels().catch(() => null)]);
  return {
    homeTenant,
    automation: r?.automation ?? [],
    domains: r?.organization.inviteDomains ?? [],
    ...(lv ? { notCooptimizer: (id: string) => !!lv.people.entry(id)?.notCooptimizer } : {}),
  };
}

/** ADM-1: whether the signed-in person is an admin: the one check (the group or the break-glass list), else a plain list. */
export async function amAdmin(ctx: ActionContext): Promise<boolean> {
  const id = (await storedIdentity(ctx.plan))?.oid ?? null;
  return ctx.adminOps ? ctx.adminOps.check.isAdmin(id) : inList(id, ctx.admins);
}

/** AI-0: the AI service for this person and request, or null where AI isn't available (demo, no plan store). */
export async function aiFor(ctx: ActionContext, o: { cap?: "person" | "app"; rules?: AiRules; /** AI-F1: a person waits on it: standard tier. */ waiting?: boolean } = {}): Promise<AiService | null> {
  const rt = ctx.ai;
  const plan = ctx.plan;
  if (!rt || !plan) return null;
  // CV-1: the shared pipeline counts against the app's cap and logs in the app's AI log (D-CV), not the person's.
  const appLog = o.cap === "app" ? ctx.requests?.conversations?.appAiLog : undefined;
  if (o.cap === "app" && !appLog) return null;
  return createAi({
    ...(o.cap === "app" ? { cap: "app" as const } : {}),
    ...(o.waiting ? { waiting: true } : {}),
    provider: rt.provider,
    app: rt.app,
    // ADM-1: the admins' rules only (applied to the config by the org runtime): no per-person switch.
    rules: async () => o.rules ?? (await configured(ctx))?.aiRules ?? DEFAULT_AI_RULES,
    guard: async (client: string) => {
      const cfg = await configured(ctx);
      if (!cfg) return { directory: [], homeDomains: [], forbidden: [] };
      const me = await storedIdentity(plan);
      const vm = me ? await plan.accountState<ChosenVm>(vmKey(me.oid)).catch(() => null) : null;
      // GD-1: Internal (clientAccounts()'s why "internal") may name clients; secrets, the VM and outside addresses still refuse.
      return { directory: await aiDirectory(ctx, cfg), homeDomains: inviteDomains(cfg), forbidden: vm ? [vm.name, vm.id] : [], internal: await isInternalKey(ctx.org, client) };
    },
    log: appLog ?? { add: (e) => plan.addAiRequest(e), spentMicros: (a, b) => plan.aiSpentMicros(a, b), recent: (n) => plan.aiRequests(n) },
    appSpend: rt.appSpend,
    now: ctx.now,
    ...(rt.logger ? { logger: rt.logger } : ctx.log ? { logger: ctx.log } : {}),
  });
}

/**
 * AS-1: the assistant for this person (the panel's, or TB-1's Teams bot's): their own dispatch, limited to the actions
 * the allowlist names (assistant/allowlist.ts RUNS), their AI service, the guard's directory and their clients only.
 */
/** AS-1: the assistant's AI (DM-1: in the demo, the demo's own runtime, like every other AI feature there). */
const assistantAiFor = (ctx: ActionContext) => aiFor(ctx);

export async function assistantFor(ctx: ActionContext, channel: Channel): Promise<{ service: AssistantService; reads: ReadDeps } | null> {
  const plan = ctx.plan;
  if (!plan) return null;
  const cfg = await configured(ctx);
  if (!cfg) return null;
  const zone = userZone(cfg);
  const directory = await aiDirectory(ctx, cfg);
  const ca = await clientsOf(ctx.org);
  const keys = new Set(directory.map((c) => c.key));
  const isMine = (k: string) => k === INTERNAL_CLIENT || (keys.has(k) && (ca ? ca.isClient(k) : true));
  const clientName = (k: string) => (k === INTERNAL_CLIENT ? "Internal" : directory.find((c) => c.key === k)?.names[0] ?? cfg.clientSettings[k]?.name ?? k);
  const run = (action: ActionName, input: unknown): Promise<ActionResponse> => (ASSISTANT_RUNS.has(action) ? dispatch(ctx, { action, input }) : Promise.resolve({ ok: false, status: 403, error: "The assistant can't do that" }));
  // GD-1's rule for Internal: clientAccounts()'s why "internal" (isInternalKey), never a name.
  const accounts = ca ?? clientAccounts({ accounts: [], overrides: {}, internal: INTERNAL_CLIENT });
  const isInternal = (k: string) => accounts.row(k)?.why === "internal";
  const service = createAssistant({ run, plan, ai: await assistantAiFor(ctx), directory, isMine, isInternal, clientName, now: ctx.now, zone, channel, standards: (question) => standardsForQuestion(ctx.standards, question) });
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(zone).toPlainDate().toString();
  const link = (href: string, label: string) => ({ label, href });
  return { service, reads: { run, today, now: ctx.now(), zone, isMine, clientName, link } };
}

/** AS-1: the client in focus for voice: the screen's client, else the selected item's client (from the directory). */
function focusOf(directory: Awaited<ReturnType<typeof aiDirectory>>, c: AssistantContext): { focus: string | null; name: string | null } {
  const focus = c.clientKey && directory.some((d) => d.key === c.clientKey) ? c.clientKey : c.itemId ? (directory.find((d) => d.itemIds.includes(c.itemId!))?.key ?? null) : null;
  return { focus, name: focus ? (directory.find((d) => d.key === focus)?.names[0] ?? focus) : null };
}

/**
 * AS-1: what the panel shows before anything is sent: whether the assistant can answer at all, and whether the mic is
 * on for what is on screen (the same gate as transcribe). Nothing is sent to a provider to find out.
 */
export async function assistantGate(ctx: ActionContext, c: AssistantContext): Promise<AssistantGate> {
  const cfg = await configured(ctx);
  const ai = cfg ? await assistantAiFor(ctx) : null;
  if (!cfg || !ai) return { assistant: "not_set_up", voice: { on: false, message: "Voice isn't set up here" } };
  const a = await ai.availability("none");
  const voiceSetUp = !!(await ctx.ai?.provider())?.transcribe;
  if (a !== "ok") return { assistant: a === "client_off" ? "ok" : a, voice: { on: false, message: a === "off" ? "Voice is off: AI is off for FocusTime" : "Voice isn't set up here" } };
  if (!voiceSetUp) return { assistant: "ok", voice: { on: false, message: "Voice isn't set up here" } };
  const { focus, name } = focusOf(await aiDirectory(ctx, cfg), c);
  if (focus && (await ai.availability(focus)) === "client_off") return { assistant: "ok", voice: { on: false, message: `Voice is off while ${name} is in focus` } };
  return { assistant: "ok", voice: { on: true, message: null } };
}

/**
 * AS-1: one push-to-talk recording to text, for the panel. Never stored or logged: the bytes are only in this call.
 * The gate: AI for FocusTime on and, when a client is in focus (the screen's client or the selected item's), that
 * client's Allow AI ("Voice is off while <client> is in focus"); with none in focus, AI for FocusTime is enough.
 */
export async function assistantTranscribe(ctx: ActionContext, t: { audio: Uint8Array; mime: string; seconds: number; context?: AssistantContext }): Promise<TranscribeResult> {
  if (!/^audio\/(webm|mp4)(;.*)?$/i.test(t.mime)) return { ok: false, reason: "format", message: "That recording's format isn't one FocusTime takes (WebM or MP4 audio)" };
  if (!t.audio.length) return { ok: false, reason: "format", message: "Nothing was recorded" };
  if (t.audio.length > VOICE_MAX_BYTES) return { ok: false, reason: "too_large", message: "That recording is too large" };
  if (!Number.isFinite(t.seconds) || t.seconds <= 0 || t.seconds > VOICE_MAX_SECONDS + 1) return { ok: false, reason: "too_long", message: `Recordings stop at ${VOICE_MAX_SECONDS} seconds` };
  const cfg = await configured(ctx);
  const ai = cfg ? await assistantAiFor(ctx) : null;
  if (!cfg || !ai) return { ok: false, reason: "not_set_up", message: "Voice isn't set up here" };
  const { focus, name } = focusOf(await aiDirectory(ctx, cfg), t.context ?? {});
  const r = await ai.transcribe(t.audio, t.mime, Math.min(t.seconds, VOICE_MAX_SECONDS), focus ?? "none");
  if (r.ok) return { ok: true, text: r.text };
  const k = r.error.kind;
  if (k === "off") return { ok: false, reason: "off", message: "Voice is off: AI is off for FocusTime" };
  if (k === "client_off") return { ok: false, reason: "client_off", message: `Voice is off while ${name ?? "this client"} is in focus` };
  if (k === "not_set_up") return { ok: false, reason: "not_set_up", message: "Voice isn't set up here" };
  if (k === "over_budget" || k === "zero_budget") return { ok: false, reason: "over_budget", message: r.error.message };
  return { ok: false, reason: "provider", message: "The recording couldn't be turned into text. Try again, or type it" };
}

/** The write framework's pieces (step 14): the person's write PAT, never the company read PAT. */
async function devopsWriteContext(ctx: ActionContext): Promise<DevOpsWriteContext> {
  return {
    plan: ctx.plan,
    ...(ctx.requests ? { requests: await sharedFor(ctx, ctx.requests) } : {}),
    ...(ctx.requests?.conversations ? { conversations: await conversationsPortFor(ctx, ctx.requests) } : {}),
    config: () => configured(ctx),
    // Never the company read PAT: this read doesn't select it.
    targets: (cfg, keys) => ctx.makeDataverse(cfg.dataverse, userZone(cfg)).devopsTargets(keys, { withPat: false }),
    writer: ctx.devopsWriter ?? null,
    pats: ctx.writePats ?? null,
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    now: ctx.now,
    ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
    ...(ctx.takes ? { takes: ctx.takes } : {}),
    ...(ctx.devopsNotes ? { notes: ctx.devopsNotes } : {}),
    ...(ctx.plan ? { ahead: aheadPort(ctx, ctx.plan) } : {}),
    // GD-1: text naming another client never goes into a client's DevOps (Internal may name clients).
    boundary: (clientKey) => boundaryOf(ctx, clientKey),
    // CV-4: a conversation's images, read from Teams with my own token when I create the item (never stored).
    ...(ctx.requests ? { chatImages: async () => (await accountOf(ctx))?.chatMessages ?? null } : {}),
    // SR-1: a comment edit only inside the client's status report window (Kat's last send, else Monday 7:00 AM ET).
    reportSince: async (cfg, clientKey) => {
      const r = await katSentFor(ctx, cfg, [clientKey]).catch(() => null);
      return reportWindow(r?.ok ? (r.sent[clientKey] ?? null) : null, Temporal.Instant.from(ctx.now())).since;
    },
  };
}

/**
 * LP-1: Close the loop's pieces for this person: their promises (both kinds, mine only), the chat the ask came from
 * with its cached members, the directory for a Cooptimizer's address, the item's live state, GD-1's boundary, the AI
 * (a person waits: standard tier, my cap), the Graph sends as me, the consent probes and the DevOps write framework.
 */
/** LP-1's consent probe for sending as me (a token check; nothing is sent). IN-2's invites use the same one. */
function sendProbe(ctx: ActionContext): LoopContext["access"] {
  return async (kind) => {
    const a = await accountOf(ctx);
    if (!a?.probe) return "unavailable" as const;
    const r = await a.probe(kind).catch(() => null);
    return r?.state === "granted" ? ("granted" as const) : r?.state === "consent" ? ("consent" as const) : ("unavailable" as const);
  };
}

export async function loopContext(ctx: ActionContext): Promise<LoopContext> {
  const cc = await conversationContext(ctx);
  const plan = ctx.plan;
  const cfgOf = () => configured(ctx);
  const nameOf = async (k: string | null) => (k ? ((await cfgOf())?.clientSettings[k]?.name ?? k) : null);
  const directory = async () => (ctx.org ? await ctx.org.store.directory().catch(() => []) : []);
  const followUpPromise = async (id: number): Promise<LoopPromise | null> => {
    const f = plan ? await plan.getFollowUp(id) : null;
    if (!f) return null;
    const from = f.sourceKind === "commitment" && f.sourceId ? await loopChatOf(cc, f.sourceId).catch(() => null) : null;
    return { key: `f${f.id}`, kind: "followUp", id: f.id, clientKey: f.clientKey, clientName: await nameOf(f.clientKey), what: f.what, closed: !!f.closedAt, who: f.who, whoRef: f.whoRef, itemId: f.itemId, chat: from?.chat ?? null, conversation: from?.conversation ?? null, myWords: null };
  };
  const member = (p: LoopPromise, ref: PersonRef | null, name: string) => {
    const ms = p.chat?.members ?? [];
    const id = ref?.kind === "cooptimizer" ? ref.id : ref?.kind === "external" ? ref.memberId : null;
    return (id ? ms.find((m) => (m.userId ?? "").toLowerCase() === id.toLowerCase()) : undefined) ?? ms.find((m) => (m.displayName ?? "").trim().toLowerCase() === name.trim().toLowerCase());
  };
  const probe = sendProbe(ctx);
  return {
    plan,
    me: async () => {
      const id = await storedIdentity(plan);
      return { id: (await cc.me()) ?? id?.oid ?? null, name: id?.name ?? null, email: id?.email ?? id?.username ?? null };
    },
    promise: async (key) => {
      const n = Number(key.slice(1));
      if (!Number.isSafeInteger(n) || n <= 0) return null;
      return key.startsWith("c") ? loopChatPromise(cc, n) : followUpPromise(n);
    },
    homeTenant: () => cc.homeTenant(),
    homeDomains: async () => {
      const cfg = await cfgOf();
      return cfg ? inviteDomains(cfg) : [];
    },
    emailOf: async (p, ref, name) => {
      const m = member(p, ref, name);
      if (m?.email) return m.email;
      if (ref?.kind === "cooptimizer") return (await directory()).find((d) => d.personId.toLowerCase() === ref.id.toLowerCase() || d.systemUserId.toLowerCase() === ref.id.toLowerCase())?.email ?? null;
      if (!ref) return (await directory()).find((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase())?.email ?? null;
      return null;
    },
    userIdOf: async (p, ref, name) => {
      // A 1:1 chat only with someone at Cooptimize: their Entra id from the chat, else their work address (Graph binds a user by UPN).
      const home = await cc.homeTenant();
      const m = member(p, ref, name);
      if (m?.userId && home && !m.guest && (m.tenantId ?? "").toLowerCase() === home.toLowerCase()) return m.userId;
      if (ref?.kind === "external") return null;
      const cfg = await cfgOf();
      const dir = ref?.kind === "cooptimizer" || !ref ? await directory() : [];
      const byDir = ref?.kind === "cooptimizer" ? dir.find((d) => d.personId.toLowerCase() === ref.id.toLowerCase()) : dir.find((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase());
      const email = m?.email ?? byDir?.email ?? null;
      return email && cfg && insideDomain(email, inviteDomains(cfg)) ? email : null;
    },
    item: async (clientKey, itemId) => {
      const cfg = await cfgOf();
      if (!cfg) return null;
      const w = ctx.makeDevOps(cfg.dataverse, userZone(cfg)).last(clientKey);
      const hit = w ? [...w.items, ...w.children, ...(w.watched ?? [])].find((i) => i.id === itemId) : undefined;
      return hit ? { id: hit.id, title: hit.title, state: hit.state, type: hit.type } : null;
    },
    canComment: async (clientKey) => !!ctx.devopsWriter && !!ctx.writePats && !!plan && (await plan.devopsIdentities()).some((i) => i.clientKey === clientKey),
    boundary: (clientKey) => boundaryOf(ctx, clientKey),
    ai: () => aiFor(ctx, { waiting: true }),
    sender: async () => (await accountOf(ctx))?.sender ?? null,
    access: probe,
    devops: async (action, input) => devopsWriteAction(await devopsWriteContext(ctx), action, input),
    close: async (p, how, note) => {
      if (p.kind === "followUp") return void (await plan!.closeFollowUp(p.id, note, "me", { how, outcome: "done" }));
      const r = await conversationAction(cc, "my_promises.close", { id: p.id, how, ...(note ? { note } : {}) });
      if (!r.ok) throw new Error(r.error);
    },
    reopen: async (p) => {
      if (p.kind === "followUp") return void (await plan!.reopenFollowUp(p.id));
      const r = await conversationAction(cc, "my_promises.reopen", { id: p.id });
      if (!r.ok) throw new Error(r.error);
    },
    open: async () => {
      const fs = plan ? (await plan.openFollowUps()).map((f) => ({ key: `f${f.id}`, what: f.what, who: f.who, clientKey: f.clientKey })) : [];
      const cs = await loopOpenChatPromises(cc).catch(() => []);
      const all: { key: string; what: string; who: string | null; clientKey: string | null }[] = [...cs, ...fs];
      const out = [];
      for (const x of all) out.push({ ...x, clientName: await nameOf(x.clientKey) });
      return out;
    },
    now: ctx.now,
    log: ctx.log ?? (() => {}),
  };
}

/** AH-1: the write framework's view of Ahead's change set (my rows only, through the plan store's scope). */
function aheadPort(ctx: ActionContext, plan: PlanStore): AheadPort {
  const cc = conversationContext(ctx);
  return {
    staged: async (clientKey, itemId) => (await plan.aheadChanges()).filter((c) => c.clientKey === clientKey && c.itemId === itemId),
    conflict: (clientKey, itemId, field, theirs) => plan.markAheadConflict(clientKey, itemId, field, theirs),
    landed: async (clientKey, itemId, field) => void (await plan.removeAheadChanges(clientKey, itemId, field)),
    setHalf: (clientKey, itemId, field, day, half) => plan.setAheadHalf(clientKey, itemId, field, day, half),
    isLead: async (clientKey) => (await cc).isLead(clientKey),
    automation: async () => (await aheadContext(ctx)).automation(),
    ...(ctx.devopsStored ? { stored: ctx.devopsStored } : {}),
    // AH-5: only Cooptimizers (and their client logins) get FocusTime's quiet assigned note.
    ...(ctx.org ? { isCooptimizer: async (clientKey: string, email: string) => !!(await scopeDepsOf(ctx.org!)(clientKey))?.isCooptimizer(email) } : {}),
  };
}

/** The followed clients with DevOps this week, as Roadmap and Ahead read them. */
async function aheadClients(ctx: ActionContext, cfg: AppConfig, weekStart: string, refresh: boolean) {
  const today = localToday(ctx.now(), userZone(cfg));
  const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).load(weekStart, refresh ? { refresh } : {}).catch(() => null) : null;
  return (await devopsClients(ctx, cfg, weekStart, today, refresh ? { refresh } : {}, dv?.items ?? [])).fetch;
}

/** AH-1: who I am to the org runtime: lead per client, an automation account, whom I may assign. */
async function aheadContext(ctx: ActionContext): Promise<AheadContext> {
  const cc = await conversationContext(ctx);
  const people = async () => {
    if (!ctx.org) return null;
    const [lv, directory, peopleClients, users] = await Promise.all([ctx.org.levels(), ctx.org.store.directory(), ctx.org.store.peopleClients(), cc.users().catch(() => [])]);
    return { lv, picker: pickerPeopleOf({ levels: lv, directory, peopleClients, users }) };
  };
  return {
    plan: ctx.plan,
    config: () => configured(ctx),
    clients: (cfg, weekStart, refresh) => aheadClients(ctx, cfg, weekStart, refresh),
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    isLead: cc.isLead,
    automation: async () => {
      const id = await cc.me();
      const p = id ? await people().catch(() => null) : null;
      return !!p && p.lv.people.entry(id)?.notCooptimizer === "automation";
    },
    canWrite: async (clientKey) => !!ctx.devopsWriter && !!ctx.writePats && !!(await ctx.plan?.devopsIdentity(clientKey).catch(() => null)),
    assignable: async (clientKey, email) => {
      const mine = (await ctx.plan?.devopsIdentities().catch(() => []))?.find((i) => i.clientKey === clientKey)?.email ?? null;
      if (mine && mine.toLowerCase() === email.toLowerCase()) return true;
      const p = await people().catch(() => null);
      if (!p) return false;
      if (p.picker.workers(clientKey).some((w) => w.email?.toLowerCase() === email.toLowerCase())) return true;
      // AH-3: a worker's linked client login on this client is them too.
      const ix = ctx.org ? await ctx.org.identities().catch(() => null) : null;
      const who = ix?.personOf(clientKey, email);
      return !!who && p.picker.workers(clientKey).some((w) => !!w.email && ix!.personOf(clientKey, w.email)?.id === who.id);
    },
    // AH-5: the client's Cooptimizers, who counts as one, and my name, for the assignee dropdown.
    people: async (clientKey) => {
      const [p, meId, isCoop] = await Promise.all([people().catch(() => null), cc.me().catch(() => null), ctx.org ? scopeDepsOf(ctx.org)(clientKey).then((x) => x?.isCooptimizer ?? null).catch(() => null) : Promise.resolve(null)]);
      const workers = p ? p.picker.workers(clientKey).flatMap((w) => (w.email ? [{ email: w.email, name: w.name }] : [])) : [];
      const myName = (meId && p?.picker.cooptimizers.find((x) => x.id === meId)?.name) || null;
      return { cooptimizers: workers, isCooptimizer: isCoop ?? ((e: string) => workers.some((w) => w.email.toLowerCase() === e.toLowerCase())), myName };
    },
    identities: async () => {
      if (!ctx.org) throw new Error("no org runtime");
      const [ix, meId, writes] = await Promise.all([ctx.org.identities(), cc.me(), ctx.plan?.devopsIdentities().catch(() => []) ?? Promise.resolve([])]);
      return aheadIdentities(ix, meId, (k) => writes.filter((w) => w.clientKey === k).map((w) => w.email));
    },
    now: ctx.now,
    fixRules: async () => {
      const r = ctx.org ? await ctx.org.rules() : null;
      return { topN: r?.ahead.fixTopN ?? TOP_N, gaps: (k) => (r ? clientRules(r, k).fixGaps : [...GAP_KINDS]) };
    },
  };
}

/** Quick capture: the plan store, and a client's open features and epics (read-only DevOps). */
function captureContext(ctx: ActionContext): CaptureContext {
  return {
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
  };
}

/** CP-1: a captured draft's AI version: reads with the company read PAT, AI through ai/ on my own cap. */
/** KB-1: the standards lookup a draft path takes: the client's data platform and source systems come from its Rules. */
function standardsOption(ctx: ActionContext): { standards?: StandardsLookup } {
  const standards = standardsLookup(ctx.standards, async (clientKey) => {
    const rule = (await ctx.org?.rules())?.clients[clientKey];
    return rule ? { dataPlatform: rule.dataPlatform, sourceSystems: rule.sourceSystems } : null;
  });
  return standards ? { standards } : {};
}

function prepareContext(ctx: ActionContext): PrepareContext {
  const cap = captureContext(ctx);
  return {
    plan: ctx.plan,
    config: () => configured(ctx),
    ai: () => aiFor(ctx),
    writeClients: async () => (ctx.plan && ctx.devopsWriter && ctx.writePats ? (await ctx.plan.devopsIdentities()).map((i) => i.clientKey) : []),
    features: (cfg, key) => featuresOf(cap, cfg, key),
    isInternal: (key) => isInternalKey(ctx.org, key),
    model: async (cfg, key) => {
      const r = (await ctx.makeDevOps(cfg.dataverse, userZone(cfg)).processModels([key]))[0];
      return r?.ok ? r.model : null;
    },
    pool: async (cfg, key) => {
      const r = await ctx.makeDevOps(cfg.dataverse, userZone(cfg)).exemplarPool(key, { months: cfg.ai.draftMonths ?? DEFAULT_DRAFT_MONTHS });
      return r.ok ? r.value : null;
    },
    now: ctx.now,
    ...standardsOption(ctx),
  };
}

/** DS-1: Draft stories: reads through the DevOps source (read PAT), AI through ai/, writes through the write framework. */
/** FN-1: the story card's read: the clients this person can see (followed this week, theirs in Dataverse) and write to. */
function itemCardContext(ctx: ActionContext): ItemCardContext {
  return {
    plan: ctx.plan,
    config: () => configured(ctx),
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    clients: async (cfg) => {
      const today = localToday(ctx.now(), userZone(cfg));
      const dvs = ctx.makeDataverse(cfg.dataverse, userZone(cfg));
      const [week, mine] = await Promise.all([aheadClients(ctx, cfg, mondayOf(today), false).catch(() => [] as ClientRef[]), dvs.myClients?.().catch(() => null) ?? Promise.resolve(null)]);
      const out = new Map(week.map((c) => [c.clientKey, c] as const));
      for (const c of mine ?? []) if (!out.has(c.clientKey)) out.set(c.clientKey, { clientKey: c.clientKey, clientName: c.clientName });
      return [...out.values()];
    },
    writeClients: async () => (ctx.plan && ctx.devopsWriter && ctx.writePats ? (await ctx.plan.devopsIdentities()).map((i) => i.clientKey) : []),
    scope: ctx.plan ?? ctx,
    now: ctx.now,
  };
}

/** FN-1: Wrap it up, on the write framework's own actions. */
function wrapUpContext(ctx: ActionContext): WrapUpContext {
  return {
    plan: ctx.plan,
    config: () => configured(ctx),
    devopsWrite: async (action, input) => devopsWriteAction(await devopsWriteContext(ctx), action, input),
    ai: () => aiFor(ctx),
    forget: forgetCard,
    now: ctx.now,
    ...standardsOption(ctx),
  };
}

export function storyContext(ctx: ActionContext): StoryContext {
  return {
    plan: ctx.plan,
    config: () => configured(ctx),
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    ai: () => aiFor(ctx),
    aiApp: ctx.ai?.app ?? null,
    writeClients: async () => (ctx.plan && ctx.devopsWriter && ctx.writePats ? (await ctx.plan.devopsIdentities()).map((i) => i.clientKey) : []),
    devopsWrite: async (action, input) => devopsWriteAction(await devopsWriteContext(ctx), action, input),
    now: ctx.now,
    isInternal: (clientKey) => isInternalKey(ctx.org, clientKey),
    ...standardsOption(ctx),
  };
}

/** CV-1: what a confirmed DevOps write settles in Conversations (my view only; status from facts, D-CV). */
async function conversationsPortFor(ctx: ActionContext, port: RequestsPort): Promise<ConversationsPort | undefined> {
  const store = port.conversations;
  const me = await (await chatContext(ctx)).me();
  if (!store || !me) return undefined;
  const view = store.viewer(me);
  const deps = async () => ({ convs: store, teams: port.teams, homeTenant: (await (await chatContext(ctx)).homeTenant()) ?? null });
  return {
    me,
    view,
    created: async (conv, item) => {
      // CV-5: a promise with its item stays open and actionable (due, who, done); the item is linked to it.
      if (conv.commitmentId !== null) await view.updateCommitment(conv.commitmentId, { itemId: item.id, itemUrl: item.url, itemTitle: item.title });
      await view.updateConversation(conv.conversationId, { item: { id: item.id, url: item.url, title: item.title }, changeNote: `Tracked as #${item.id}` }, { bump: true });
      await refreshStatus(await deps(), conv.conversationId);
    },
    uncreated: async (conv, itemId) => {
      const c = await view.conversation(conv.conversationId);
      if (c?.itemId === itemId) await view.updateConversation(c.id, { item: null, changeNote: `#${itemId} was removed` }, { bump: true });
      if (conv.commitmentId !== null) {
        const k = await view.commitment(conv.commitmentId);
        if ((k?.state === "created" || k?.state === "open") && k.itemId === itemId) await view.updateCommitment(k.id, { state: "open", itemId: null, itemUrl: null, itemTitle: null });
      }
      await refreshStatus(await deps(), conv.conversationId);
    },
    posted: async (suggestionId, writeId) => {
      const sg = await view.suggestion(suggestionId);
      if (sg?.state === "open") await view.settleSuggestion(suggestionId, "posted", writeId);
    },
  };
}

/** The Requests a DevOps create comes from: the shared store, who I am, and whether I see a chat. */
async function sharedFor(ctx: ActionContext, port: RequestsPort) {
  const c = await chatContext(ctx);
  const me = await c.me();
  if (!me) return undefined;
  const teams = port.teams.viewer(me);
  return { teams, sees: async (chatId: string) => (await visibleChats(teams, await c.clientKeys().catch(() => null))).some((x) => x.chatId === chatId) };
}

/** Requests: the shared store and Refresh, who I am and my clients, their open DevOps items and write access. */
/**
 * MC-1: what the meeting job needs from one person, built from their own context: their Graph meetings client (behind
 * the registered-meeting gate), their AI on the app's background tier (Flex, AI-F1; the person's switches and caps),
 * and the client's capture context. Null when their settings can't be read.
 */
export async function meetingPerson(ctx: ActionContext): Promise<{ graph: import("../sources/graph/meetings.ts").MeetingsClient | null; ai: () => Promise<AiService | null>; capture: (clientKey: string) => Promise<MeetingCaptureContext | null> } | null> {
  const cfg = await configured(ctx);
  if (!cfg) return null;
  return { graph: ctx.account?.(cfg)?.meetings ?? null, ai: () => aiFor(ctx), capture: (k) => meetingCapture(ctx, cfg, k) };
}

/** MC-1: a registered call as the pseudo chat its shared commitments belong to (`meeting:<series id>`; no link, never polled). */
export function meetingChatsOf(series: readonly MeetingSeries[]): ClientChat[] {
  return series.map((s) => ({
    chatId: `${MEETING_CHAT}${s.id}`, clientKey: s.clientKey, kind: "delivery", displayName: s.name, webUrl: null, position: 0, members: null, membersFetchedAt: null,
    registeredBy: s.registrantId, registeredAt: s.createdAt, readOn: false, readSince: s.createdAt, seenAt: null, polledAt: null, fetchedAt: null, retryAt: null, failures: 0, pollState: null, pollNote: null, tokenUser: null,
  }));
}

/** MC-1: the meeting store and the FocusTime users (id, name, every address that is them) for registration. */
export type MeetingsPort = {
  store: MeetingStore;
  users: () => Promise<MeetingUser[]>;
  /** ENV-1: Check now: one look for one registered call's transcript with this person's sign-in (absent: not here). */
  checkNow?: (seriesId: number, userId: string) => Promise<CheckNowResult>;
};

/**
 * MC-1: one client's AI pass context: its name, whether it is Cooptimize Internal (GD-1), its open DevOps items in
 * scope (what was read last, else this client alone), its process and the guard's directory. Null when DevOps
 * couldn't be read for it.
 */
export async function meetingCapture(ctx: ActionContext, cfg: AppConfig, clientKey: string): Promise<MeetingCaptureContext | null> {
  const rc = await requestContext(ctx);
  const items = await rc.openItems(cfg, clientKey);
  if (!items) return null;
  const internal = await isInternalKey(ctx.org, clientKey);
  const model = (await ctx.makeDevOps(cfg.dataverse, userZone(cfg)).processModels([clientKey]).catch(() => []))[0];
  return { clientName: cfg.clientSettings[clientKey]?.name ?? clientKey, internal, items, model: model?.ok ? model.model : null, directory: await aiDirectory(ctx, cfg) };
}

/**
 * MC-1: the meeting actions' context. The person's own Graph meetings client (behind the registered-meeting gate), AI
 * (an upload or Propose again is a button a person waits on: standard; the poll job's passes use Flex, AI-F1), and
 * the DevOps writes exactly as the app's buttons call them.
 */
export async function meetingContext(ctx: ActionContext): Promise<MeetingContext> {
  const rc = await requestContext(ctx);
  return {
    meetings: ctx.meetings?.store,
    conversations: ctx.requests?.conversations,
    plan: ctx.plan,
    me: rc.me,
    isAdmin: () => amAdmin(ctx),
    config: () => configured(ctx),
    now: ctx.now,
    homeDomains: async () => {
      const cfg = await configured(ctx);
      return cfg ? inviteDomains(cfg) : [];
    },
    graph: (cfg) => ctx.account?.(cfg)?.meetings ?? null,
    users: async () => (ctx.meetings ? ctx.meetings.users() : []),
    ...(ctx.meetings?.checkNow ? { checkNow: ctx.meetings.checkNow } : {}),
    // MC-1c: the organization's clients (Admin › Clients' clientAccounts()), never the admin's own settings; keys match
    // case-insensitively and come back as the organization's. It fails closed: with the team runtime, a list that can't
    // be read is "unavailable", never the admin's settings. Only without one (no team runtime) the configured clients.
    client: async (clientKey) => {
      const want = clientKey.trim().toLowerCase();
      if (!want) return null;
      if (ctx.org) {
        const ca = await ctx.org.clientAccounts().catch(() => null);
        if (!ca) return "unavailable";
        const key = ca.row(clientKey.trim())?.clientKey ?? ca.keys.find((k) => k.toLowerCase() === want) ?? null;
        return key && ca.isClient(key) ? { key, name: key } : null;
      }
      const cfg = await configured(ctx);
      const key = Object.keys(cfg?.clientSettings ?? {}).find((k) => k.toLowerCase() === want) ?? null;
      return key ? { key, name: key } : null;
    },
    leads: async (clientKey) => ((await ctx.org?.clientLeads(clientKey).catch(() => [])) ?? []).map((l) => l.personId),
    capture: (cfg, clientKey) => meetingCapture(ctx, cfg, clientKey),
    ai: () => aiFor(ctx, { waiting: true }),
    devops: (action, input) => dispatch(ctx, { action, input }),
    canWrite: async (clientKey) => (await rc.writeClients()).includes(clientKey),
    log: ctx.log ?? (() => {}),
  };
}

export async function requestContext(ctx: ActionContext): Promise<RequestContext> {
  const chats = await chatContext(ctx);
  return {
    ...(ctx.plan ? { plan: ctx.plan } : {}),
    ...(ctx.requests ? { requests: ctx.requests } : {}),
    me: chats.me,
    followed: chats.clientKeys,
    config: () => configured(ctx),
    homeTenant: chats.homeTenant,
    openItems: async (cfg, clientKey) => {
      const src = ctx.makeDevOps(cfg.dataverse, userZone(cfg));
      // What was read last (Week, Plan the week) when there is one; else this client alone.
      const r = src.last(clientKey) ?? (await src.load([{ clientKey, clientName: cfg.clientSettings[clientKey]?.name ?? clientKey }]).catch(() => null))?.[0] ?? null;
      if (!r || (r.status !== "ok" && !r.items.length)) return null;
      const seen = new Set<number>();
      return [...r.items, ...r.children].filter((i) => !isClosed(i.stateCategory) && !seen.has(i.id) && !!seen.add(i.id));
    },
    writeClients: async () => (ctx.plan && ctx.devopsWriter && ctx.writePats ? (await ctx.plan.devopsIdentities()).map((i) => i.clientKey) : []),
    now: ctx.now,
    log: ctx.log ?? (() => {}),
    // AP-2: the AI service (its switches, guards, budget and log), and a linked item's done state from the last read.
    // AI-F1: only Sort again uses it, a button a person waits on: standard, never Flex.
    ai: () => aiFor(ctx, { waiting: true }),
    itemDone: (cfg, clientKey, itemId) => {
      const w = ctx.makeDevOps(cfg.dataverse, userZone(cfg)).last(clientKey);
      const hit = w ? [...w.items, ...w.children, ...(w.watched ?? [])].find((i) => i.id === itemId) : undefined;
      return hit ? isCompleted(hit.stateCategory) : null;
    },
    chatMessages: async () => (await accountOf(ctx))?.chatMessages ?? null,
    // GD-2: the client boundary (Internal, the other clients' names and aliases) and the Cooptimizer rule for a chat's audience.
    boundary: (clientKey) => boundaryOf(ctx, clientKey),
    audienceRules: async () => audienceRulesOf(ctx.org, await chats.homeTenant()),
    ...standardsOption(ctx),
  };
}

/** CV-2: the PersonPicker's people: the conversation's, the client's Account Workers, everyone at Cooptimize. */
async function pickerAction(ctx: ActionContext, input: unknown): Promise<ActionResponse> {
  const o = input === undefined || input === null ? {} : input;
  if (typeof o !== "object" || Array.isArray(o)) return { ok: false, status: 400, error: "people.picker takes { clientKey?, conversationId?, commitmentId? }" };
  const r = o as Record<string, unknown>;
  const id = (v: unknown) => (v === undefined ? undefined : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : NaN);
  const conversationId = id(r.conversationId);
  const commitmentId = id(r.commitmentId);
  const clientKey = r.clientKey === undefined || r.clientKey === null ? null : typeof r.clientKey === "string" && r.clientKey.length <= 100 ? r.clientKey : undefined;
  if (Object.keys(r).some((k) => !["clientKey", "conversationId", "commitmentId"].includes(k)) || Number.isNaN(conversationId) || Number.isNaN(commitmentId) || clientKey === undefined)
    return { ok: false, status: 400, error: "people.picker takes { clientKey?, conversationId?, commitmentId? }" };
  const cc = await conversationContext(ctx);
  const data = await peoplePicker(
    {
      me: cc.me,
      people: async () => {
        if (!ctx.org) return null;
        const [lv, directory, peopleClients, users] = await Promise.all([ctx.org.levels(), ctx.org.store.directory(), ctx.org.store.peopleClients(), cc.users().catch(() => [])]);
        return pickerPeopleOf({ levels: lv, directory, peopleClients, users });
      },
      conversation: (q) => conversationPeople(cc, q),
      clientName: async (k) => (await configured(ctx))?.clientSettings[k]?.name ?? k,
    },
    { clientKey, ...(conversationId ? { conversationId } : {}), ...(commitmentId ? { commitmentId } : {}) },
  );
  return { ok: true, data };
}

/** CV-2: one chat image for FocusTime's own endpoint (server/app.ts), with the member and client checks. */
export async function chatImage(ctx: ActionContext, id: number): Promise<ServedImage> {
  return serveChatImage(await requestContext(ctx), id);
}

/** CV-1: Conversations and My promises: the Requests pieces, the conversation store, client leads, the pipeline's AI. */
export async function conversationContext(ctx: ActionContext): Promise<ConversationContext> {
  const rc = await requestContext(ctx);
  const port = ctx.requests;
  return {
    ...rc,
    ...(port?.conversations ? { conversations: port.conversations } : {}),
    isLead: async (clientKey) => isClientLead(ctx.org, await rc.me(), clientKey),
    // MC-1: the registered calls I review or attend, as the chats my promises and Waiting on from a call belong to.
    ...(ctx.meetings ? { meetingChats: async () => meetingChatsOf(await ctx.meetings!.store.viewer((await rc.me()) ?? "").series().catch(() => [])) } : {}),
    isAdmin: () => amAdmin(ctx),
    users: async () => (port?.users ? port.users() : []),
    // AI-F1: Sort unsorted, a button a person waits on: the pipeline's cap, on standard (the poll's own runs use Flex).
    pipelineAi: () => aiFor(ctx, { cap: "app", waiting: true }),
    devopsEmail: async (clientKey) => (await ctx.plan?.devopsIdentities().catch(() => []))?.find((i) => i.clientKey === clientKey)?.email ?? null,
    processModel: async (cfg, clientKey) => {
      const r = (await ctx.makeDevOps(cfg.dataverse, userZone(cfg)).processModels([clientKey]))[0];
      return r?.ok ? r.model : null;
    },
    // CV-5: Link to item's pool (the client's open items in scope, from the central store) and a link's live state.
    searchItems: async (cfg, clientKey, query) => {
      const src = ctx.makeDevOps(cfg.dataverse, userZone(cfg));
      if (!src.searchItems) return null;
      const me = ((await ctx.plan?.devopsIdentities().catch(() => []))?.find((i) => i.clientKey === clientKey)?.email ?? "").toLowerCase();
      const hits = await src.searchItems({ clientKey, clientName: cfg.clientSettings[clientKey]?.name ?? clientKey }, query, query ? 20 : 500);
      return hits ? hits.map((i) => aheadAsWork(i, me)) : null;
    },
    linkedItems: async (cfg, clientKey, ids) => {
      const src = ctx.makeDevOps(cfg.dataverse, userZone(cfg));
      return src.linkedItems ? src.linkedItems({ clientKey, clientName: cfg.clientSettings[clientKey]?.name ?? clientKey }, ids) : null;
    },
  };
}

/** CV-5: an Ahead row as the work item Link to item and "Looks like" rank (never an email shown, only matched). */
function aheadAsWork(i: import("./types.ts").AheadItem, me: string): WorkItem {
  const email = i.assignee?.email?.toLowerCase() ?? null;
  return {
    id: i.id, title: i.title, type: i.type, state: i.state, stateCategory: i.stateCategory,
    level: i.level === "top" || i.level === "parent" ? "portfolio" : i.level === null ? "other" : "story",
    ...(i.level === "parent" ? { tier: "feature" as const } : i.level === "top" ? { tier: "epic" as const } : {}),
    order: i.order ?? null, parentId: i.parentId, changedAt: i.changedAt, url: i.url,
    assignedTo: i.assignee?.name ?? null, assignedToEmail: email, assignedToMe: !!me && email === me,
  };
}

/** CV-1: a person's hours and PTO days for the next 3 weeks (escalation waits one of their working days). */
export async function escalationHours(ctx: ActionContext): Promise<{ hours: TimeModel; ptoDays: ReadonlySet<string> } | null> {
  const cfg = await configured(ctx);
  if (!cfg) return null;
  const zone = userZone(cfg);
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(zone).toPlainDate();
  const monday = today.subtract({ days: today.dayOfWeek - 1 }).toString();
  const pto = await ptoAheadOf(ctx, cfg, monday).catch(() => new Set<string>());
  return { hours: { ...cfg.week.hours, timeZone: zone }, ptoDays: pto };
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

/** TX-1: the check-in's answers (local only). */
const progressContext = (ctx: ActionContext): ProgressContext => ({
  plan: ctx.plan,
  config: () => configured(ctx),
  now: ctx.now,
  resolved: (cfg, items) => resolvedKeys(ctx.makeDevOps(cfg.dataverse, userZone(cfg)), [...new Set(items.map((i) => i.clientKey))].map((clientKey) => ({ clientKey, clientName: clientKey })), idsByClient(items)),
});

export async function dispatch(ctx: ActionContext, req: ActionRequest): Promise<ActionResponse> {
  const r = await dispatchAction(ctx, req);
  const after = req.action === "pick.add" || req.action === "pick.move" ? await afterPick(ctx, req.action, req.input, r) : r;
  const changed = req.action === "weekplan.place" || req.action === "pick.add" ? await afterPlanChange(ctx, req.action, req.input, after) : after;
  if (req.action === "week.load") return publishOnce(ctx, changed);
  return typeof req.action === "string" && WEEK_CHANGES.has(req.action) ? publishAfter(ctx, req.input, changed) : changed;
}

/** The marker of a week published once on load (CF-1): weeks planned before CF-1 (confirmed or not) reach teammates. */
export const PUBLISHED_ON_LOAD = "cf1_published";

/**
 * CF-1 review: a week planned before CF-1 was published only on Confirm, so after the deploy Team and the status report
 * would show it empty or stale until the person's next change. The first week.load publishes this week and next once
 * (a marker per week); every change after that publishes as it happens.
 */
async function publishOnce(ctx: ActionContext, r: ActionResponse): Promise<ActionResponse> {
  if (!r.ok || !ctx.team || !ctx.plan) return r;
  try {
    const cfg = await configured(ctx);
    const thisWeek = mondayOf(localToday(ctx.now(), cfg ? userZone(cfg) : "UTC"));
    for (const w of [thisWeek, Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString()]) if (await ctx.plan.markOnce(PUBLISHED_ON_LOAD, w)) await publishWeek(teamCtx(ctx), w);
  } catch {
    // Nothing is lost: the next change publishes.
  }
  return r;
}

/**
 * CF-1 (D1): the actions that can change which features are on a week. After one succeeds, the weeks it touched are
 * published for teammates and the status report at once (publishWeek), never a past week. Was: on Confirm week.
 */
export const WEEK_CHANGES = new Set<string>([
  "pick.add", "pick.move", "pick.remove", "pick.take_off", "pick.put_back", "weekplan.add", "weekplan.remove", "weekplan.place", "weekplan.load",
  "weekplan.carry_decide", "weekplan.carry_accept_all", "weekplan.watch_checkin", "weekplan.watch_remove",
  "send.accept", "priority.add_to_week", "weekplan.set_feature",
]);

/** The Mondays an action's input or answer names (a week, a date, a to-do's day, a week list row's week). */
export function weeksTouched(input: unknown, data: unknown): IsoDate[] {
  const out = new Set<IsoDate>();
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? out.add(mondayOf(v)) : undefined);
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  day(o.weekStart);
  day(o.date);
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  for (const k of ["pick", "item", "feature", "plan", "state", "send"]) {
    const x = d[k] as Record<string, unknown> | null | undefined;
    if (x && typeof x === "object") {
      day(x.weekStart);
      day(x.date);
    }
  }
  return [...out];
}

async function publishAfter(ctx: ActionContext, input: unknown, r: ActionResponse): Promise<ActionResponse> {
  if (!r.ok || !ctx.team || !ctx.plan) return r;
  try {
    const cfg = await configured(ctx);
    const thisWeek = mondayOf(localToday(ctx.now(), cfg ? userZone(cfg) : "UTC"));
    // pick.move and pick.remove answer with the day the to-do left (`state`), so the week it left is published too.
    for (const w of weeksTouched(input, r.data)) if (w >= thisWeek) await publishWeek(teamCtx(ctx), w);
  } catch {
    // The plan change stands; the next change publishes again.
  }
  return r;
}

/**
 * WD-1: a to-do placed on a block (or moved into another week) puts its feature on that week when it isn't there
 * (placeFeature). The to-do stands whatever happens here. CF-1: the week is no longer touched (there is no
 * "Changed since you confirmed"); the add's answer carries the feature it put on the week, for Undo.
 */
async function afterPick(ctx: ActionContext, action: string, input: unknown, r: ActionResponse): Promise<ActionResponse> {
  if (!r.ok || !ctx.plan) return r;
  try {
    const pick = (r.data as { pick?: { date: string; clientKey: string; itemId: number | null; draftId: number | null } } | undefined)?.pick;
    if (!pick) return r;
    const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
    if (action === "pick.move" && typeof o.date !== "string") return r;
    const weekStart = mondayOf(pick.date);
    const draft = pick.draftId !== null ? await ctx.plan.getDraft(pick.draftId) : null;
    let feature: { id: number } | null = null;
    if (pick.itemId !== null) feature = await placeFeature(weekCtx(ctx), { date: pick.date, clientKey: pick.clientKey, itemId: pick.itemId });
    else if (draft?.parentItemId != null) feature = await placeFeature(weekCtx(ctx), { date: pick.date, clientKey: pick.clientKey, featureId: draft.parentItemId });
    // What Undo (pick.remove with `undo`) takes back: the feature this add put on the week.
    if (action === "pick.add" && feature) return { ...r, data: { ...(r.data as object), undo: { weekStart, featureId: feature.id } } };
  } catch {
    // The to-do stands; the feature can still be added from the panel.
  }
  return r;
}

async function dispatchAction(ctx: ActionContext, req: ActionRequest): Promise<ActionResponse> {
  // Only registered actions (actions/registry.ts). The switch below is exhaustive over them: an action added
  // to the registry without a case, or a case for a name not in the registry, fails the type check.
  if (!isActionName(req.action)) return bad("unknown action");
  const action: ActionName = req.action;
  // Step 15.4: "me" comes from the Microsoft sign-in (config's my_email stays the fallback). Settings writes the file as
  // is (raw), but shows "me" and finds the Dataverse user the same way as every other action (settingsCtx below): it
  // once read the raw file only, so a person whose Dataverse user was kept with their sign-in saw no clients (A5 fix).
  // ADM-2: clients only, everywhere a person's clients are listed (actions/client-accounts.ts).
  ctx = onlyClients(ctx);
  const raw = ctx;
  if (action !== "settings.load" && action !== "settings.save") ctx = withSignedIn(ctx);
  if (ctx.demo?.on && DEMO_REFUSED.includes(action)) return { ok: false, status: 403, error: DEMO_REFUSAL, code: "demo" };
  switch (action) {
    case "demo.reset": {
      // DM-1: Reset demo, only in a demo session (the host rebuilds its in-memory data from the seeds).
      if (!noInput(req.input)) return bad("demo.reset takes no input");
      if (!ctx.demo?.on || !ctx.demo.reset) return { ok: false, status: 403, error: "Reset demo is only in the demo" };
      const started = Date.now();
      await ctx.demo.reset();
      return { ok: true, data: { reset: true, ms: Date.now() - started } };
    }
    case "demo.devops_change": {
      // DV-2: only in a demo session: a teammate changes or adds an item in the session's own fictional DevOps.
      if (!ctx.demo?.on || !ctx.demo.devopsChange) return { ok: false, status: 403, error: "Only in the demo" };
      const i = req.input as Record<string, unknown> | null;
      if (!i || typeof i !== "object" || typeof i.clientKey !== "string" || typeof i.change !== "object" || i.change === null) return bad("demo.devops_change takes { clientKey, change }");
      const r = ctx.demo.devopsChange(i.clientKey, i.change);
      return r.ok ? { ok: true, data: { id: r.id } } : bad(r.error);
    }
    case "demo.status": {
      if (!noInput(req.input)) return bad("demo.status takes no input");
      if (!ctx.demo?.on || !ctx.demo.status) return { ok: false, status: 403, error: "Only in the demo" };
      return { ok: true, data: ctx.demo.status() };
    }
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
          ...(ctx.linkCalendars ? { links: ctx.linkCalendars } : {}),
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
    case "devops.progress_offer":
    case "devops.done_offer":
    case "devops.undo_offer":
    case "devops.wrap_offer":
      return devopsWriteAction(await devopsWriteContext(ctx), action, req.input);
    case "item.card":
      return itemCardAction(itemCardContext(ctx), action, req.input);
    case "wrapup.offer":
    case "wrapup.tick":
    case "wrapup.preview":
    case "wrapup.confirm":
    case "wrapup.apply":
    case "wrapup.suggest":
      return wrapUpAction(wrapUpContext(ctx), action, req.input);
    case "stories.status":
    case "stories.prepare":
    case "stories.run":
    case "stories.regenerate":
    case "stories.save":
    case "stories.publish_preview":
    case "stories.publish":
    case "stories.retry":
    case "stories.house_style":
    case "stories.house_style_save":
      return storyAction(storyContext(ctx), action, req.input);
    case "auth.status":
    case "auth.sign_in":
    case "auth.sign_out":
      return accountAction({ ...(ctx.plan ? { plan: ctx.plan } : {}), account: await accountOf(ctx), now: ctx.now, clearPhotos: () => clearPhotos(ctx.photoCache ?? null), renameNote: ctx.renameNote ?? null }, action, req.input);
    case "vm.find":
    case "vm.choose":
    case "vm.status":
    case "vm.preview":
    case "vm.confirm":
    case "vm.dismiss_prompt":
    case "vm.log":
    case "vm.start_now":
      return vmAction(await vmContext(ctx), action, req.input);
    case "feedback.status":
    case "feedback.preview":
    case "feedback.send": {
      if (!ctx.feedback) return { ok: false, status: 503, error: "Feedback isn't available here" };
      const fb = ctx.feedback;
      const backend =
        fb.demo ??
        devopsFeedbackBackend({
          write: await devopsWriteContext(ctx),
          target: fb.target ?? (async () => null),
          clients: async () => {
            const ca = await clientsOf(ctx.org);
            return { keys: ca?.keys ?? [], internal: ca?.rows.find((r) => r.why === "internal")?.clientKey ?? INTERNAL_CLIENT };
          },
          env: ctx.env ?? "local",
        });
      const f: FeedbackContext = { backend, sender: fb.sender, plan: ctx.plan, today: async () => localToday(ctx.now(), userZone(await configured(ctx))) };
      return feedbackAction(f, action, req.input, () => Date.parse(ctx.now()));
    }
    case "notify.test": {
      if (!noInput(req.input)) return bad("notify.test takes no input");
      if (!ctx.notifications) return { ok: false, status: 503, error: "Notifications aren't available here" };
      await ctx.notifications.test();
      return { ok: true, data: { sent: true } };
    }
    case "teams.status": {
      // TB-2: Settings › Notifications › In Teams: is the bot here, has it a chat with me, did Teams refuse it.
      if (!noInput(req.input)) return bad("teams.status takes no input");
      if (!ctx.teams) return { ok: true, data: { available: false, chat: false, blocked: false } };
      return { ok: true, data: { available: true, ...(await ctx.teams.status()) } };
    }
    case "teams.test": {
      const i = req.input as { kind?: unknown } | null;
      if (!i || typeof i !== "object" || Object.keys(i).some((k) => k !== "kind") || !(TEAMS_KINDS as readonly unknown[]).includes(i.kind)) return bad("teams.test takes { kind: brief, checkin, closeout, nudges, status or meetings }");
      if (!ctx.teams) return { ok: false, status: 503, error: "FocusTime in Teams isn't set up here" };
      const r = await ctx.teams.test(i.kind as TeamsKind);
      return r.ok ? { ok: true, data: { sent: i.kind } } : { ok: false, status: 409, error: r.message };
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
    case "calendar_link.list":
    case "calendar_link.preview":
    case "calendar_link.add":
    case "calendar_link.update":
    case "calendar_link.replace":
    case "calendar_link.remove":
      return calendarLinkAction(ctx.linkCalendars, action, req.input);
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
          today: () => localToday(ctx.now(), "UTC"),
        },
        action,
        req.input ?? {},
      );
    }
    case "docs.access":
      // DOC-1: whether this account may open the Technical docs (not an automation account; actions/docs-actions.ts).
      return docsAccessAction({ automation: async () => (await aheadContext(ctx)).automation() }, req.input);
    case "guide.checklist":
      // UI-5: read only, states and counts only (actions/guide-actions.ts).
      return guideAction(
        {
          demo: !!ctx.demo?.on,
          facts: async () => {
            const plan = ctx.plan;
            if (!plan) return null;
            const cfg = await configured(ctx);
            const today = localToday(ctx.now(), cfg ? userZone(cfg) : "UTC");
            const mon = mondayOf(today);
            const next = Temporal.PlainDate.from(mon).add({ days: 7 }).toString();
            const [setup, ids, push, weeks, todayWork] = await Promise.all([
              plan.setupState(),
              plan.devopsIdentities(),
              ctx.push?.status().catch(() => null) ?? Promise.resolve(null),
              plan.weeksWithWork([mon, next]),
              plan.dayHasWork(today),
            ]);
            return {
              setup,
              writeClients: ids.length,
              devices: push?.devices.length ?? 0,
              teamsMessages: !!cfg?.notify.teamsMessages,
              weekPlanned: weeks.size > 0,
              todayPlanned: todayWork,
            };
          },
        },
        req.input,
      );
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
    case "ui.set_show_timelines": {
      // WK-2: the Board's Timeline toggle (its header button, B, Week's ⋯ and the command). Saved in [ui] show_timelines,
      // the key U3 left read and ignored, so an older build reads it without complaint.
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "show") || typeof i.show !== "boolean") return bad("input must be { show: boolean }");
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => setValue(text, "ui", "show_timelines", i.show as boolean, "Display (WK-2): the hour rail beside each card's to-dos on Week's Board."));
      if (!r.ok) return { ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` };
      return { ok: true, data: { ui: r.parsed.config.ui } };
    }
    case "ui.set_today_timeline": {
      // TY-1: Today's Timeline switch, one for a computer and one for the phone. An older build skips the keys (BH-1).
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || Object.keys(i).some((k) => k !== "show" && k !== "phone") || typeof i.show !== "boolean" || (i.phone !== undefined && typeof i.phone !== "boolean")) return bad("input must be { show: boolean, phone?: boolean }");
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => setValue(text, "ui", i.phone ? "today_timeline_phone" : "today_timeline", i.show as boolean, "Display (TY-1): the Timeline switch on Today."));
      if (!r.ok) return { ok: false, status: 409, error: `Fix the config first: ${r.parsed.ok ? "" : r.parsed.errors.map((e) => `${e.field} ${e.message}`).join("; ")}` };
      return { ok: true, data: { ui: r.parsed.config.ui } };
    }
    case "ui.set_inbox": {
      // IB-1: the Inbox's view, clients and grouping, remembered per person ([ui] inbox_view, inbox_clients, inbox_group).
      const i = req.input as Record<string, unknown> | null;
      if (typeof i !== "object" || i === null || Array.isArray(i) || !Object.keys(i).length || Object.keys(i).some((k) => !["view", "clients", "group", "sort", "statuses", "grouping"].includes(k))) return bad("input must be { view?, clients?, group?, sort?, statuses?, grouping? }");
      if (i.view !== undefined && !(INBOX_VIEW_NAMES as readonly unknown[]).includes(i.view)) return bad("view is one of the Inbox's views");
      if (i.group !== undefined && !(INBOX_GROUPS as readonly unknown[]).includes(i.group)) return bad("group is client, due or kind");
      if (i.clients !== undefined && (!Array.isArray(i.clients) || i.clients.length > 50 || i.clients.some((x) => typeof x !== "string" || !x || x.length > 100))) return bad("clients is a list of client keys");
      if (i.sort !== undefined && !(INBOX_SORTS as readonly unknown[]).includes(i.sort)) return bad("sort is newest or oldest");
      if (i.grouping !== undefined && !(INBOX_GROUPINGS as readonly unknown[]).includes(i.grouping)) return bad("grouping is day, client, due or status");
      if (i.statuses !== undefined && (!Array.isArray(i.statuses) || i.statuses.some((x) => !(INBOX_VIEW_NAMES as readonly unknown[]).includes(x)))) return bad("statuses is a list of the Inbox's views");
      if (!ctx.writeConfig) return { ok: false, status: 503, error: "Settings can't be saved here" };
      const r = await ctx.writeConfig((text) => {
        let t = text;
        if (i.sort !== undefined) t = setValue(t, "ui", "inbox_sort", i.sort as string);
        if (i.statuses !== undefined) t = setValue(t, "ui", "inbox_statuses", [...new Set(i.statuses as string[])]);
        if (i.grouping !== undefined) t = setValue(t, "ui", "inbox_grouping", i.grouping as string);
        if (i.view !== undefined) t = setValue(t, "ui", "inbox_view", i.view as string, "Inbox (IB-1): the view, clients and grouping last used.");
        if (i.clients !== undefined) t = setValue(t, "ui", "inbox_clients", [...new Set(i.clients as string[])]);
        if (i.group !== undefined) t = setValue(t, "ui", "inbox_group", i.group as string);
        return t;
      });
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
    case "chats.calls":
    case "chats.registered":
    case "chats.list":
    case "chats.add":
    case "chats.remove":
    case "chats.kind":
    case "chats.reading":
    case "chats.social":
    case "chats.refresh":
    case "permissions.status":
      return chatAction(await chatContext(ctx), action, req.input);
    case "requests.list":
    case "requests.refresh":
    case "requests.context":
    case "requests.resolve":
    case "requests.reopen":
    case "requests.search":
    case "requests.purge":
    case "requests.sort_again":
    case "requests.show":
    case "promises.list":
    case "promises.resolve":
    case "promises.reopen":
    case "promises.link":
      return requestAction(await requestContext(ctx), action, req.input);
    case "admin.status":
    case "admin.load":
    case "admin.set":
    case "admin.override":
    case "admin.refresh_people":
    case "admin.remove_person":
    case "admin.audit":
    case "admin.status_action":
    case "admin.identity":
    case "admin.invited":
    case "admin.standards_sync":
    case "admin.invite_access":
    case "admin.invite_preview":
    case "admin.invite_send":
    case "admin.invite_retry":
      return adminAction(
        {
          ops: ctx.adminOps ?? null,
          me: async () => {
            const me = await storedIdentity(ctx.plan);
            return me ? { id: me.oid, name: me.name || me.username || "An admin" } : null;
          },
          // WT-1: each client's process model, read with the company read PAT through this admin's DevOps source.
          process: async (keys, refresh) => {
            const cfg = await configured(ctx);
            return cfg ? ctx.makeDevOps(cfg.dataverse, userZone(cfg)).processModels(keys, { refresh }) : null;
          },
          today: async () => {
            const cfg = await configured(ctx);
            return localToday(ctx.now(), cfg ? userZone(cfg) : "UTC");
          },
          zone: async () => {
            const cfg = await configured(ctx);
            return cfg ? userZone(cfg) : "UTC";
          },
          // IN-2: the same sends and consent probes as Close the loop (LP-1), as this admin.
          send: { sender: async () => (await accountOf(ctx))?.sender ?? null, access: sendProbe(ctx), canAsk: !ctx.demo?.on },
        },
        action as AdminAction,
        req.input,
      );
    case "conversations.list":
    case "conversations.count":
    case "conversations.refresh":
    case "conversations.messages":
    case "conversations.seen":
    case "conversations.resolve":
    case "conversations.not_request":
    case "conversations.not_work":
    case "conversations.not_work_undo":
    case "conversations.reopen":
    case "conversations.hide":
    case "conversations.move":
    case "conversations.this_is_work":
    case "conversations.link":
    case "conversations.take_over":
    case "conversations.claim":
    case "conversations.give":
    case "conversations.add_helper":
    case "conversations.release":
    case "conversations.close_out":
    case "conversations.undo_ownership":
    case "conversations.sort_unsorted":
    case "conversations.search":
    case "conversations.draft":
    case "my_promises.list":
    case "my_promises.today":
    case "my_promises.link":
    case "my_promises.search":
    case "my_promises.done":
    case "my_promises.not_needed":
    case "my_promises.reopen":
    case "my_promises.due":
    case "my_promises.who":
    case "my_promises.close":
    case "suggestions.skip":
    case "conversations.merge":
    case "conversations.merge_preview":
    case "conversations.unmerge":
    case "my_promises.start_draft":
    case "conversations.search_items":
    case "conversations.unlink":
    case "conversations.held":
    case "conversations.held_not_work":
    case "conversations.held_bulk":
    case "my_promises.unlink":
      return conversationAction(await conversationContext(ctx), action, req.input);
    case "inbox.list":
    case "inbox.count":
    case "inbox.today":
    case "inbox.seen":
    case "inbox.hide":
    case "inbox.snooze":
    case "inbox.looked":
      return inboxAction(
        {
          plan: ctx.plan,
          config: () => configured(ctx),
          now: ctx.now,
          conversations: async (cfg) => (ctx.requests?.conversations ? inboxFacts(await conversationContext(ctx), cfg) : []),
          sends: () => (ctx.team ? sendFacts(teamCtx(ctx)) : Promise.resolve([])),
          urgent: async (cfg) => (await urgentFor(ctx, ctx.now(), userZone(cfg), (k) => cfg.clientSettings[k]?.name ?? k)).urgent,
          snoozeDay: async () => {
            const h = await escalationHours(ctx);
            return h ? snoozeDayOf(h.hours, h.ptoDays) : null;
          },
        },
        action,
        req.input,
      );
    // DX-1: Settings › Data › Diagnostics, counts only, my own chats only (read-only).
    case "diagnostics.check":
      return diagnosticsAction(await conversationContext(ctx), action, req.input);
    case "people.picker":
      return pickerAction(ctx, req.input);
    case "ai.status":
    case "ai.test":
      return aiAction(await aiFor(ctx), action as AiActionName);
    case "people.photos":
      return photoAction({ ...(await presenceContext(ctx)), cache: ctx.photoCache ?? null }, req.input);
    case "media.status": {
      // Step 10: read-only check of the host's media control and the Spotify app. Nothing is run or installed.
      if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Object.keys(req.input).length)) return bad("media.status takes {}");
      return { ok: true, data: ctx.media ? await ctx.media.status() : { players: false, spotify: false } };
    }
    case "checkin.sessions":
    case "checkin.answer":
    case "checkin.all_to_plan":
    case "checkin.undo":
    case "checkin.offer_close":
      return progressAction(progressContext(ctx), action, req.input);
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
    case "boundary.check":
      return boundaryCheck(
        {
          boundary: (k) => boundaryOf(ctx, k),
          isMine: async (k) => {
            const b = await boundaryOf(ctx, k);
            if (b.internal) return true;
            return b.directory.some((c) => c.key.toLowerCase() === k.toLowerCase());
          },
        },
        req.input,
      );
    case "loop.draft":
    case "loop.preview":
    case "loop.send":
    case "loop.retry":
    case "loop.mark_sent":
    case "loop.undo_kept":
    case "loop.sends":
    case "loop.find":
      return loopAction(await loopContext(ctx), action, req.input);
    case "capture.add":
    case "capture.load":
    case "capture.route":
    case "capture.features":
    case "capture.undo":
    case "draft.add_feature":
      return captureAction(captureContext(ctx), action, req.input);
    case "draft.prepare":
    case "draft.get":
      return draftAiAction(prepareContext(ctx), action, req.input);
    case "ahead.load":
    case "ahead.people":
    case "ahead.stage":
    case "ahead.stage_bulk":
    case "ahead.unstage":
    case "ahead.discard":
    case "ahead.resolve":
    case "ahead.filters":
    case "ahead.set_filters":
    case "ahead.skip":
    case "ahead.unskip":
      return aheadAction(await aheadContext(ctx), req.action as AheadAction, req.input);
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
      return weekPlanAction(weekCtx(ctx), action, req.input);
    case "weekplan.proposal":
    case "weekplan.carry_decide":
    case "weekplan.carry_accept_all":
    case "weekplan.watch_checkin":
    case "weekplan.watch_remove":
      return carryAction(carryCtx(ctx), action, req.input);
    case "assistant.ask":
    case "assistant.confirm":
    case "assistant.cancel":
    case "assistant.undo":
    case "assistant.history":
    case "assistant.clear":
    case "assistant.today":
    case "lookup.day":
    case "items.get":
      return assistantAction(async () => (await assistantFor(ctx, "panel"))?.service ?? null, async () => (await assistantFor(ctx, "panel"))?.reads ?? null, action, req.input, (c) => assistantGate(ctx, c));
    case "devops.versions":
    case "devops.refresh":
    case "devops.find":
      return freshAction(await freshContext(ctx), action, req.input);
    case "status.load":
    case "status.draft":
    case "status.report":
    case "status.suggest":
      return statusAction(await statusCtx(ctx), action satisfies StatusAction, req.input);
    case "send.people":
    case "send.create":
    case "send.cancel":
    case "send.accept":
    case "send.pass":
    case "send.cant":
    case "send.withdraw":
    case "send.today":
    case "team.commit":
    case "team.view":
    case "priority.flag":
    case "priority.unflag":
    case "priority.add_to_week":
    case "look.ask":
    case "look.reply":
      return teamAction(teamCtx(ctx), action satisfies TeamAction, req.input);
    case "deploy.items":
    case "deploy.config_save":
      return deployItemAction(
        {
          org: ctx.org,
          me: async () => {
            const me = await storedIdentity(ctx.plan);
            return me ? { id: me.oid, name: me.name || me.username || "Someone" } : null;
          },
          isAdmin: () => amAdmin(ctx),
        },
        action satisfies DeployItemAction,
        req.input,
      );
    case "planday.start":
    case "planday.carry":
    case "planday.commit":
    case "pick.add":
    case "pick.remove":
    case "pick.take_off":
    case "pick.put_back":
    case "pick.set_size":
    case "pick.move":
    case "pick.mark_done":
    case "deploy.add":
    case "pick.set_kind":
    case "pick.uncarry":
    case "pick.undrop":
    case "planday.carry_hint":
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
          clientDeploy: async (clientKey) => {
            const rule = (await ctx.org?.rules())?.clients[clientKey];
            return rule ? { dataPlatform: rule.dataPlatform, deployItems: rule.deployItems } : null;
          },
          now: ctx.now,
          resolved: (cfg, items) => resolvedKeys(ctx.makeDevOps(cfg.dataverse, userZone(cfg)), [...new Set(items.map((i) => i.clientKey))].map((clientKey) => ({ clientKey, clientName: clientKey })), idsByClient(items)),
          storeItem: async (clientKey, itemId) => {
            const r = await aheadAction(await aheadContext(ctx), "ahead.load", {});
            const it = r.ok ? (r.data as import("./types.ts").AheadLoad).clients.find((c) => c.clientKey === clientKey)?.items.find((x) => x.id === itemId && x.inScope) : undefined;
            return it ? { id: it.id, title: it.title, type: it.type, state: it.state, stateCategory: it.stateCategory, level: it.level === "child" || it.level === "task" ? "story" : it.level ? "portfolio" : "other", order: it.order ?? null, parentId: it.parentId, changedAt: it.changedAt, url: it.url } : null;
          },
          openParents: async (clientKey, tier) => {
            const cap = captureContext(ctx);
            const f = await featuresOf(cap, await cap.config(), clientKey);
            return f.status === "ok" ? (tier === "epic" ? f.epics : f.features).map((x) => x.id) : null;
          },
        },
        action,
        req.input,
      );
    case "meeting.list":
    case "meeting.candidates":
    case "meeting.register":
    case "meeting.update":
    case "meeting.remove":
    case "meeting.mine":
    case "meeting.review":
    case "meeting.edit":
    case "meeting.no_transcript":
    case "meeting.prepare":
    case "meeting.confirm":
    case "meeting.rerun":
    case "meeting.check_now":
      return meetingAction(await meetingContext(ctx), action as MeetingAction, req.input);
    default: {
      const unhandled: never = action;
      return bad(`unknown action ${String(unhandled)}`);
    }
  }
}

/** SW-1: sends, priorities, the Team view and Ask to look. */
export function teamCtx(ctx: ActionContext): TeamContext {
  return {
    plan: ctx.plan,
    team: ctx.team,
    config: () => configured(ctx),
    org: ctx.org,
    me: async () => (await storedIdentity(ctx.plan))?.oid ?? null,
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    blocks: (cfg, weekStart) => patternWeek(ctx, cfg, weekStart),
    ...(ctx.onFocusTime ? { onFocusTime: ctx.onFocusTime } : {}),
    now: ctx.now,
  };
}

/** The week plan actions' context (and WD-1's placeFeature). */
function weekCtx(ctx: ActionContext): WeekPlanContext {
  return {
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
  };
}

/** SW-1: after a week plan change, the Team view's snapshot (on commit) and a sender's "Scheduled" (on a pin or a pick). */
async function afterPlanChange(ctx: ActionContext, action: string, input: unknown, r: ActionResponse): Promise<ActionResponse> {
  if (!r.ok || !ctx.team) return r;
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  try {
    if ((action === "weekplan.place" && o.on !== false) || action === "pick.add") {
      if (typeof o.clientKey === "string" && typeof o.itemId === "number") await markScheduled(teamCtx(ctx), o.clientKey, o.itemId);
    }
  } catch {
    // The plan change stands.
  }
  return r;
}

/** PL-1: the "From last week" proposal and Watching rows' context. */
/** SR-1: Status's reads: Ahead's items and identities, Kat's last send, the comments, the change log, AI. */
/** DV-2: versions, Refresh and Find an item, over the same clients and store as Ahead. */
async function freshContext(ctx: ActionContext): Promise<FreshContext> {
  const today = async () => {
    const cfg = await configured(ctx);
    return cfg ? localToday(ctx.now(), userZone(cfg)) : null;
  };
  return {
    config: () => configured(ctx),
    clients: async (cfg) => aheadClients(ctx, cfg, mondayOf(localToday(ctx.now(), userZone(cfg))), false),
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    ahead: async () => {
      const actx = await aheadContext(ctx);
      const [l, f] = await Promise.all([aheadAction(actx, "ahead.load", {}), aheadAction(actx, "ahead.filters", {})]);
      return l.ok ? { load: l.data as import("./types.ts").AheadLoad, filters: f.ok ? ((f.data as { filters: import("../plan/ahead-edit.ts").AheadFilters | null }).filters ?? null) : null } : null;
    },
    todayItems: async (k) => {
      const d = await today();
      if (!d || !ctx.plan) return [];
      return (await ctx.plan.picksBetween(d, d)).filter((p) => p.clientKey === k && p.itemId !== null && p.status !== "dropped").map((p) => p.itemId!);
    },
    weekItems: async (k) => {
      const d = await today();
      if (!d || !ctx.plan) return [];
      return (await ctx.plan.weekPlan(mondayOf(d))).features.filter((f) => f.clientKey === k).flatMap((f) => [f.itemId, ...(f.parentId !== null ? [f.parentId] : [])]);
    },
    nowMs: () => Temporal.Instant.from(ctx.now()).epochMilliseconds,
    who: ctx,
  };
}

async function statusCtx(ctx: ActionContext): Promise<StatusContext> {
  const ahead = await aheadContext(ctx);
  let ids: Promise<import("./ahead-actions.ts").AheadIdentities | null> | null = null;
  return {
    plan: ctx.plan,
    config: () => configured(ctx),
    clients: (cfg, weekStart) => aheadClients(ctx, cfg, weekStart, false),
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    katSent: (cfg, keys) => katSentFor(ctx, cfg, keys),
    myEmails: async (k) => {
      ids ??= ahead.identities ? ahead.identities().catch(() => null) : Promise.resolve(null);
      const ix = await ids;
      const writes = (await ctx.plan?.devopsIdentities().catch(() => []))?.filter((w) => w.clientKey === k).map((w) => w.email) ?? [];
      return [...new Set([...(ix ? ix.mine(k) : []), ...writes].map((e) => e.toLowerCase()))];
    },
    canWrite: ahead.canWrite,
    ai: () => aiFor(ctx),
    now: ctx.now,
    // SR-2: the client report's team (Week › Team's roster), the team's PTO days and who my lines show as.
    team: () => reportTeam(teamCtx(ctx)),
    teamPto: async (cfg, from, to) => {
      const dv = ctx.makeDataverse(cfg.dataverse, userZone(cfg));
      return dv.teamPto ? dv.teamPto(from, to) : { ok: false as const, message: "PTO can't be read here" };
    },
    writeName: async (k) => (await ctx.plan?.devopsIdentities().catch(() => []))?.find((w) => w.clientKey === k)?.name ?? null,
    // SR-3: Cooptimize's observed holidays (the Working Days Calendar), read with the app's Dataverse access.
    holidays: async (cfg, from, to) => {
      const dv = ctx.makeDataverse(cfg.dataverse, userZone(cfg));
      return dv.holidays ? dv.holidays(from, to) : { ok: false as const, message: "Holidays can't be read here" };
    },
    workdays: (cfg, from, to) => workdaysFor(ctx, cfg, from, to),
  };
}

/**
 * RF-1: my own days for the Status tab's dot: the weeks week.load builds (Dataverse focus blocks, standing blocks, PTO,
 * working hours and the catch-up day), without calendars or DevOps. Read from the sources' caches as week.load left
 * them. Focus blocks that can't be read at all throw, so the tab shows no dot rather than a guess.
 */
async function workdaysFor(ctx: ActionContext, cfg: AppConfig, from: IsoDate, to: IsoDate): Promise<DotDay[]> {
  const tz = userZone(cfg);
  if (!cfg.dataverse.mySystemUserId) throw new Error("not matched in Dataverse yet");
  const dv = ctx.makeDataverse(cfg.dataverse, tz);
  const out: DotDay[] = [];
  for (const weekStart of [...new Set([mondayOf(from), mondayOf(to)])]) {
    const [patterns, pto] = await Promise.all([dv.load(weekStart, {}), dv.pto(...weekRange(weekStart), {}).catch(() => null)]);
    if (patterns.status !== "ok" && !patterns.fromCache) throw new Error("focus blocks can't be read");
    const week = buildWeek({ weekStart, patterns: patterns.items, events: [], config: cfg.week, pto: ptoByDate(pto?.items ?? [], weekDates7(weekStart)) });
    out.push(...dotDays(week.days, tz));
  }
  return out.filter((d) => d.date >= from && d.date <= to);
}

/** SR-1: Kat's last send per client, from Dataverse (a source without the read: unknown, the Monday 7:00 fallback). */
async function katSentFor(ctx: ActionContext, cfg: AppConfig, keys: string[]) {
  const dv = ctx.makeDataverse(cfg.dataverse, userZone(cfg));
  return dv.statusSent ? dv.statusSent(keys) : { ok: false as const, message: "Kat's last send can't be read here" };
}

function carryCtx(ctx: ActionContext): CarryContext {
  return {
    plan: ctx.plan,
    config: () => configured(ctx),
    devops: (cfg) => ctx.makeDevOps(cfg.dataverse, userZone(cfg)),
    clients: async (cfg, weekStart) => {
      const today = localToday(ctx.now(), userZone(cfg));
      const dv = cfg.dataverse.mySystemUserId ? await ctx.makeDataverse(cfg.dataverse, userZone(cfg)).load(weekStart, {}).catch(() => null) : null;
      return (await devopsClients(ctx, cfg, weekStart, today, {}, dv?.items ?? [])).fetch;
    },
    blocks: (cfg, weekStart) => patternWeek(ctx, cfg, weekStart),
    org: ctx.org,
    me: async () => (await storedIdentity(ctx.plan))?.oid ?? null,
    now: ctx.now,
  };
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
    ...(ctx.org ? { org: ctx.org } : {}),
    ...(ctx.writeConfig ? { writeConfig: ctx.writeConfig } : {}),
    ...(ctx.plan ? { plan: ctx.plan } : {}),
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
