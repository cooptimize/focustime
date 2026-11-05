import type { FollowState } from "../week/follow.ts";
// Action response shapes shared by the server and the UI. Types only, no runtime imports.
import type { AppConfig, ClientSetting, FieldError, UiConfig } from "../config/schema.ts";
import type { FocusSettings } from "../plan/focussound.ts";
import type { TodayTarget } from "../week/dates.ts";
import type { PlanWeek } from "../plan/types.ts";
import type { ClientPortfolio, ClientWork, IsoDate, RiskThresholds, SourceResult, StandingBlock, TypeLook, Week } from "../week/types.ts";
import type { Capture, DraftStory, WeekFeature } from "../plan/types.ts";
import type { TimeModel } from "../week/hours.ts";

export type SourceSummary = Omit<SourceResult<unknown>, "items"> & { itemCount: number };

export type WeekLoadData = {
  weekStart: string;
  week: Week;
  today: TodayTarget;
  sources: SourceSummary[];
  /** Assigned DevOps work per client with a block this week; null when Dataverse is not usable. */
  devops: ClientWork[] | null;
  clients: Record<string, string>;
  /** ADM-1: the person's guidance (their choice, else their level's team default): emphasis only, never a block. */
  guidance?: import("../config/org.ts").Guidance | null;
  /** PL-1: the budget inputs Commit and the Board share (planShare, Keep open, what DevOps resolved, check-ins). */
  planBits?: import("../plan/carry.ts").PlanBits | null;
  /** PL-1: Watching check-ins not yet picks (ghost chips on the Board). */
  checkins?: import("../plan/carry.ts").CheckinGhost[];
  /** Day plans and picks for the days of this week (local plan store); null when the store is unavailable. */
  plan: PlanWeek | null;
  /** Clients an Open half-day can take (this week's, standing blocks, and every client I'm an Account Worker on). */
  planClients: { clientKey: string; clientName: string }[];
  /** Today's Plan the day status, for the automatic open on the first focus of a workday. */
  /** Today (the real date). `workday`: it has working hours or a flex session and isn't a PTO day (D106, D127). */
  planDay: { date: IsoDate; workday: boolean; committed: boolean; available: boolean };
  /** PTO dates from this week's Monday about five weeks ahead, so Plan the day's target skips them (D106). */
  ptoAhead: IsoDate[];
  /** The time model (step 6b): working hours per weekday, lunch, one-day overrides and the zone. */
  hours: TimeModel;
  thresholds: RiskThresholds;
  /** Settings > Planning (step 6c): pick size minutes, carry-over days, reminder offset and focus timer defaults. */
  planning: PlanningSettings;
  /** The focus timer (step 6c), or null. */
  timer: TimerView | null;
  /** Focus sounds, playlists and media control from [focus] (step 10); defaults when unset. */
  focus: FocusSettings;
  /** What media control the host has (read-only check): pausing players, and the Spotify app for playlist links. */
  media: { players: boolean; spotify: boolean };
  /** Open follow-ups, for the Follow-ups count in the top bar (step 6c). */
  openFollowUps: number;
  /** Focused seconds per pick on the week shown (focus log, step 6c). */
  focused: Record<number, number>;
  /** The latest resume note per client (step 7). */
  resumeNotes: Record<string, ResumeNoteView>;
  /** Borrowed time from this week's days, plus every unpaid record (step 7). */
  borrowed: BorrowedView[];
  /** Whether today is closed out (step 7). */
  closeOut: { date: IsoDate; done: boolean };
  /** Step 16.2: today's Check-in was done (Done in Check-in). */
  checkIn: { date: IsoDate; done: boolean };
  /** The loaded week's plan (step 8): committed features per client, with any blocks they are placed on. */
  weekPlan: WeekPlanView | null;
  /** Committed features of the loaded week, this week and next week, for the week cards and Plan the day. */
  weekFeatures: WeekFeature[];
  /** Captures not sorted yet (step 9), for the Capture tab count. */
  captures: number;
  /** Open follow-ups, not snoozed (step 13.5): on the week's cards, Today and Plan the day. */
  followUps: FollowUpView[];
  /** The Plan the week badge: the week a nudge asked for that still isn't committed (server clock). */
  weekNudge: { badge: IsoDate | null };
  /** Step 17: the Plan ahead rituals due now: Look ahead 4 weeks and the direction review (a dot on Plan ahead). */
  aheadDue: import("../plan/rituals.ts").AheadRitualKind[];
  /** Step 16.2: whether a week (this week, next week, the week shown) is committed, by its Monday. */
  weekCommitted: Record<IsoDate, boolean>;
  /** Display settings from [ui] (step 6b): the theme. Defaults when the config is invalid. */
  /** Timeboxes on the week (step 12): live ones, plus removed ones whose Outlook event is still to be taken off. */
  timeboxes: TimeboxView[];
  /** [timebox]: Put on Outlook by default, and whether changes to my own timebox events ask first. */
  timeboxSettings: { outlookDefault: boolean; confirmOwn: boolean; enabled: boolean };
  /** Step 13: edit facts per Outlook event id ("outlook:<id>") from the write-token scan (no attendee addresses). */
  eventEdit: Record<string, import("../plan/caltier.ts").EditFacts>;
  /** Whether FocusTime may write to Outlook (the tiers only matter with it). */
  canWrite: boolean;
  /** Help invites on and around the week. */
  invites: InviteView[];
  collab: import("../config/schema.ts").CollabSettings;
  /** Step 14: clients with a checked DevOps write PAT (everything else stays read-only). */
  devopsWrite: string[];
  /** Step 14.5 (D256): write PATs and app secrets expiring within 14 days (or expired), soonest first. */
  expiring: { key: string; text: string; days: number; section: string }[];
  /**
   * AP-2: open asks AI sorted as needing me now (Today's attention line, with Start focus), and how many open asks are
   * past their urgency window (Check-in's "Walked in, not resolved").
   */
  requests: { urgent: UrgentAsk[]; pastUrgency: number };
  /** CV-1: my open promises with a due (or put on Today), for Today's Now, agenda and follow-ups row and Week's rail. */
  promises?: import("../plan/conversation-views.ts").DayPromise[];
  ui: UiConfig;
  config: { ok: boolean; path: string; created: boolean; errors: FieldError[] };
  /** Step 15 (D272): demo mode is on: every source is fictional sample data and the plan store is the demo one. */
  demo: boolean;
};

