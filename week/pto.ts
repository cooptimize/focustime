// PTO from Dataverse Time Off Tracker rows, per day. Pure: rows in, PTO days out. No I/O.
// Detail rows (one per day) win; a tracker with no detail rows is spread over its weekdays.
import type { IsoDate } from "./types.ts";

/** A Time Off Tracker row as read (only the fields Coopilot selects). */
export type PtoTrackerRow = {
  coop_timeofftrackerid: string;
  coop_timeoffstartdate: string | null;
  coop_enddate: string | null;
  coop_timeoffhours: number | null;
  coop_title: string | null;
};

/** A Time Off Tracker Detail row: one day of a tracker. coop_hours is text in Dataverse. */
export type PtoDetailRow = {
  _coop_timeofftracker_value: string | null;
  coop_date: string | null;
  coop_hours: string | null;
};

/** One PTO entry for one day (one tracker). */
export type PtoEntry = { date: IsoDate; minutes: number; title: string; trackerId: string };

/** PTO on one day: all entries summed, capped at the working day. */
export type PtoDay = {
  date: IsoDate;
  minutes: number;
  /** The whole working day is off. */
  full: boolean;
  titles: string[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "8", "4.5", "4,5", "4:30", "4h", " 2 " → minutes. Anything else (or out of range) → null. */
export function parseHours(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= 24 ? Math.round(v * 60) : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\s*(h|hr|hrs|hours?)$/, "");
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) {
    const total = Number(m[1]) * 60 + Number(m[2]);
    return total <= 24 * 60 ? total : null;
  }
  m = s.match(/^(\d{1,2})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const h = Number(`${m[1]}.${m[2] ?? "0"}`);
  return h <= 24 ? Math.round(h * 60) : null;
}

const isWeekday = (d: Temporal.PlainDate) => d.dayOfWeek <= 5;

/**
 * PTO entries per tracker and day. Detail rows are used when a tracker has any: duplicates for the same
 * day count once (the larger), unparseable hours are skipped. A tracker with no detail rows covers its
 * weekdays from start to end date (inclusive, Date Only): with total hours, whole days are filled in
 * order until the hours run out; without hours, every weekday is a full day.
 */
export function ptoEntries(trackers: readonly PtoTrackerRow[], details: readonly PtoDetailRow[], dayMinutes: number): { entries: PtoEntry[]; skipped: number } {
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
      const perDay = new Map<IsoDate, number>();
      for (const d of mine) {
        const minutes = parseHours(d.coop_hours);
        if (!d.coop_date || !DATE.test(d.coop_date) || minutes === null) {
          skipped++;
          continue;
        }
        if (minutes === 0) continue;
        perDay.set(d.coop_date, Math.max(perDay.get(d.coop_date) ?? 0, minutes));
      }
      for (const [date, minutes] of perDay) entries.push({ date, minutes, title, trackerId: id });
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
    let left = t.coop_timeoffhours === null ? Infinity : parseHours(t.coop_timeoffhours) ?? Infinity;
    for (let d = start; Temporal.PlainDate.compare(d, end) <= 0 && left > 0; d = d.add({ days: 1 })) {
      if (!isWeekday(d)) continue;
      const minutes = Math.min(dayMinutes, left);
      entries.push({ date: d.toString(), minutes, title, trackerId: id });
      left -= minutes;
    }
  }
  return { entries, skipped };
}

/** PTO days keyed by date, only for the dates asked for. Several trackers on one day add up, capped at the working day. */
export function ptoByDate(entries: readonly PtoEntry[], dates: readonly IsoDate[], dayMinutes: number): Record<IsoDate, PtoDay> {
  const out: Record<IsoDate, PtoDay> = {};
  for (const date of dates) {
    const here = entries.filter((e) => e.date === date);
    if (!here.length) continue;
    const minutes = Math.min(dayMinutes, here.reduce((s, e) => s + e.minutes, 0));
    out[date] = { date, minutes, full: minutes >= dayMinutes, titles: [...new Set(here.map((e) => e.title))] };
  }
  return out;
}

/**
 * Where partial PTO comes off a day's two halves. The time of day isn't recorded, so it is taken from the
 * afternoon first, then the morning (decision D99). Full PTO takes both halves whole.
 */
export function ptoSplit(pto: PtoDay | undefined, amMinutes: number, pmMinutes: number): { am: number; pm: number } {
  if (!pto) return { am: 0, pm: 0 };
  if (pto.full) return { am: amMinutes, pm: pmMinutes };
  const pm = Math.min(pmMinutes, pto.minutes);
  return { am: Math.min(amMinutes, pto.minutes - pm), pm };
}
