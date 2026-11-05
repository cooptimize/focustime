// Plan layer types (step 5, Plan the day). Pure data shared by the store, actions and UI.
import type { Half, IsoDate } from "../week/types.ts";
import type { DayAccess } from "./days.ts";
import { STORY_MINUTES, UNSIZED_MINUTES, type StorySize } from "./estimate.ts";

export type Size = StorySize;
export type PickStatus = "planned" | "done" | "moved" | "dropped";
/** What a pick points at: a DevOps item, a local draft story, or a typed intention. */
export type PickKind = "item" | "draft" | "intention";

/** ISO date-time with offset and zone, e.g. "2026-11-02T08:01:00-05:00[Region/City]". */
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
  /** E2: S, M or L, or null when not sized yet (counts as 2h everywhere, never blocks anything). */
  size: Size | null;
  status: PickStatus;
  /** The pick this one was carried or moved from. */
  carriedFrom: number | null;
  /** Date of that pick, for "carried from Tue". */
  carriedFromDate: IsoDate | null;
  /** UI-B: read models only (the week's picks). For a moved pick, the block its carried copy is in ("→ moved to Mon AM"). */
  carriedTo?: { date: IsoDate; half: Half } | null;
  notes: string | null;
  /** Step 13.5: the follow-up this pick is for (an intention pick). */
  followUpId: number | null;
  /** PL-1: the pick's own minutes instead of its size (a Watching check-in's 30). Absent: its size. */
  minutes?: number | null;
  /** PL-1: read models only. Its DevOps item is resolved, closed or removed: counts zero minutes and shows as done. */
  resolved?: boolean;
  position: number;
  createdAt: ZonedStamp;
  updatedAt: ZonedStamp;
};

/** A local draft story for a client, under a feature or (step 9, from a capture) under none yet. */
/** A local draft story (under a feature), or since step 13.5 a draft feature (level "feature", under an epic). */
export type DraftStory = { id: number; clientKey: string; parentItemId: number | null; title: string; size: Size; level: "story" | "feature"; createdAt: ZonedStamp; /** Step 15.3: written by Create in DevOps. Acceptance criteria for stories, dates for features. */ description?: string | null; acceptance?: string | null; startDate?: string | null; targetDate?: string | null; /** Step 14: set once created in DevOps (the draft then leaves draft lists). */ devopsId?: number; devopsUrl?: string | null; /** CP-1: the AI-prepared version (never my own text), or null when prepare hasn't run. */ ai?: DraftAi | null };
/** CP-1: what AI prepared for a captured draft. My own title stays the draft's until I accept this. */
export type DraftAiState = "writing" | "ready" | "needs_parent" | "off" | "failed";
export type DraftAi = { state: DraftAiState; title: string | null; description: string | null; acceptance: string | null; type: string | null; parentId: number | null; parentReason: string | null; /** Why it is a plain draft, in plain words. */ note: string | null; ranAt: string | null };

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
  weekFeatures: { clientKey: string; itemId: number; title: string; url: string | null; slots: WeekFeature["slots"]; level: WeekFeature["level"]; tier: WeekFeature["tier"]; estimate: number | null; size?: WeekFeature["size"]; parentId?: number | null; position: number | null; doneAt: ZonedStamp | null }[];
};

/** Committed plans for the days of a week, for the checklist on the week view. */
/** Step 16.2: closedOutAt too, for the ✓ on Today's Close out mode on any day of the week. */
export type PlanWeek = Record<IsoDate, { committedAt: ZonedStamp | null; closedOutAt?: ZonedStamp | null; picks: Pick[] }>;

/** E2: S 1h, M 2h, L 4h, fixed for everyone (plan/estimate.ts). Nothing above L: split it first. */
export const SIZE_MINUTES: Readonly<Record<Size, number>> = STORY_MINUTES;
/** A pick's minutes by its size: 2h when unsized (Timebox my day, fit and budgets alike). */
export const sizeMinutes = (size: Size | null | undefined, sizes: Readonly<Record<Size, number>> = SIZE_MINUTES) => (size ? sizes[size] : UNSIZED_MINUTES);
/**
 * PL-1: the minutes a pick needs: zero when its DevOps item is resolved, closed or removed (it shows as done), its own
 * minutes when it has them (a Watching check-in's 30), else its size (unsized as M, as before).
 */
export const pickNeed = (p: { size: string | null; minutes?: number | null; resolved?: boolean }, sizes: Readonly<Record<string, number>>): number => (p.resolved ? 0 : (p.minutes ?? sizes[p.size ?? "M"] ?? 0));
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
  /** E2: a feature's estimate in minutes (whole hours), or null for 4h (its stories on the list win once one is sized); null for a story. */
  estimate: number | null;
  /** Step 16.4: a story's size (S, M or L); null for a feature. */
  size: "S" | "M" | "L" | null;
  /** Step 16.4: a story's parent feature in DevOps, when known (nests it under that feature on the list). */
  parentId: number | null;
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

/** PL-1: a feature I'm keeping moving this week without doing its stories, with its check-in reservation. */
export type WeekWatch = {
  weekStart: IsoDate;
  clientKey: string;
  itemId: number;
  title: string;
  itemType: string | null;
  url: string | null;
  why: "owner" | "lead" | "chosen";
  /** The check-in's half-day and minutes; minutes null: removed (the row stays). */
  checkin: { date: IsoDate; half: "AM" | "PM"; minutes: number } | null;
  /** The pick it became once that day was planned or opened; null before. */
  checkinPickId: number | null;
};
/** PL-1: a decision on a "From last week" row. */
export type CarryDecisionRow = { clientKey: string; itemId: number; kind: string; decision: "kept" | "dropped" | "watching"; decidedAt: ZonedStamp };

export type WeekPlanRecord = { weekStart: IsoDate; committedAt: ZonedStamp | null; /** The latest change to the plan or its features. */ updatedAt: ZonedStamp | null; features: WeekFeature[] };

/** How a follow-up was closed (step 13.5), optional. */
export const CLOSE_HOW = ["teams", "email", "devops", "call"] as const;
export type CloseHow = (typeof CLOSE_HOW)[number];
/** Why FocusTime opened a heads-up: the trigger, the items, when (step 13.5). */
export type FollowUpOrigin = { trigger: string; items: { itemId: number | null; title: string }[]; at: string };