/** AP-2: one urgent ask on Today (the AI's title, never the message). */
/** CV-2: `conversationId`, the conversation its message is in now (the strip line opens it), when it is in one. */
export type UrgentAsk = { chatId: string; messageId: string; clientKey: string; clientName: string; title: string; at: string; conversationId?: number | null };

/** A value problem on one config field (Settings shows it next to the field). */
export type FieldProblem = { field: string; message: string };
export type ActionResponse<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string; fields?: FieldProblem[]; /** A refusal the UI can answer (step 13.5): "no_hours" asks Add hours or Move anyway. */ code?: string };

// ---- Settings (step 6b): what settings.load returns. Never a secret value. ----
export type AppSecret = "dataverse-client-secret" | "google-client-secret";
export type SecretPresence = "set" | "missing" | "locked" | "unavailable";

export type SettingsClient = {
  key: string;
  /** From Dataverse (reporting nickname); null when Dataverse couldn't be read. */
  dataverseName: string | null;
  /** My DevOps identity there (Account Worker), read-only. */
  devopsEmail: string | null;
  devops: boolean;
  setting: ClientSetting;
  /** The color as CSS (hex or palette token): mine when I picked one, else the team's. */
  css: string | null;
  /** ADM-1: the team color an admin set (or FocusTime suggested), a slot or a hex; null: none yet. */
  teamColor: string | null;
  /** Whether FocusTime follows it (DevOps, Open half-days) and why (step 6d); null when it couldn't be worked out. */
  follow: FollowState | null;
  /** Step 14: the checked DevOps write PAT's owner (never the PAT), or null: this client stays read-only. */
  write: { name: string; email: string; org: string; validatedAt: string; expires: string | null } | null;
};

