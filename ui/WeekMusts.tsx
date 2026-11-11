// The week's list per client (step 11) with how each item is done (DevOps state, local done marks and done picks), and
// the Board's budget. CF-1: no musts, so no musts progress or "Still realistic?" question.
import type { WeekLoadData } from "../actions/types.ts";
import { planBudget } from "../plan/weekplan.ts";
import { resolvedOf } from "../plan/carry.ts";
import type { WeekFeature } from "../plan/types.ts";
import { pickDoneFrom, weekList } from "../plan/weeklist.ts";
import type { IsoDate } from "../week/types.ts";


/** The week's list and (when the loaded week is that week) its budget per client. */
export function weekMusts(data: WeekLoadData, weekStart: IsoDate, _now: string | null = null) {
  const features = data.weekFeatures.filter((f) => f.weekStart === weekStart);
  const loaded = data.weekStart === weekStart;
  const list = weekList(features, data.devops, data.planning.sizes, [], loaded ? pickDoneFrom(data.plan) : undefined, resolvedOf(loaded ? data.planBits : null));
  // PL-1: the same budget as Commit (planBudget), so the two never disagree.
  const fits = loaded ? boardFits(data, features) : [];
  return { items: list.items, fits };
}

/** PL-1: the Board's budget for the loaded week: planBudget on that week's list. */
export const boardFits = (data: WeekLoadData, features: readonly WeekFeature[]) => planBudget(data.week, features, { sizes: data.planning.sizes, borrowed: data.borrowed, weekStart: data.weekStart, work: data.devops, bits: data.planBits, planShare: data.guidance?.planShare });
/** PL-1: Commit's budget for the loaded week: planBudget on its list plus the draft features typed there. */
export const commitFits = (data: WeekLoadData, features: readonly WeekFeature[], drafts: readonly WeekFeature[] = []) => planBudget(data.week, [...features, ...drafts], { sizes: data.planning.sizes, borrowed: data.borrowed, weekStart: data.weekStart, work: data.devops, bits: data.planBits, planShare: data.guidance?.planShare });
