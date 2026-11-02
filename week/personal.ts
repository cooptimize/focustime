import type { CalEvent, Day, PlacedEvent, Slot, Week } from "./types.ts";

/**
 * U5.1 (D408): the Personal events switch. Personal (Google) events left out of what Week and Today draw: all-day
 * chips, the early and late lines, the rails, timelines and rows. Only the drawing: risks, free gaps, fit and
 * longest-free numbers are the server's and stay as they are, so a hidden event still counts and still names a risk.
 */
export function hidePersonal(week: Week): Week {
  const keep = (p: PlacedEvent) => !p.event.isPersonal;
  const slot = (s: Slot): Slot => (s.events.some((p) => p.event.isPersonal) ? { ...s, events: s.events.filter(keep) } : s);
  const day = (d: Day): Day => ({
    ...d,
    allDay: d.allDay.filter((e) => !e.isPersonal),
    early: d.early.filter(keep),
    evening: d.evening.filter(keep),
    am: slot(d.am),
    pm: slot(d.pm),
    eve: d.eve ? slot(d.eve) : null,
  });
  return { ...week, days: week.days.map(day) };
}

/** Distinct personal events on these days (all-day and timed), for the status bar's "2 personal hidden". */
export function personalCount(days: readonly Day[]): number {
  const ids = new Set<string>();
  const add = (e: CalEvent) => e.isPersonal && e.responseStatus !== "declined" && ids.add(e.id);
  for (const d of days) {
    d.allDay.forEach(add);
    for (const p of [...d.early, ...d.am.events, ...d.pm.events, ...(d.eve?.events ?? []), ...d.evening]) add(p.event);
  }
  return ids.size;
}