export type SettingsData = {
  configPath: string;
  /** True when the settings are a config file on this machine (the developer loop); false for an account's settings
   * (signed in, hosted) or the demo: then app-level values are "Set by your FocusTime admin", never a file path. */
  fromFile: boolean;
  /** Per-field problems when the file doesn't validate (Settings shows them and saves nothing else). */
  problems: FieldProblem[];
  you: { email: string; systemUserId: string | null; environmentUrl: string; timeZone: string } | null;
  hours: TimeModel | null;
  standingBlocks: StandingBlock[];
  risk: RiskThresholds | null;
  planning: AppConfig["plan"];
  /** Settings > Focus (step 10). */
  focus: FocusSettings;
  clients: SettingsClient[];
  /** Whether Dataverse answered for the client list; when not, Dataverse-owned values are unknown, not empty. */
  dataverseReached: boolean;
  /** no-demo-leak: why the client list is missing (Dataverse not reached), with where to fix it; null when reached. */
  dataverseProblem?: string | null;
  palette: readonly string[];
  secrets: { account: AppSecret; label: string; state: SecretPresence; expires: string | null }[];
  display: AppConfig["ui"] | null;
  data: { planStore: boolean };
  /** Settings > Planning > Timeboxes (step 12). */
  timebox: AppConfig["timebox"];
  /** Settings > Planning > Help sessions (step 13); domains as used (config, else my work email's). */
  collab: AppConfig["collab"];
  /** Settings > Notifications (step 15.5). */
  notify: AppConfig["notify"];
  /** Settings > You > My VM (step 15.5, Q87). */
  vm: { startWithoutAsking: boolean };
  /** Settings > Roadmap (step 17): state thresholds. */
  roadmap: AppConfig["roadmap"];
  /** AP-1: how often chats are read for asks, and the phrase lists the rules use. */
  asks: AppConfig["asks"];
  /** AI-0: the person's [ai] (only draftMonths is theirs since ADM-1). */
  ai: AppConfig["ai"];
  /** ADM-1: the admins' AI rules (on for FocusTime, the clients allowed, the cap per person). */
  aiRules: AppConfig["aiRules"];
  /** ADM-1: the team's settings as they apply to me (level, guidance, team colors and phrases, Rules); null: none here. */
  org: AppConfig["org"];
  /** ADM-1: my own choices over my level's defaults. */
  guidance: AppConfig["guidance"];
};

/** [plan] values the UI uses (step 6c). */
export type PlanningSettings = Omit<AppConfig["plan"], "pickablePortfolioTypes" | "backgroundTypes">;

/** The focus timer as the UI sees it (step 6c). `endsAt` is set while running, for a local countdown. */
export type TimerView = {
  kind: "focus" | "break";
  pickId: number | null;
  label: string;
  plannedMinutes: number;
  remainingMs: number;
  running: boolean;
  ended: boolean;
  endsAt: string | null;
  /** When the current run started (null when paused or ended), so the UI can count focused time live (step 6d). */
  runningSince: string | null;
  /** Step 16.3: deep focus (Teams status Do not disturb). */
  deep: boolean;
};

/** A follow-up in the Follow-ups view and Close out (step 6c, step 7): who, what, when, and how it can close. */
export type FollowUpView = {
  id: number;
  /** The rule that opened it: devops_update, slip, blocked, flex_update or manual. */
  kind: string;
  clientKey: string | null;
  /** Who it is owed to: the client's name, or what I typed for a manual follow-up. */
  who: string;
  /** CV-2: the person Who names, when chosen in the PersonPicker; null: a plain name. */
  whoRef: import("../plan/person-ref.ts").PersonRef | null;
  what: string;
  channel: string | null;
  due: string | null;
  /** The DevOps item it is about, with a link when known. */
  itemId: number | null;
  itemUrl: string | null;
  /** The plain-text heads-up to copy (slip follow-ups). */
  draft: string | null;
  openedAt: string;
  /** Opened today (by the server's clock): listed first in Close out. */
  isNew: boolean;
  closedAt: string | null;
  closeNote: string | null;
  closedBy: "me" | "signal" | null;
  /** The flex session a flex follow-up came from (its when), or null. */
  session: { start: string; end: string } | null;
  /** Step 13.5: closed the loop (done) or not needed; how I told them; snoozed until; where a rule's one came from. */
  outcome: "done" | "not_needed" | null;
  closeHow: import("../plan/types.ts").CloseHow | null;
  snoozedUntil: IsoDate | null;
  origin: import("../plan/types.ts").FollowUpOrigin | null;
  /** Added by me (by hand or from a capture): can be deleted. */
  byHand: boolean;
  clientName: string | null;
  /** Urgency in words (null when closed or no due date). */
  dueState: import("../plan/due.ts").DueState | null;
  hasWho: boolean;
};

