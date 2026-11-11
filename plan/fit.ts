// Fit while planning (step 15, D266): picks against a block's whole free time. Pure. QT-2: no fit words are left
// here ("Fits", "Room for …", "About 2h over" went with their last screens); callers say free time instead.
// Check-in alone compares against the time left (capacityMinutes with now); everything else uses this.
import type { SizeScale } from "./estimate.ts";
import { freeMinutes } from "../week/free.ts";
import type { FreeGap, IsoDate } from "../week/types.ts";
import { fitOf, type Fit } from "./rules.ts";
import { slotPlanned } from "./timebox.ts";

type PickLike = { id: number; status: string; size: string | null; minutes?: number | null; remainingMinutes?: number | null; resolved?: boolean };
type BoxLike = { date: IsoDate; pickId: number | null; start: string; end: string; removedAt: string | null; settled?: string | null };
type SlotLike = { date: IsoDate; start: string; end: string; pto: boolean; freeGaps: FreeGap[]; longestFreeMinutes: number };

/** Planned and done picks (timebox minutes when timed) against the block's whole free time. */
export function planFit(picks: readonly PickLike[], sizes: SizeScale, timeboxes: readonly BoxLike[] | undefined, slot: SlotLike): Fit {
  return fitOf(planMinutes(picks, sizes, timeboxes, slot), freeMinutes(slot));
}
/** Minutes of planned and done picks in a block (timed ones by their timebox). */
export function planMinutes(picks: readonly PickLike[], sizes: SizeScale, timeboxes: readonly BoxLike[] | undefined, slot: Pick<SlotLike, "date" | "start" | "end">): number {
  const live = picks.filter((p) => p.status === "planned" || p.status === "done").map((p) => ({ ...p, status: "planned", ...(p.status === "done" ? { remainingMinutes: null } : {}) })); // TX-1: done work counts its size here, as a tick always did.
  return slotPlanned(live, sizes, timeboxes, slot);
}

/** Over by this much or less counts as no more than the free time (sizes are estimates). */
export const OVER_GRACE = 10;

/** A block's kind as Add work's block choices name it (plan/addpane.ts). QT-2: no words come with it. */
export type FitWords = { kind: "none" | "fits" | "room" | "over" };

/** "45m", "1h", "1h 15m". */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/**
 * Time in plain words (step 16.4): "under an hour", "about an hour", "about 3 hours". Whole hours only, never "1h 15m"
 * or a fraction.
 */
export function aboutHours(minutes: number): string {
  if (minutes < 45) return "under an hour";
  if (minutes < 90) return "about an hour";
  return `about ${Math.round(minutes / 60)} hours`;
}
