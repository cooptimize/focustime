// AH-5: the date picker's rules, pure. Typed dates ("nov 20", "11/20", "2026-11-20", "20 nov", "today"), the quick
// picks (Today, Tomorrow, Next Monday, +1 week, Clear) and the month grid (weeks start on Monday).

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (w: string): number | null => {
  const i = MONTHS.findIndex((m) => w.toLowerCase().startsWith(m));
  return i >= 0 ? i + 1 : null;
};
const make = (y: number, m: number, d: number): string | null => {
  try {
    return Temporal.PlainDate.from({ year: y, month: m, day: d }, { overflow: "reject" }).toString();
  } catch {
    return null;
  }
};

/**
 * A typed date as YYYY-MM-DD, or null when it can't be read. Without a year: this year, unless that day is more than
 * 60 days ago, then next year ("jan 5" typed in November means next January). Two-digit years are 20xx.
 */
export function parseTypedDate(text: string, today: string): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  const now = Temporal.PlainDate.from(today);
  if (t === "today") return now.toString();
  if (t === "tomorrow") return now.add({ days: 1 }).toString();
  const year = (y: string | undefined, m: number, d: number): string | null => {
    if (y !== undefined) return make(y.length === 2 ? 2000 + Number(y) : Number(y), m, d);
    const here = make(now.year, m, d);
    if (!here) return null;
    return Temporal.PlainDate.compare(Temporal.PlainDate.from(here), now.subtract({ days: 60 })) < 0 ? make(now.year + 1, m, d) : here;
  };
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (x) return make(Number(x[1]), Number(x[2]), Number(x[3]));
  x = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (x) return year(x[3], Number(x[1]), Number(x[2]));
  x = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}|\d{2}))?$/.exec(t);
  if (x && monthOf(x[1]!)) return year(x[3], monthOf(x[1]!)!, Number(x[2]));
  x = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.?(?: (\d{4}|\d{2}))?$/.exec(t);
  if (x && monthOf(x[2]!)) return year(x[3], monthOf(x[2]!)!, Number(x[1]));
  return null;
}

export type QuickPick = { key: "today" | "tomorrow" | "monday" | "week" | "clear"; label: string; date: string | null };

/** The quick picks. +1 week is a week after the value being edited, or after today when there's none. */
export function quickPicks(today: string, value: string | null): QuickPick[] {
  const t = Temporal.PlainDate.from(today);
  const monday = t.add({ days: 8 - t.dayOfWeek });
  const base = value ? Temporal.PlainDate.from(value) : t;
  return [
    { key: "today", label: "Today", date: t.toString() },
    { key: "tomorrow", label: "Tomorrow", date: t.add({ days: 1 }).toString() },
    { key: "monday", label: "Next Monday", date: monday.toString() },
    { key: "week", label: "+1 week", date: base.add({ weeks: 1 }).toString() },
    { key: "clear", label: "Clear", date: null },
  ];
}

/** The month's weeks, Monday first, each day with whether it's in the month. Always 6 rows, so the box doesn't jump. */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[][] {
  const first = Temporal.PlainDate.from({ year, month, day: 1 });
  const start = first.subtract({ days: first.dayOfWeek - 1 });
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: { date: string; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const day = start.add({ days: w * 7 + d });
      row.push({ date: day.toString(), inMonth: day.month === month });
    }
    weeks.push(row);
  }
  return weeks;
}

/** "Mon, Nov 16" (the year when it isn't this year's). */
export function dayText(date: string, today: string): string {
  const d = Temporal.PlainDate.from(date);
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.year !== Temporal.PlainDate.from(today).year ? { year: "numeric" } : {}) });
}
