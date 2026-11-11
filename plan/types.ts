// Plan layer types (step 5, Plan the day). Pure data shared by the store, actions and UI.
import type { StandardsUsed } from "./standards.ts";
import type { Half, IsoDate } from "../week/types.ts";
import type { DayAccess } from "./days.ts";
import { DEFAULT_SIZE_SCALE, storyMinutes, type SizeScale, type StorySize } from "./estimate.ts";

export type Size = StorySize;
export type PickStatus = "planned" | "done" | "moved" | "dropped";
/** What a pick points at: a DevOps item, a local draft story, or a typed intention. */
export type PickKind = "item" | "draft" | "intention";
/** WK-3 (DP-0): what kind of to-do it is, beside what it points at. Null: a plain to-do. */
export type TodoKind = "deployment";
/** WK-3: a to-do's own window on its date, local "HH:MM" in the person's zone (end up to "24:00"). */
export type TodoWindow = { start: string; end: string };
/** WK-3: a DevOps item a deployment covers (its own client's only). */
export type TodoLink = { id: number; title: string };

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
  /** E2: S, M or L, or null when not sized yet (counts as the person's assumption everywhere, SZ-1; never blocks anything). */
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
  /** TX-1: time left and spent, from check-ins (plan/progress.ts). Absent: no progress yet, the size is what's left. */
  remainingMinutes?: number | null;
  spentMinutes?: number | null;
  /** PL-1: read models only. Its DevOps item is resolved, closed or removed: counts zero minutes and shows as done. */
  resolved?: boolean;
  /** WK-3: a Deployment (absent or null: a plain to-do). */
  todoKind?: TodoKind | null;
  /** WK-3: a deployment's window on its date (required for one, absent otherwise). */
  window?: TodoWindow | null;
  /** WK-3: the DevOps items a deployment covers. */
  links?: TodoLink[] | null;
  /** DP-2: what it moves: a snapshot of the ticked items, as planned. Absent on a WK-3 deployment (its text is its note). */
  deployItems?: import("./deploy-items.ts").DeployItem[] | null;
  position: number;
  createdAt: ZonedStamp;
  updatedAt: ZonedStamp;
};

/** A local draft story for a client, under a feature or (step 9, from a capture) under none yet. */
/** A local draft story (under a feature), or since step 13.5 a draft feature (level "feature", under an epic). */
export type DraftStory = { id: number; clientKey: string; parentItemId: number | null; title: string; size: Size; level: "story" | "feature"; createdAt: ZonedStamp; /** IB-2: its last change, for the Inbox's timeline. */ updatedAt?: ZonedStamp; /** Step 15.3: written by Create in DevOps. Acceptance criteria for stories, dates for features. */ description?: string | null; acceptance?: string | null; startDate?: string | null; targetDate?: string | null; /** Step 14: set once created in DevOps (the draft then leaves draft lists). */ devopsId?: number; devopsUrl?: string | null; /** CP-1: the AI-prepared version (never my own text), or null when prepare hasn't run. */ ai?: DraftAi | null };
/** CP-1: what AI prepared for a captured draft. My own title stays the draft's until I accept this. */
export type DraftAiState = "writing" | "ready" | "needs_parent" | "off" | "failed";
export type DraftAi = { /** KB-1: "Standards used" under the draft. */ standards?: StandardsUsed | null; state: DraftAiState; title: string | null; description: string | null; acceptance: string | null; type: string | null; parentId: number | null; parentReason: string | null; /** Why it is a plain draft, in plain words. */ note: string | null; ranAt: string | null };

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
  /** WD-1: `id` is the week list row (weekplan.set_tier and weekplan.remove take it). */
  weekFeatures: { id?: number; clientKey: string; itemId: number; title: string; url: string | null; slots: WeekFeature["slots"]; level: WeekFeature["level"]; tier: WeekFeature["tier"]; estimate: number | null; size?: WeekFeature["size"]; parentId?: number | null; position: number | null; doneAt: ZonedStamp | null }[];
};

/** Committed plans for the days of a week, for the checklist on the week view. */
/** Step 16.2: closedOutAt too, for the ✓ on Today's Close out mode on any day of the week. */
export type PlanWeek = Record<IsoDate, { committedAt: ZonedStamp | null; closedOutAt?: ZonedStamp | null; picks: Pick[] }>;

/** E2, TX-1: XS 30 min, S 1h, M 2h, L 4h, fixed for everyone (plan/estimate.ts); SZ-1's default for unsized work. A person's own scale is `planning.sizes`. */
export const SIZE_MINUTES: SizeScale = DEFAULT_SIZE_SCALE;
/** A pick's minutes by its size, or the person's assumption when unsized (Timebox my day, fit and budgets alike). */
export const sizeMinutes = (size: Size | null | undefined, sizes: SizeScale) => storyMinutes(size, sizes);
/**
 * PL-1: the minutes a pick needs: zero when its DevOps item is resolved, closed or removed (it shows as done); TX-1: the
 * time left once a check-in has said; its own minutes when it has them (a Watching check-in's 30), else its size (or the
 * person's assumption when unsized).
 */
export const pickNeed = (p: { size: string | null; minutes?: number | null; remainingMinutes?: number | null; resolved?: boolean }, sizes: SizeScale): number => (p.resolved ? 0 : (p.remainingMinutes ?? p.minutes ?? storyMinutes(p.size, sizes)));
export const SIZES: readonly Size[] = ["XS", "S", "M", "L"];
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
  /** Step 16.4: a story's size (XS, S, M or L); null for a feature. */
  size: Size | null;
  /** TX-1: time left on a story, from its to-dos' check-ins; absent: none yet. */
  remainingMinutes?: number | null;
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
