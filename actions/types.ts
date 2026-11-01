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

/** A loop in the Loops view (step 6c): who (client), what, when. */
export type LoopView = { id: number; kind: string; clientKey: string | null; what: string; channel: string | null; due: string | null; openedAt: string; closedAt: string | null; closeNote: string | null;
  /** The flex session a flex loop came from (its when), or null. */
  session: { start: string; end: string } | null };