/** The latest resume note for a client (step 7): where I left off, shown on its next block and in Plan the day. */
export type ResumeNoteView = { clientKey: string; date: IsoDate; note: string };

/** Borrowed time (step 7). `paid` is set by the payback pick being done or by hand. */
export type BorrowedView = {
  id: number;
  pickId: number;
  /** The pick it slipped from. */
  fromPickId: number;
  clientKey: string;
  title: string;
  date: IsoDate;
  minutes: number;
  payback: "tonight" | "friday" | "day";
  paybackDate: IsoDate;
  paybackHalf: "AM" | "PM" | "EVE";
  paidAt: string | null;
  paidBy: "picks" | "me" | null;
};

/** What Close out shows for one day (step 7). */
export type CloseOutState = {
  date: IsoDate;
  today: IsoDate;
  /** "today" or "past" (Close out for a past day can be done later). */
  access: "today" | "past";
  committedAt: string | null;
  closedOutAt: string | null;
  picks: import("../plan/types.ts").Pick[];
  /** Where each moved pick went. */
  movedTo: Record<number, { date: IsoDate; half: "AM" | "PM" | "EVE" }>;
  /** Focused seconds per pick id. */
  focused: Record<number, number>;
  /** Where "Carry over" sends a pick: the next plannable day (today for a past day when today can be planned). */
  carryTo: IsoDate | null;
  /** Clients worked that day (picks done or focused on, flex sessions), for resume notes. */
  worked: { clientKey: string; clientName: string }[];
  /** That day's resume notes, and the latest before it per client (shown as a hint). */
  notes: Record<string, ResumeNoteView>;
  previous: Record<string, ResumeNoteView>;
  /** Open follow-ups, newest first. */
  followUps: FollowUpView[];
  /** Borrowed time from that day, and every unpaid record. */
  borrowed: BorrowedView[];
  /** Captures not sorted yet (step 9), for "N unprocessed captures". */
  captures: number;
};

/** A week's plan as the UI sees it (step 8). `changed`: edited since the last commit. */
export type WeekPlanView = { weekStart: IsoDate; committedAt: string | null; updatedAt: string | null; changed: boolean; features: WeekFeature[] };

/** Everything Plan the week needs beyond the week itself (step 8). Fit and readiness are computed from this and week.load. */
export type WeekPlanState = {
  weekStart: IsoDate;
  thisWeek: IsoDate;
  today: IsoDate;
  /** "past": a review, nothing changes. */
  access: "plan" | "past";
  plan: WeekPlanView;
  /** Features and epics per followed client with DevOps (none for a past week). */
  portfolios: ClientPortfolio[];
  /** Features marked as being broken down (local). */
  marks: { clientKey: string; itemId: number; markedAt: string }[];
  /** "Ask about priorities" follow-ups for this week. */
  followUps: FollowUpView[];
  /** Local draft stories (step 9: from captures or Plan the day), shown under their features. */
  drafts: DraftStory[];
  /** Captures not sorted yet (step 9). */
  captures: number;
  /** U6: draft features on this week's list, with their tier (drafts has the draft itself). */
  weekDrafts: { draftId: number; tier: "must" | "nice" }[];
  /** U6: clients marked "Nothing this week". */
  quiet: string[];
};


// ---- Quick capture (step 9) ----
/** What Capture shows: the inbox (newest first). Notes were removed in step 13.5. */
export type CaptureState = { today: IsoDate; inbox: Capture[]; inboxCount: number; /** Step 14: drafts not yet created in DevOps, for Create in DevOps. */ drafts: DraftStory[] };
export type FeatureChoice = { id: number; title: string; state: string; /** Step 15.3: for the shared lookup and the draft editor (area and iteration shown read-only). */ type?: string; url?: string; areaPath?: string | null; iterationPath?: string | null };
/** A client's open features for "under a feature"; "unavailable" when DevOps can't say (a draft then saves without one). */
export type CaptureFeatures = { clientKey: string; status: "ok" | "unavailable"; message?: string; features: FeatureChoice[]; /** Step 13.5: open epics, for a draft feature. */ epics: FeatureChoice[]; /** Step 15.3: the story type has acceptance criteria (the draft editor shows the field only then). */ acceptanceField?: boolean };

