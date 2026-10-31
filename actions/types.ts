// Action response shapes shared by the server and the UI. Types only, no runtime imports.
import type { FieldError, UiConfig } from "../config/schema.ts";
import type { TodayTarget } from "../week/dates.ts";
import type { PlanWeek } from "../plan/types.ts";
import type { ClientWork, IsoDate, RiskThresholds, SourceResult, Week } from "../week/types.ts";
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
  /** Display settings from [ui] (step 6b): the theme. Defaults when the config is invalid. */
  ui: UiConfig;
  config: { ok: boolean; path: string; created: boolean; errors: FieldError[] };
};

export type ActionResponse<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string };
