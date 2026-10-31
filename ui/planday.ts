// When Plan the day opens by itself, and how to notice a new day while the window stays open for days.
import type { WeekLoadData } from "../actions/types.ts";

/** Plan the day opens by itself after this local hour on a workday. */
export const AUTO_OPEN_HOUR = 5;

/**
 * Due on a workday (Mon–Thu) from 05:00 local when today isn't committed. The server then makes it
 * once per day (planday.start with auto), so a dismissed panel doesn't come back on the next focus.
 */
export function autoOpenDue(now: Temporal.ZonedDateTime, ig: WeekLoadData["planDay"]): boolean {
  return ig.available && ig.workday && !ig.committed && now.toPlainDate().toString() === ig.date && now.hour >= AUTO_OPEN_HOUR;
}

/** True when the local date has moved past the day the loaded data calls today (midnight while running). */
export function dayRolledOver(now: Temporal.ZonedDateTime, loadedToday: string): boolean {
  return Temporal.PlainDate.compare(now.toPlainDate(), Temporal.PlainDate.from(loadedToday)) > 0;
}

export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};
