// Plan layer types (step 5, Plan the day). Pure data shared by the store, actions and UI.
import type { Half, IsoDate } from "../week/types.ts";
import type { DayAccess } from "./days.ts";

export type Size = "S" | "M" | "L";
export type PickStatus = "planned" | "done" | "moved" | "dropped";
/** What a pick points at: a DevOps item, a local draft story, or a typed intention. */
export type PickKind = "item" | "draft" | "intention";

/** ISO date-time with offset and zone, e.g. "2026-11-02T08:01:00-05:00[America/New_York]". */
export type ZonedStamp = string;

export type DayPlan = { date: IsoDate; committedAt: ZonedStamp | null; /** When Close out was done for this day (step 7). */ closedOutAt: ZonedStamp | null; createdAt: ZonedStamp; updatedAt: ZonedStamp };

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
  /** Step 13.5: the follow-up this pick is for (an intention pick). */
  followUpId: number | null;
  position: number;
  createdAt: ZonedStamp;
  updatedAt: ZonedStamp;
};

/** A local draft story for a client, under a feature or (step 9, from a capture) under none yet. */
/** A local draft story (under a feature), or since step 13.5 a draft feature (level "feature", under an epic). */
export type DraftStory = { id: number; clientKey: string; parentItemId: number | null; title: string; size: Size; level: "story" | "feature"; createdAt: ZonedStamp; /** Step 14: set once created in DevOps (the draft then leaves draft lists). */ devopsId?: number; devopsUrl?: string | null };

/** A quick capture (step 9): in the inbox until routed to a follow-up, a draft story or a note (or dismissed). */
export type Capture = { id: number; text: string; clientKey: string | null; createdAt: ZonedStamp; routedAt: ZonedStamp | null; routedAs: "follow_up" | "draft" | "draft_feature" | "left_off" | "dismissed" | null; routedId: number | null };

/** Everything the Plan the day panel needs for one date. */
export type PlanDayState = {
  date: IsoDate;
  plan: DayPlan;
  picks: Pick[];
  /** Unfinished picks from earlier days, newest first. Only on the carry-over day (carryTarget), else empty. */
  carryOver: Pick[];
  /** The one day carry-over is offered on: the earliest upcoming uncommitted day that can be planned. */
  carryTarget: IsoDate | null;
  /** "past": only ticking done and dropping. "plan": everything. */
  access: DayAccess;
  drafts: DraftStory[];
  /** False when this call was an automatic open and the day had already been offered once. */
  opened: boolean;
  /** Seconds focused per pick id, from the focus log (step 6d). Picks with none are left out. */
  focused: Record<number, number>;
  /** The latest resume note per client on or before this date (step 7). */
  resumeNotes: Record<string, { clientKey: string; date: IsoDate; note: string }>;
  /** Features committed to this date's week (step 8): their stories are offered first in their client's blocks. */
  weekFeatures: { clientKey: string; itemId: number; title: string; url: string | null; slots: WeekFeature["slots"]; level: WeekFeature["level"]; tier: WeekFeature["tier"]; blocks: number; position: number | null; doneAt: ZonedStamp | null }[];
};

/** Committed plans for the days of a week, for the checklist on the week view. */
export type PlanWeek = Record<IsoDate, { committedAt: ZonedStamp | null; picks: Pick[] }>;

/** S up to about 1 h, M about 2 h, L a whole block (about 3 to 4 h). Nothing above L: split it first. */
export const SIZE_MINUTES: Record<Size, number> = { S: 60, M: 120, L: 210 };
export const SIZES: readonly Size[] = ["S", "M", "L"];
export const DEFAULT_SIZE: Size = "M";

/** A feature committed to a week (step 8): a number of my blocks for its client, some maybe placed on specific blocks. */
export type WeekFeature = {
  id: number;
  weekStart: IsoDate;
  clientKey: string;
  itemId: number;
  title: string;
  itemType: string | null;
  url: string | null;
  /** Step 11: a feature or a story on the client's week list, a must or a nice to have. */
  level: "feature" | "story";
  tier: "must" | "nice";
  /** The client's week share it needs, in blocks (half steps). */
  blocks: number;
  /** Pins: specific blocks (morning or afternoon) it is tied to, in date order. Optional. */
  slots: { date: IsoDate; half: "AM" | "PM" }[];
  /** A local done mark (DevOps state and done picks count too; see plan/weeklist.ts). */
  doneAt: ZonedStamp | null;
  /** Q51: "devops" when the title is DevOps's current one, "saved" when it is the one stored at commit. Read models only. */
  titleSource?: "devops" | "saved";
  /** Local order within the client's tier; null follows DevOps stack rank. */
  position: number | null;
  createdAt: ZonedStamp;
  updatedAt: ZonedStamp;
};

export type WeekPlanRecord = { weekStart: IsoDate; committedAt: ZonedStamp | null; /** The latest change to the plan or its features. */ updatedAt: ZonedStamp | null; features: WeekFeature[] };

/** How a follow-up was closed (step 13.5), optional. */
export const CLOSE_HOW = ["teams", "email", "devops", "call"] as const;
export type CloseHow = (typeof CLOSE_HOW)[number];
/** Why Coopilot opened a heads-up: the trigger, the items, when (step 13.5). */
export type FollowUpOrigin = { trigger: string; items: { itemId: number | null; title: string }[]; at: string };
