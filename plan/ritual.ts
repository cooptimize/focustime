// Which ritual the one Plan button opens (step 10): Plan the day in the morning, Check-in midday, Close out near the
// end of the day, Plan the week while a weekly nudge is active. Pure; times are "HH:MM" in the configured zone.
import { toMin, type Hm } from "../week/hours.ts";

export type Ritual = "planday" | "checkin" | "closeout" | "planweek";
export type RitualReason = "week_nudge" | "morning" | "not_planned" | "midday" | "end_of_day" | "next_workday";

export type RitualInput = {
  /** Now, local time. */
  time: Hm;
  today: {
    /** Has working hours and isn't PTO. */
    workday: boolean;
    /** Where the morning ends (the lunch start or the middle of the day); null without hours. */
    amEnd: Hm | null;
    /** End of the working day (its last span); null without hours. */
    end: Hm | null;
    committed: boolean;
    closedOut: boolean;
  };
  /** A Plan the week nudge is active (the week it asked for isn't committed). */
  weekNudge: boolean;
  /** Settings > Planning: the Close out reminder, minutes before the end of the day. */
  closeoutLeadMinutes: number;
};

/** The last hour of the day counts as "near the end", or longer when the Close out reminder is set earlier. */
export const END_WINDOW_MINUTES = 60;

export function ritualFor(i: RitualInput): { ritual: Ritual; reason: RitualReason } {
  if (i.weekNudge) return { ritual: "planweek", reason: "week_nudge" };
  const t = i.today;
  if (!t.workday || !t.end || t.closedOut) return { ritual: "planday", reason: "next_workday" };
  const now = toMin(i.time);
  if (now >= toMin(t.end) - Math.max(END_WINDOW_MINUTES, i.closeoutLeadMinutes)) return { ritual: "closeout", reason: "end_of_day" };
  if (t.amEnd && now < toMin(t.amEnd)) return { ritual: "planday", reason: "morning" };
  return t.committed ? { ritual: "checkin", reason: "midday" } : { ritual: "planday", reason: "not_planned" };
}

export const RITUAL_NAMES: Record<Ritual, string> = { planday: "Plan the day", checkin: "Check-in", closeout: "Close out", planweek: "Plan the week" };
