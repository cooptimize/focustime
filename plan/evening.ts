// WK-3: what Week shows after a weekday's afternoon (the Evening band) and on a weekend day (its quiet column). Pure.
//  - The Evening band, under PM on a weekday with no evening card of its own: the calendar items after the cards' hours
//    (day.evening), the to-dos in the evening (half EVE) and Deployments whose window starts at or after the day shape's
//    end. Empty: no band at all.
//  - A weekend column: every timed calendar item and every planned or done to-do of that date, in time order (a
//    Deployment by its window; a to-do with no time after the timed ones), and the promises due that day.
import type { Pick } from "./types.ts";
import { toMin } from "../week/hours.ts";
import type { CalEvent, Day, IsoDate, Week } from "../week/types.ts";

const live = (p: Pick) => p.status === "planned" || p.status === "done";

/** The end of a day's shape: its own working span, else the week's latest one, else 17:00 (Friday has none). */
export function shapeEnd(day: Day, week: Week): string {
  if (day.hours.main) return day.hours.main.end;
  const ends = week.days.map((d) => d.hours.main?.end).filter((e): e is string => !!e).sort();
  return ends.at(-1) ?? "17:00";
}

export type EveningBand = { events: CalEvent[]; picks: Pick[] };

/** The Evening band of a weekday, or null when it has nothing (the band is hidden) or the day has its own evening card. */
export function eveningBand(day: Day, week: Week, picks: readonly Pick[]): EveningBand | null {
  if (day.kind === "weekend" || day.eve) return null;
  const end = toMin(shapeEnd(day, week));
  const mine = picks.filter((p) => p.date === day.date && live(p) && (p.window ? toMin(p.window.start) >= end : p.half === "EVE"));
  const events = day.evening.map((p) => p.event);
  if (!mine.length && !events.length) return null;
  return { events, picks: sortByTime(mine) };
}

/** Pick ids the Evening band holds (so the PM card and Friday's catch-up cell don't list them twice). */
export const bandIds = (b: EveningBand | null) => new Set((b?.picks ?? []).map((p) => p.id));

/** Deployments by window start first, then the rest as planned. */
export function sortByTime(picks: readonly Pick[]): Pick[] {
  return [...picks].sort((a, b) => (a.window && b.window ? toMin(a.window.start) - toMin(b.window.start) : a.window ? -1 : b.window ? 1 : a.position - b.position));
}

/** A weekend day's rows: its calendar items (timed and all-day apart), its to-dos and the promises due that day. */
export function weekendRows<F extends { due: IsoDate | null }>(day: Day, picks: readonly Pick[], followUps: readonly F[]): { events: CalEvent[]; picks: Pick[]; due: F[] } {
  const seen = new Set<string>();
  const events = [...day.early, ...day.am.events, ...day.pm.events, ...(day.eve?.events ?? []), ...day.evening]
    .map((p) => p.event)
    .filter((e) => !seen.has(e.id) && !!seen.add(e.id))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { events, picks: sortByTime(picks.filter((p) => p.date === day.date && live(p))), due: followUps.filter((f) => f.due === day.date) };
}
