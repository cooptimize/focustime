// SR-3: Cooptimize's observed holidays from Dataverse's Working Days Calendar (coop_workingdayscalendar), as AS-3
// found it: one row per calendar day; `coop_observedholidayflag` (Holiday Observed, Yes/No), `coop_date` (DateOnly)
// and `coop_holidayname` (Holiday Name). Pure: the rows in, the days off out.

/** The only columns read. */
export const HOLIDAY_COLUMNS = ["coop_date", "coop_holidayname", "coop_observedholidayflag"] as const;
export type HolidayRow = { coop_date?: unknown; coop_holidayname?: unknown; coop_observedholidayflag?: unknown };
/** One observed holiday: its date exactly as the table has it, and its name (null when the row has none). */
export type HolidayDay = { date: string; name: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * The observed holidays in [from, to]: Holiday Observed = Yes only (the query asks for that too; a row saying No is
 * dropped here as well), on exactly `coop_date` (never moved to a traditional date), one per date, sorted.
 */
export function holidayDays(rows: readonly HolidayRow[], from: string, to: string): HolidayDay[] {
  const out = new Map<string, HolidayDay>();
  for (const r of rows) {
    if (r.coop_observedholidayflag !== true) continue;
    const raw = typeof r.coop_date === "string" ? DATE.exec(r.coop_date)?.[0] : undefined;
    if (!raw || raw < from || raw > to) continue;
    const name = typeof r.coop_holidayname === "string" && r.coop_holidayname.trim() ? r.coop_holidayname.trim().slice(0, 80) : null;
    if (!out.has(raw) || (!out.get(raw)!.name && name)) out.set(raw, { date: raw, name });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** How a holiday reads in "Upcoming PTO and Holidays": "<Holiday Name> (observed)", or "Holiday" when unnamed. */
export const holidayLabel = (h: Pick<HolidayDay, "name">) => (h.name ? `${h.name} (observed)` : "Holiday");
