// WK-5: which days Week shows, the one note about hidden days, the arrow keys over shown days, the day in focus and
// the order days fold in when the grid can't give every shown day its narrowest readable width. Pure.
// Days are told apart by their kind in the week model (overflow, weekend), never by a weekday's name.
import type { IsoDate } from "../week/types.ts";

export type DayLite = { date: IsoDate; kind: "work" | "overflow" | "weekend"; weekday: string };

/** The person's own two settings ([ui] show_catch_up_day, show_weekend_days), both on by default. */
export type ShowDays = { catchUp: boolean; weekend: boolean };
export const SHOW_ALL: ShowDays = { catchUp: true, weekend: true };

/** Whether this day is hidden by the settings (a weekend day shown only appears when something is on it: the model's job). */
export function hiddenBy(day: Pick<DayLite, "kind">, show: ShowDays): boolean {
  return (day.kind === "overflow" && !show.catchUp) || (day.kind === "weekend" && !show.weekend);
}

/**
 * Per day, whether Week shows it. `reveal`: the note's Show, for this visit to Week (the setting is unchanged). A hidden
 * day stays hidden when it has to-dos on it or is today; the note says so.
 */
export function shownDays(days: readonly Pick<DayLite, "kind">[], show: ShowDays, reveal = false): boolean[] {
  return days.map((d) => reveal || !hiddenBy(d, show));
}

/** A date's full weekday ("Friday"), for menus and screen readers. */
export const longWeekday = (date: IsoDate): string => Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" });

/** The week's catch-up day by its full name ("Friday"), for "Show Friday"; "catch-up day" in a week without one. */
export const catchUpWord = (days: readonly DayLite[]): string => {
  const d = days.find((x) => x.kind === "overflow");
  return d ? longWeekday(d.date) : "catch-up day";
};

/** The short weekday Week's headers use ("Fri"). */
const short = (d: DayLite) => d.weekday.slice(0, 3);

/**
 * The quiet note on Week's sub-line when a hidden day has to-dos or promises due on it, or is today: "Fri hidden · 2
 * to-dos", "Today (Fri) is hidden", "Fri, Sat, Sun hidden · 3 to-dos · 1 promise due". Null when no hidden day has
 * any. `open(date)`: the day's open (planned) to-dos; `due(date)`: the open promises due that day.
 */
export function hiddenNote(days: readonly DayLite[], shown: readonly boolean[], today: IsoDate, open: (date: IsoDate) => number, due: (date: IsoDate) => number = () => 0): string | null {
  const hidden = days.filter((d, i) => !shown[i] && (d.date === today || open(d.date) > 0 || due(d.date) > 0));
  if (!hidden.length) return null;
  const todayDay = hidden.find((d) => d.date === today);
  const others = hidden.filter((d) => d !== todayDay);
  const count = hidden.reduce((n, d) => n + open(d.date), 0);
  const promises = hidden.reduce((n, d) => n + due(d.date), 0);
  return [
    todayDay ? `Today (${short(todayDay)}) is hidden` : "",
    others.length ? `${others.map(short).join(", ")} hidden` : "",
    count ? `${count} to-do${count === 1 ? "" : "s"}` : "",
    promises ? `${promises} promise${promises === 1 ? "" : "s"} due` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * The arrow keys over Week's days: the next shown day in `dir` from `from`, skipping hidden ones; `from` itself when
 * there is none that way (and `from` is shown), else the nearest shown day. -1 when nothing is shown.
 */
export function stepShown(shown: readonly boolean[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < shown.length; i += dir) if (shown[i]) return i;
  if (shown[from]) return from;
  for (let k = 1; k < shown.length; k++) {
    if (shown[from - dir * k]) return from - dir * k;
    if (shown[from + dir * k]) return from + dir * k;
  }
  return -1;
}

/**
 * The day in focus: the open block's day while the block panel is open; else a folded day the person opened (`chosen`);
 * else today when the week has it; else none (-1), and working days share the width as before. A hidden day is never
 * the focus day (the next one in that list is).
 */
export function focusIndex(days: readonly DayLite[], shown: readonly boolean[], at: { panel: IsoDate | null; chosen: IsoDate | null; today: IsoDate }): number {
  for (const date of [at.panel, at.chosen, at.today]) {
    if (!date) continue;
    const i = days.findIndex((d) => d.date === date);
    if (i >= 0 && shown[i]) return i;
  }
  return -1;
}

/**
 * The order shown days fold in when they don't fit: weekend days, the catch-up day, past days farthest from the focus
 * day, then future days farthest from it (today counts as future). The focus day never folds. With no focus day, past
 * days fold from the earliest and future days from the latest. Only shown days (indices into `days`).
 */
export function foldOrder(days: readonly DayLite[], shown: readonly boolean[], focus: number, today: IsoDate): number[] {
  const idx = days.map((_, i) => i).filter((i) => shown[i] && i !== focus);
  const far = (i: number) => (focus >= 0 ? Math.abs(i - focus) : 0);
  const byKind = (k: DayLite["kind"]) => idx.filter((i) => days[i]!.kind === k).sort((a, b) => far(b) - far(a) || b - a);
  const work = idx.filter((i) => days[i]!.kind === "work");
  const past = work.filter((i) => days[i]!.date < today).sort((a, b) => far(b) - far(a) || a - b);
  const future = work.filter((i) => days[i]!.date >= today).sort((a, b) => far(b) - far(a) || b - a);
  return [...byKind("weekend"), ...byKind("overflow"), ...past, ...future];
}
