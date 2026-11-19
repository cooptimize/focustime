// One day's own hours (hours.set_day), as Week's day menu saves them and as Settings' Most used does on the phone (SA-5):
// a main span, an optional evening span and an optional lunch. A part left empty is left out.
import type { IsoDate } from "../week/types.ts";

export type DayHoursFields = { start?: string; end?: string; lunchStart?: string; lunchEnd?: string; eveStart?: string; eveEnd?: string };

export function dayHoursInput(date: IsoDate, v: DayHoursFields): { date: IsoDate; segments: string[]; lunch: string } {
  const segments = [v.start && v.end ? `${v.start}-${v.end}` : null, v.eveStart && v.eveEnd ? `${v.eveStart}-${v.eveEnd}` : null].filter((x): x is string => !!x);
  return { date, segments, lunch: v.lunchStart && v.lunchEnd ? `${v.lunchStart}-${v.lunchEnd}` : "" };
}