// ---- Step 12: timeboxes and the write framework ----
/** One field of a write preview: before and after (null where there is none), and whether it changes. */
export type PreviewField = { label: string; before: string | null; after: string | null; changed: boolean };
/** What an external write will do, shown before it happens. Held on the server for five minutes. */
export type WritePreview = {
  previewId: string;
  expiresAt: string;
  op: "create" | "update" | "delete";
  /** Step 13: a timebox's event, one of my own events, or a help invite. */
  kind: import("../plan/timebox.ts").WriteKind;
  undo: boolean;
  /** confirm_own is off and this changes my own timebox event: the UI confirms without asking (still logged). */
  auto: boolean;
  system: "Outlook";
  account: string;
  calendar: string;
  summary: string;
  fields: PreviewField[];
  visibility: string;
  /** Help invites: every person who will receive it (or its cancellation). */
  attendees: { name: string; email: string }[];
};
export type WriteResult = { entry: import("../plan/timebox.ts").WriteEntry; confirmed: boolean; message: string };
export type WriteState = { access: "write" | "read_only" | "not_connected" | "unavailable" | "not_set_up"; message: string; outlookDefault: boolean; confirmOwn: boolean };
export type WriteLogView = {
  entries: (import("../plan/timebox.ts").WriteEntry & { undoable: boolean; retryable: boolean; whenText: string | null })[];
  orphans: { uid: string; title: string; when: string }[];
};
/** A timebox for the UI: `sync` says what Outlook needs (null: in step or not on Outlook), `onOutlook` whether its event exists. */
export type TimeboxView = import("../plan/timebox.ts").Timebox & { sync: "create" | "update" | "delete" | null; onOutlook: boolean };

// ---- Step 13: calendar editing tiers and the collaboration finder ----
/** A help invite as the UI shows it on its item. */
export type InviteView = { uid: string; clientKey: string; itemId: number | null; pickId: number | null; timeboxId: number | null; title: string; start: string; end: string; names: string[]; teams: boolean; status: "pending" | "sent" | "cancelled"; writeId: number | null };
export type CandidateView = { name: string; email: string; tier: 1 | 2 | 3; onClient: string[]; away: string[] };
export type CandidatesData = { clientKey: string; from: string; to: string; candidates: CandidateView[]; problems: string[] };
export type SlotView = import("../plan/collab.ts").Slot;
export type SuggestData = { slots: SlotView[]; checked: number; problems: string[] };

/** followup.people (step 13.5): names to suggest for Who. */
export type PeopleData = { teammates: { name: string; email: string }[]; attendees: { name: string; email: string }[]; problems: string[] };
export type ReviewData = { headsUps: { id: number; what: string; reason: string }[] };

// ---- Step 14: DevOps writes ----
/** One DevOps change shown before it is written: where, which item, each field before and after, who it writes as. */
export type DevOpsPreview = {
  previewId: string; expiresAt: string; op: import("../plan/devopswrite.ts").WriteOp; summary: string; system: "DevOps"; org: string; project: string; item: string; identity: string;
  fields: import("../plan/devopswrite.ts").Row[]; links: string[]; notes: string[]; visibility: string; undo: boolean;
};
export type DevOpsResult = { entry: import("../plan/devopswrite.ts").DevOpsWriteEntry; confirmed: boolean; message: string; changed?: { field: string; was: string | null; now: string | null }[]; itemId?: number | null; url?: string | null };
export type DevOpsLogView = { entries: (import("../plan/devopswrite.ts").DevOpsWriteEntry & { undoable: boolean; retryable: boolean })[] };

