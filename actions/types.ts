// Action response shapes shared by the server and the UI. Types only, no runtime imports.
import type { FieldError } from "../config/schema.ts";
import type { TodayTarget } from "../week/dates.ts";
import type { DayShape, RiskThresholds, SourceResult, Week } from "../week/types.ts";

export type SourceSummary = Omit<SourceResult<unknown>, "items"> & { itemCount: number };

export type WeekLoadData = {
  weekStart: string;
  week: Week;
  today: TodayTarget;
  sources: SourceSummary[];
  clients: Record<string, string>;
  dayShape: DayShape;
  thresholds: RiskThresholds;
  config: { ok: boolean; path: string; created: boolean; errors: FieldError[] };
};

export type ActionResponse<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string };
