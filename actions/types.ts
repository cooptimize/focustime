import type { FollowState } from "../week/follow.ts";
// Action response shapes shared by the server and the UI. Types only, no runtime imports.
import type { AppConfig, ClientSetting, FieldError, UiConfig } from "../config/schema.ts";
import type { EdgeProfile } from "../links/edge.ts";
import type { TodayTarget } from "../week/dates.ts";
import type { PlanWeek } from "../plan/types.ts";
import type { ClientWork, IsoDate, RiskThresholds, SourceResult, StandingBlock, Week } from "../week/types.ts";
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
  /** Open loops, for the Loops count in the top bar (step 6c). */
  openLoops: number;
  /** Focused seconds per pick on the week shown (focus log, step 6c). */
  focused: Record<number, number>;
  /** The latest resume note per client (step 7). */
  resumeNotes: Record<string, ResumeNoteView>;
  /** Borrowed time from this week's days, plus every unpaid record (step 7). */
  borrowed: BorrowedView[];
  /** Whether today is closed out (step 7). */
  closeOut: { date: IsoDate; done: boolean };
  /** Display settings from [ui] (step 6b): the theme. Defaults when the config is invalid. */
  ui: UiConfig;
  config: { ok: boolean; path: string; created: boolean; errors: FieldError[] };
};

/** A value problem on one config field (Settings shows it next to the field). */
export type FieldProblem = { field: string; message: string };
export type ActionResponse<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string; fields?: FieldProblem[] };

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
};

export type BrowserInfo = { found: boolean; profiles: EdgeProfile[] };

export type SettingsData = {
  configPath: string;
  /** Per-field problems when the file doesn't validate (Settings shows them and saves nothing else). */
  problems: FieldProblem[];
  you: { email: string; systemUserId: string | null; environmentUrl: string; timeZone: string } | null;
  hours: TimeModel | null;
  standingBlocks: StandingBlock[];
  risk: RiskThresholds | null;
  planning: AppConfig["plan"];
  clients: SettingsClient[];
  /** Whether Dataverse answered for the client list; when not, Dataverse-owned values are unknown, not empty. */
  dataverseReached: boolean;
  palette: readonly string[];
  browsers: { edge: BrowserInfo; chromium: BrowserInfo };
  secrets: { account: AppSecret; label: string; state: SecretPresence; expires: string | null }[];
  display: AppConfig["ui"] | null;
  data: { planStore: boolean };
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

/** A loop in the Loops view and Close out (step 6c, step 7): who, what, when, and how it can close. */
export type LoopView = {
  id: number;
  /** The rule that opened it: devops_update, slip, blocked, flex_update or manual. */
  kind: string;
  clientKey: string | null;
  /** Who it is owed to: the client's name, or what I typed for a manual loop. */
  who: string;
  what: string;
  channel: string | null;
  due: string | null;
  /** The DevOps item it is about, with a link when known. */
  itemId: number | null;
  itemUrl: string | null;
  /** The plain-text heads-up to copy (slip loops). */
  draft: string | null;
  openedAt: string;
  /** Opened today (by the server's clock): listed first in Close out. */
  isNew: boolean;
  closedAt: string | null;
  closeNote: string | null;
  closedBy: "me" | "signal" | null;
  /** The flex session a flex loop came from (its when), or null. */
  session: { start: string; end: string } | null;
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
  /** Open loops, newest first. */
  loops: LoopView[];
  /** Borrowed time from that day, and every unpaid record. */
  borrowed: BorrowedView[];
};
