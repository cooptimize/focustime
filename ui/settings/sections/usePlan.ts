// SA-2: the [plan] keys a section edits (Day and Week, Focus, Clients): each form saves only its own (the server takes
// any subset). The Undo message names the field by its registry label.
import type { FormProps } from "./types.ts";
import { useAutoSave } from "../autosave.tsx";
import { labelBy } from "./shared.ts";

export type PlanValues = {
  unsizedMinutes: number; minS: number; minM: number; minL: number; carryDays: number; reminderOffsetMinutes: number; focusMinutes: number; breakMinutes: number; endSound: boolean;
  devopsOnDone: "ask" | "never"; progressOffer: boolean; suggest: boolean; followGraceDays: number; closeoutReminderMinutes: number; checkinReminderMinutes: number; weekNudgeThu: string; weekNudgeFri: string; weekNudgeMon: string;
};

const PLAN_IDS: Record<keyof PlanValues, string> = {
  unsizedMinutes: "count-unsized", minS: "shortest-s", minM: "shortest-m", minL: "shortest-l", carryDays: "carry-over", reminderOffsetMinutes: "plan-reminder", focusMinutes: "focus-length", breakMinutes: "break-length", endSound: "end-sound",
  devopsOnDone: "devops-on-done", progressOffer: "progress-offer", suggest: "suggest-empty-blocks", followGraceDays: "follow-grace", closeoutReminderMinutes: "closeout-reminder", checkinReminderMinutes: "checkin-reminder", weekNudgeThu: "nudge-thu", weekNudgeFri: "nudge-fri", weekNudgeMon: "nudge-mon",
};

export function usePlan<K extends keyof PlanValues>(p: FormProps, keys: readonly K[]) {
  const pl = p.data.planning;
  const all: PlanValues = {
    unsizedMinutes: pl.sizes.unsized, minS: pl.minSizes.S, minM: pl.minSizes.M, minL: pl.minSizes.L, carryDays: pl.carryDays, reminderOffsetMinutes: pl.reminderOffsetMinutes,
    focusMinutes: pl.focusMinutes, breakMinutes: pl.breakMinutes, endSound: pl.endSound, devopsOnDone: pl.devopsOnDone, progressOffer: pl.progressOffer, suggest: pl.suggest !== false, followGraceDays: pl.followGraceDays, closeoutReminderMinutes: pl.closeoutReminderMinutes,
    checkinReminderMinutes: pl.checkinReminderMinutes, weekNudgeThu: pl.weekNudgeThu, weekNudgeFri: pl.weekNudgeFri, weekNudgeMon: pl.weekNudgeMon,
  };
  return useAutoSave({
    section: "planning",
    initial: Object.fromEntries(keys.map((k) => [k, all[k]])) as Pick<PlanValues, K>,
    payload: (v) => {
      const { minS, minM, minL, ...rest } = v as Partial<PlanValues>;
      return { ...rest, ...(minS !== undefined ? { minSizes: { S: minS, M: minM, L: minL } } : {}) };
    },
    onSaved: p.onSavedData,
    label: labelBy(PLAN_IDS),
  });
}
