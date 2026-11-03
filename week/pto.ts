// PTO from Dataverse Time Off Tracker rows, per day. Pure: rows in, PTO days out. No I/O.
// Every Dataverse PTO day is a whole day off (D105): hours are not read. Detail rows (one per day) win; a tracker with
// no detail rows covers every weekday from its start to its end date (D109). A half-day comes from Outlook (S1, D453):
// out-of-office time covering all of a half's working hours makes that half PTO (week/build.ts).
import type { IsoDate } from "./types.ts";

/** A Time Off Tracker row as read (only the fields FocusTime selects). */
export type PtoTrackerRow = {
  coop_timeofftrackerid: string;
  coop_timeoffstartdate: string | null;
  coop_enddate: string | null;
  coop_title: string | null;
};

/** A Time Off Tracker Detail row: one day of a tracker. */
export type PtoDetailRow = {
  _coop_timeofftracker_value: string | null;
  coop_date: string | null;
};

/** The columns FocusTime reads, per table (selected or filtered on). A missing one is reported by name (D108). */
export const PTO_TRACKER_COLUMNS = ["coop_timeofftrackerid", "coop_timeoffstartdate", "coop_enddate", "coop_title"] as const;
export const PTO_TRACKER_FILTER_COLUMNS = ["_coop_employee_value", "statecode"] as const;
export const PTO_DETAIL_COLUMNS = ["_coop_timeofftracker_value", "coop_date"] as const;
export const PTO_DETAIL_FILTER_COLUMNS = ["statecode"] as const;

/** One PTO entry for one day (one tracker). */
export type PtoEntry = { date: IsoDate; title: string; trackerId: string };

/** A PTO day: the whole day is off, or only one half when `half` is set (S1, D453). */
export type PtoDay = { date: IsoDate; titles: string[]; half?: "AM" | "PM" };

/** The title an out-of-office half-day or day shows (the event's own title is never shown as PTO). */
export const OOF_TITLE = "Out of office";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isWeekday = (d: Temporal.PlainDate) => d.dayOfWeek <= 5;

/**
 * PTO entries per tracker and day. A tracker with detail rows is off on each of those dates (a duplicate date
 * counts once). A tracker with none is off on every weekday from its start to its end date (Date Only,
 * inclusive; no end date means the start day only). Rows with unreadable dates are skipped and counted.
 */
export function ptoEntries(trackers: readonly PtoTrackerRow[], details: readonly PtoDetailRow[]): { entries: PtoEntry[]; skipped: number } {
  const entries: PtoEntry[] = [];
  let skipped = 0;
  for (const t of trackers) {
    const id = t.coop_timeofftrackerid?.toLowerCase();
    if (!id) {
      skipped++;
      continue;
    }
    const title = t.coop_title?.trim() || "PTO";
    const mine = details.filter((d) => d._coop_timeofftracker_value?.toLowerCase() === id);
    if (mine.length) {
      const dates = new Set<IsoDate>();
      for (const d of mine) {
        if (!d.coop_date || !DATE.test(d.coop_date)) skipped++;
        else dates.add(d.coop_date);
      }
      for (const date of dates) entries.push({ date, title, trackerId: id });
      continue;
    }
    if (!t.coop_timeoffstartdate || !DATE.test(t.coop_timeoffstartdate)) {
      skipped++;
      continue;
    }
    const start = Temporal.PlainDate.from(t.coop_timeoffstartdate);
    const end = t.coop_enddate && DATE.test(t.coop_enddate) ? Temporal.PlainDate.from(t.coop_enddate) : start;
    if (Temporal.PlainDate.compare(end, start) < 0 || start.until(end).days > 366) {
      skipped++;
      continue;
    }
    for (let d = start; Temporal.PlainDate.compare(d, end) <= 0; d = d.add({ days: 1 })) {
      if (isWeekday(d)) entries.push({ date: d.toString(), title, trackerId: id });
    }
  }
  return { entries, skipped };
}

/** PTO days keyed by date, only for the dates asked for. Several trackers on one day list every title. */
export function ptoByDate(entries: readonly PtoEntry[], dates: readonly IsoDate[]): Record<IsoDate, PtoDay> {
  const out: Record<IsoDate, PtoDay> = {};
  for (const date of dates) {
    const here = entries.filter((e) => e.date === date);
    if (here.length) out[date] = { date, titles: [...new Set(here.map((e) => e.title))] };
  }
  return out;
}
