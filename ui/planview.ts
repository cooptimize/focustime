// The committed plan as the week view sees it: picks per day, and ticking one done (local status only).
import { createContext } from "react";
import type { Pick, PlanWeek } from "../plan/types.ts";
import type { Half, IsoDate } from "../week/types.ts";

export type PlanView = { week: PlanWeek | null; toggle: (id: number, done: boolean) => void };
export const PlanCtx = createContext<PlanView>({ week: null, toggle: () => {} });

/** The checklist for a half-day: shown once the day is committed; planned and done picks only. */
export function checklistFor(week: PlanWeek | null, date: IsoDate, half: Half): Pick[] {
  const day = week?.[date];
  if (!day?.committedAt) return [];
  return day.picks.filter((p) => p.half === half && (p.status === "planned" || p.status === "done"));
}
