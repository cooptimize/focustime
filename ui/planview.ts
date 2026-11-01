// The committed plan as the week view sees it: picks per day, and ticking one done (local status only).
import { createContext, useContext } from "react";
import { liveFocused } from "../plan/focus.ts";
import { SIZE_MINUTES, type Pick, type PlanWeek, type Size } from "../plan/types.ts";
import type { Half, IsoDate, Slot, WorkItem } from "../week/types.ts";
import { capacityMinutes, fitOf, plannedMinutes, type Fit } from "../plan/rules.ts";

/**
 * `sizes`: minutes per pick size from Settings > Planning (step 6c). `focused`: seconds per pick from the focus log,
 * with the running timer and the clock so a live session counts as it goes (step 6d).
 */
export type PlanView = {
  week: PlanWeek | null;
  toggle: (id: number, done: boolean) => void;
  sizes: Readonly<Record<Size, number>>;
  focused: Readonly<Record<number, number>>;
  timer: { pickId: number | null; runningSince: string | null } | null;
  nowMs: number;
};
export const PlanCtx = createContext<PlanView>({ week: null, toggle: () => {}, sizes: SIZE_MINUTES, focused: {}, timer: null, nowMs: 0 });

/** Seconds focused on a pick, live while its session runs. */
export function useFocused(): (id: number) => number {
  const v = useContext(PlanCtx);
  return (id) => liveFocused(id, v.focused, v.timer, v.nowMs);
}

/** "about 1 h" for a size's minutes. */
export function sizeNote(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `about ${h ? `${h} h` : ""}${h && m ? " " : ""}${m ? `${m} min` : ""}`;
}

/** The checklist for a half-day: shown once the day is committed; planned and done picks only. */
export function checklistFor(week: PlanWeek | null, date: IsoDate, half: Half): Pick[] {
  const day = week?.[date];
  if (!day?.committedAt) return [];
  return day.picks.filter((p) => p.half === half && (p.status === "planned" || p.status === "done"));
}

/** How many work items a card lists before "+N more". */
export const CARD_ITEMS = 3;

export type CardPlan = {
  /** The committed picks (empty before commit: the card keeps its step 6 look). */
  picks: Pick[];
  /** How the picks still to do fit the block's free time; null with none left to do. */
  fit: Fit | null;
  /** The block's DevOps items, without the ones already picked here. */
  items: WorkItem[];
  /** Committed: the list starts collapsed behind "+N more items". */
  collapsed: boolean;
};

/**
 * A card's plan (step 6.1). Once the day is committed: its picks, their fit against the block's free time
 * (capacity from now on, the same number Plan the day uses), the DevOps list without items picked here, and
 * that list collapsed. Before commit: no picks, every item, not collapsed (unchanged).
 */
export function cardPlan(week: PlanWeek | null, slot: Slot, clientKey: string | null, items: readonly WorkItem[], now: string, sizes: Readonly<Record<Size, number>> = SIZE_MINUTES): CardPlan {
  const picks = checklistFor(week, slot.date, slot.half);
  if (!week?.[slot.date]?.committedAt) return { picks: [], fit: null, items: [...items], collapsed: false };
  const picked = new Set(picks.filter((p) => p.kind === "item" && p.clientKey === clientKey && p.itemId !== null).map((p) => p.itemId));
  return {
    picks,
    // Fit only matters while something is left to do: all done shows no pill (not "nothing picked").
    // A block that has ended has no time left to fit anything into, so no fit is shown (Plan any day).
    fit: picks.some((p) => p.status === "planned") && Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(slot.end)) < 0 ? fitOf(plannedMinutes(picks, sizes), capacityMinutes(slot, now)) : null,
    items: items.filter((i) => !picked.has(i.id)),
    collapsed: true,
  };
}
