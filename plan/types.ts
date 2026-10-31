// Plan layer types (step 5, Plan the day). Pure data shared by the store, actions and UI.
import type { Half, IsoDate } from "../week/types.ts";

export type Size = "S" | "M" | "L";
export type PickStatus = "planned" | "done" | "moved" | "dropped";
/** What a pick points at: a DevOps item, a local draft story, or a typed intention. */
export type PickKind = "item" | "draft" | "intention";

/** ISO date-time with offset and zone, e.g. "2026-11-02T08:01:00-05:00[America/New_York]". */
export type ZonedStamp = string;

export type DayPlan = { date: IsoDate; committedAt: ZonedStamp | null; createdAt: ZonedStamp; updatedAt: ZonedStamp };

export type Pick = {
  id: number;
  date: IsoDate;
  half: Half;
  clientKey: string;
  kind: PickKind;
  /** DevOps item id (kind "item"). */
  itemId: number | null;
  /** Local draft story id (kind "draft"). */
  draftId: number | null;
  /** Item or draft title as picked, or the intention text. */
  title: string;
  itemType: string | null;
  itemUrl: string | null;
  size: Size;
  status: PickStatus;
  /** The pick this one was carried or moved from. */
  carriedFrom: number | null;
  /** Date of that pick, for "carried from Tue". */
  carriedFromDate: IsoDate | null;
  notes: string | null;
  position: number;
  createdAt: ZonedStamp;
  updatedAt: ZonedStamp;
};

export type DraftStory = { id: number; clientKey: string; parentItemId: number; title: string; size: Size; createdAt: ZonedStamp };

/** Everything the Plan the day panel needs for one date. */
export type PlanDayState = {
  date: IsoDate;
  plan: DayPlan;
  picks: Pick[];
  /** Unfinished picks from earlier days, newest first. */
  carryOver: Pick[];
  drafts: DraftStory[];
  /** False when this call was an automatic open and the day had already been offered once. */
  opened: boolean;
};

/** Committed plans for the days of a week, for the checklist on the week view. */
export type PlanWeek = Record<IsoDate, { committedAt: ZonedStamp | null; picks: Pick[] }>;

/** S up to about 1 h, M about 2 h, L a whole block (about 3 to 4 h). Nothing above L: split it first. */
export const SIZE_MINUTES: Record<Size, number> = { S: 60, M: 120, L: 210 };
export const SIZES: readonly Size[] = ["S", "M", "L"];
export const DEFAULT_SIZE: Size = "M";