/** Step 17: one story (or an epic's feature) under a Roadmap row, grouped by state. */
export type RoadmapStory = {
  id: number;
  title: string;
  state: string;
  group: "blocked" | "active" | "new" | "done";
  /** Display name ("You" for me), null when unassigned. */
  assignee: string | null;
  /** A matched Cooptimizer's email (photo and presence only); null otherwise. Never shown. */
  email: string | null;
  url: string;
};
/** Step 16 (D278 to D282), step 17 (D344 to D347): a feature or epic I own or contribute to, as the Roadmap shows it. */
export type RoadmapRow = {
  id: number;
  title: string;
  type: string;
  tier: "feature" | "epic";
  state: string;
  url: string;
  /** Owned: assigned to me. Contributing: the parent of a story assigned to me (D347). */
  relation: "owned" | "contributing";
  /** Who it is assigned to ("You" when me; a display name, never an email), for "Ask owner as a follow-up". */
  owner: string | null;
  /** The epic above it, when that epic is on the Roadmap too (Plan ahead nests it). */
  parentId: number | null;
  targetDate: string | null;
  /** DevOps Start Date; null when unset or when the process has none (`hasStartField`). */
  startDate: string | null;
  hasStartField: boolean;
  done: number;
  open: number;
  blocked: number;
  /** Who works on its open stories: display names with counts, never emails. */
  people: { name: string; count: number; /** Step 16.4: a matched Cooptimizer's email (by DevOps email, or by name without one); null otherwise. Never shown. */ email: string | null }[];
  unassigned: number;
  /** Null when the project has no size field. */
  unsized: number | null;
  /** Open ones with no change in 14 days. */
  stale: number;
  /** The latest change of any child; null when none. */
  lastActivity: string | null;
  /** The earliest of its children's last changes (an estimated bar's start, Plan ahead); null when none. */
  firstActivity: string | null;
  /** Daily snapshots of the last 21 days, oldest first. */
  trend: { date: string; done: number; open: number }[];
  /** One state, its plain reason, whether the trend is still building, and the pace forecast. */
  status: import("../plan/roadmap.ts").RowState;
  /** Stories (an epic: features), Removed left out, grouped by state. */
  stories: RoadmapStory[];
  /** Plan the week's readiness rules (D164). */
  flags: ("needs_breakdown" | "needs_features" | "no_target_date")[];
  /** On this week's plan already (step 8 week list). */
  onWeek: boolean;
};
export type RoadmapClient = { clientKey: string; clientName: string; status: import("../week/types.ts").ClientWorkStatus; message?: string; fetchedAt: string | null; fromCache: boolean; rows: RoadmapRow[] };
export type RoadmapState = { today: string; weekStart: string; clients: RoadmapClient[]; thresholds: import("../plan/roadmap.ts").RoadmapThresholds };

/** Step 17: Plan ahead's 12 weeks (roadmap.ahead). Whole numbers only. */
export type AheadState = {
  today: string;
  /** The 12 Mondays; week 1 is this week. */
  weeks: string[];
  columns: import("../plan/ahead.ts").AheadColumn[];
  clients: {
    clientKey: string;
    clientName: string;
    /** Weeks 1 to 4: free time against the musts planned, in minutes, as Plan the week counts them (E2). */
    weeks: { weekStart: string; freeMinutes: number; plannedMinutes: number; nicePlannedMinutes: number; borrowedMinutes: number; status: "none" | "all" | "free" | "over"; text: string; over: string | null }[];
    /** Weeks 5 to 12: free minutes per month column (patterns and PTO). */
    months: { month: string; available: number }[];
  }[];
  /**
   * Each feature's load per week in weeks 1 to 4, in minutes, from the week plans (what Plan the week shows). derived:
   * from its stories on that week's list (one sized), so the cell can't be set by hand; unsized: most aren't sized;
   * exact: every story under it is sized (its hours read "6h", else "about 6h").
   */
  cells: { clientKey: string; itemId: number; weekStart: string; minutes: number; derived: boolean; unsized: boolean; exact: boolean; tier: "must" | "nice"; weekItemId: number; stories: number }[];
  /** Dates dragged on the timeline, not saved to DevOps yet, per "<client>:<id>". */
  dates: Record<string, { start: string; end: string }>;
  /**
   * Slice 3: the 2 weeks before week 1. Musts' minutes from that week's plan (committed or not) and focused minutes per
   * pick item (a story maps to its feature in the UI); shown as whole hours in words.
   */
  past: { weekStart: string; committed: boolean; planned: { clientKey: string; itemId: number; minutes: number }[]; worked: { clientKey: string; itemId: number | null; minutes: number }[] }[];
};

