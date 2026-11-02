import type { FollowState } from "../week/follow.ts";
// Action response shapes shared by the server and the UI. Types only, no runtime imports.
import type { AppConfig, ClientSetting, FieldError, UiConfig } from "../config/schema.ts";
import type { FocusSettings } from "../plan/focussound.ts";
import type { TodayTarget } from "../week/dates.ts";
import type { PlanWeek } from "../plan/types.ts";
import type { ClientPortfolio, ClientWork, IsoDate, RiskThresholds, SourceResult, StandingBlock, Week } from "../week/types.ts";
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
  /** What media control is on this machine (read-only check): playerctl, and the Spotify app for playlist links. */
  media: { playerctl: boolean; spotify: boolean };
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
  /** Display settings from [ui] (step 6b): the theme. Defaults when the config is invalid. */
  /** Timeboxes on the week (step 12): live ones, plus removed ones whose Outlook event is still to be taken off. */
  timeboxes: TimeboxView[];
  /** [timebox]: Put on Outlook by default, and whether changes to my own timebox events ask first. */
  timeboxSettings: { outlookDefault: boolean; confirmOwn: boolean; enabled: boolean };
  /** Step 13: edit facts per Outlook event id ("outlook:<id>") from the write-token scan (no attendee addresses). */
  eventEdit: Record<string, import("../plan/caltier.ts").EditFacts>;
  /** Whether Coopilot may write to Outlook (the tiers only matter with it). */
  canWrite: boolean;
  /** Help invites on and around the week. */
  invites: InviteView[];
  collab: import("../config/schema.ts").CollabSettings;
  /** Step 14: clients with a checked DevOps write PAT (everything else stays read-only). */
  devopsWrite: string[];
  /** Step 14.5 (D256): write PATs and app secrets expiring within 14 days (or expired), soonest first. */
  expiring: { key: string; text: string; days: number; section: string }[];
  ui: UiConfig;
  config: { ok: boolean; path: string; created: boolean; errors: FieldError[] };
  /** Step 15 (D272): demo mode is on: every source is fictional sample data and the plan store is the demo one. */
  demo: boolean;
};

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
  /** The profile links use now (a legacy [edge.profiles] entry counts for Edge). */
  profile: string | null;
  /** The color as CSS (hex or palette token). */
  css: string | null;
  /** Whether Coopilot follows it (DevOps, Open half-days) and why (step 6d); null when it couldn't be worked out. */
  follow: FollowState | null;
  /** Step 14: the checked DevOps write PAT's owner (never the PAT), or null: this client stays read-only. */
  write: { name: string; email: string; org: string; validatedAt: string; expires: string | null } | null;
};

export type BrowserProfile = { directory: string; name: string };
export type BrowserInfo = { found: boolean; profiles: BrowserProfile[] };
/** The host's browsers (step 12, Q63): implemented in server/host.ts so no OS-specific code sits in actions/. */
export type HostBrowsers = {
  /** Installed Edge and Chromium and their profiles by name (read-only). */
  detect: () => { edge: BrowserInfo; chromium: BrowserInfo & { command: string[] | null } };
  /** The argument array that opens a client's link (its browser and profile, or the default browser). */
  linkCommand: (cfg: AppConfig, clientKey: string, url: string) => { argv: string[]; profile: string | null; notice: string | null; browser: "edge" | "chromium" | "default" };
};

export type SettingsData = {
  configPath: string;
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
  palette: readonly string[];
  browsers: { edge: BrowserInfo; chromium: BrowserInfo };
  secrets: { account: AppSecret; label: string; state: SecretPresence; expires: string | null }[];
  display: AppConfig["ui"] | null;
  data: { planStore: boolean };
  /** Settings > Planning > Timeboxes (step 12). */
  timebox: AppConfig["timebox"];
  /** Settings > Planning > Help sessions (step 13); domains as used (config, else my work email's). */
  collab: AppConfig["collab"];
};

/** [plan] values the UI uses (step 6c). */
export type PlanningSettings = Omit<AppConfig["plan"], "pickablePortfolioTypes">;

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
};

/** A follow-up in the Follow-ups view and Close out (step 6c, step 7): who, what, when, and how it can close. */
export type FollowUpView = {
  id: number;
  /** The rule that opened it: devops_update, slip, blocked, flex_update or manual. */
  kind: string;
  clientKey: string | null;
  /** Who it is owed to: the client's name, or what I typed for a manual follow-up. */
  who: string;
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
};


// ---- Quick capture (step 9) ----
/** What Capture shows: the inbox (newest first). Notes were removed in step 13.5. */
export type CaptureState = { today: IsoDate; inbox: Capture[]; inboxCount: number; /** Step 14: drafts not yet created in DevOps, for Create in DevOps. */ drafts: DraftStory[] };
export type FeatureChoice = { id: number; title: string; state: string };
/** A client's open features for "under a feature"; "unavailable" when DevOps can't say (a draft then saves without one). */
export type CaptureFeatures = { clientKey: string; status: "ok" | "unavailable"; message?: string; features: FeatureChoice[]; /** Step 13.5: open epics, for a draft feature. */ epics: FeatureChoice[] };

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

/** Step 16 (D278 to D282): one feature or epic I own, as the Delivery view shows it. */
export type DeliveryRow = {
  id: number;
  title: string;
  type: string;
  tier: "feature" | "epic";
  state: string;
  url: string;
  targetDate: string | null;
  done: number;
  open: number;
  /** Who works on its open stories: display names with counts, never emails. */
  people: { name: string; count: number }[];
  unassigned: number;
  /** Null when the project has no size field. */
  unsized: number | null;
  /** Open ones with no change in 14 days. */
  stale: number;
  /** Daily snapshots of the last 21 days, oldest first. */
  trend: { date: string; done: number; open: number }[];
  signal: { level: "on_track" | "watch" | "at_risk" | null; reason: string };
  /** Plan the week's readiness rules (D164). */
  flags: ("needs_breakdown" | "needs_features" | "no_target_date")[];
  /** On this week's plan already (step 8 week list). */
  onWeek: boolean;
};
export type DeliveryClient = { clientKey: string; clientName: string; status: import("../week/types.ts").ClientWorkStatus; message?: string; fetchedAt: string | null; fromCache: boolean; rows: DeliveryRow[] };
export type DeliveryState = { today: string; weekStart: string; clients: DeliveryClient[] };