// ---- Step 16.3: Teams presence ----
/** Teams access, in words the UI can act on. */
export type TeamsAccess = "ok" | "consent" | "signed_out" | "unavailable" | "off";
/** presence.status: Settings > Focus and the focus screen ("Teams: Busy until 10:45"). */
export type TeamsStatusView = {
  enabled: boolean;
  plainFocus: "busy" | "none";
  /** Only when asked to check ({ check: true }); otherwise null. */
  access: TeamsAccess | null;
  set: import("../plan/presence.ts").FocusStatus | null;
  until: string | null;
  manual: boolean;
  error: string | null;
};
/** presence.people: a word per Cooptimizer on screen; nothing for anyone presence couldn't be read for. */
export type PresencePeopleData = { available: boolean; reason: TeamsAccess | null; people: { email: string; name: string; word: import("../plan/presence.ts").PresenceWord }[]; /** Step 16.4: my own, when asked (the top bar's avatar). */ me?: import("../plan/presence.ts").PresenceWord | null };

/** Step 16.4: whether profile photos can be read for this sign-in. */
export type PhotoAccess = "consent" | "signed_out" | "unavailable";
/** Step 16.4: photos as data URLs (null: initials) for me and the Cooptimizers asked for, by email. */
export type PhotosData = { available: boolean; reason: PhotoAccess | null; me: string | null; people: { email: string; photo: string | null }[] };

/** ADM-1, WT-1: one type of a client's process for Admin › Clients: its look, level, the two Rules, its history in words. */
export type ProcessTypeRow = TypeLook & { breakdownSource: "default" | "override" | "level"; history: string | null; bug: boolean };
export type ClientProcess = { ok: true; process: string | null; project: string; bugs: string | null; types: ProcessTypeRow[] } | { ok: false; message: string };

// ---- AH-1: Ahead's grid, Gantt and Fix next (one model, D653) ----
/** One DevOps item as Ahead shows it: any level the process has, from the central store. */
export type AheadItem = {
  id: number;
  rev: number;
  title: string;
  type: string;
  state: string;
  stateCategory: string;
  /** The process level and its ladder rung (0 is the top backlog level). */
  level: import("../plan/process.ts").ProcessLevel | null;
  rung: number | null;
  parentId: number | null;
  /** Display name and DevOps uniqueName (email). The email is for matching and the picker; never shown as text. */
  assignee: { name: string; email: string | null } | null;
  start: string | null;
  target: string | null;
  size: number | null;
  url: string;
  changedAt: string;
  /** AH-2: in Cooptimize's scope for this client (my items always are). Out of it: shown only with "Show the whole project", never in Fix next. */
  inScope: boolean;
};
/** AH-2: a client's scope as Ahead shows it. Counts are open items. */
export type AheadScope = { kind: import("../plan/devops-scope.ts").ScopeKind; automatic: boolean; all: boolean; inScope: number; total: number; problem: string | null; whole: boolean };
/** One client's items and the fields its process gives each type ("Not in <project>'s process" when absent). */
export type AheadClient = {
  clientKey: string;
  clientName: string;
  status: import("../week/types.ts").ClientWorkStatus;
  message?: string;
  fetchedAt: string | null;
  project: string | null;
  /** My DevOps identity for this client (for "mine"); null when Dataverse doesn't have it. */
  me: string | null;
  /** Per type: its start, target and size fields (reference names); absent: not in this process. */
  startFields: Record<string, string>;
  targetFields: Record<string, string>;
  sizeFields: Record<string, string>;
  /** Display names of those fields ("Story Points"). */
  fieldNames: Record<string, string>;
  types: import("../week/types.ts").TypeLook[];
  items: AheadItem[];
  /** AH-2: absent before AH-2 and on a failed read. */
  scope?: AheadScope;
};
/** ahead.load: every client's items, my rights on each, my change set and my kept half-days. */
export type AheadLoad = {
  today: string;
  clients: (AheadClient & {
    /** isClientLead for me (D656). */
    lead: boolean;
    /** Item ids I may change; the rest are read-only with `note`. */
    editable: number[];
    note: string;
    /** Enable writes first: no write PAT for this client. */
    canWrite: boolean;
    /** FocusTime's own size of an item (a story's S/M/L, a feature's estimate), as a hint beside the DevOps field. */
    hints: Record<number, { text: string; minutes: number }>;
  })[];
  changes: import("../plan/ahead-edit.ts").StagedChange[];
  halves: { clientKey: string; itemId: number; field: "start" | "target"; day: string; half: "AM" | "PM" }[];
  /** I'm flagged as an automation account (nothing is editable). */
  automation: boolean;
};
