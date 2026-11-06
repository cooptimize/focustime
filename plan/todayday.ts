// QF-1: what Today shows for a day. Today is the one day that nudges (the urgent strip, the attention line, the moment
// card) and that can be changed; any other day is read only (a past day links to its Close out, a later one to Plan).
// A PTO day is shown, not blank: "You're off", only the blocks that still hold a pick, all read only, nothing nags. A
// PTO half is muted on its own card; the other half is a normal block.
import type { Day, Half, IsoDate, Slot } from "../week/types.ts";

export type TodayShape = {
  isToday: boolean;
  past: boolean;
  /** A whole PTO day. */
  ptoDay: boolean;
  /** A day with working hours that isn't PTO. */
  workday: boolean;
  /** The urgent strip, the attention line, the moment card, setup and the phone's lead card. */
  nudges: boolean;
  /** Nothing ticks, moves, starts or opens the detail panel. */
  readOnly: boolean;
  /** The block cards, in order; `muted` for a PTO half (or every block of a PTO day). */
  blocks: { slot: Slot; muted: boolean }[];
};

/** The day's slots with a focus block, an Open half-day or an evening slot (working time only). */
export function slotsOf(day: Day): Slot[] {
  return [day.am, day.pm, ...(day.eve ? [day.eve] : [])].filter((s) => !s.off && (s.focus.length > 0 || s.open || s.half === "EVE"));
}

export function todayShape(day: Day | null, o: { date: IsoDate; today: IsoDate; /** Today's own answer (hours, flex, the server's PTO). */ todayWorkday: boolean; /** Halves with a planned or done pick. */ picked: ReadonlySet<Half> }): TodayShape {
  const isToday = o.date === o.today;
  const past = o.date < o.today;
  const ptoDay = !!day?.pto;
  const workday = !!day && !ptoDay && (isToday ? o.todayWorkday : day.hours.segments.length > 0);
  // A PTO half has no block or Open half-day left; it still shows, muted, where it would be.
  const slots = !day ? [] : workday ? [day.am, day.pm, ...(day.eve ? [day.eve] : [])].filter((s) => slotsOf(day).includes(s) || (s.pto && !s.off && s.half !== "EVE")) : ptoDay ? [day.am, day.pm, ...(day.eve ? [day.eve] : [])].filter((s) => o.picked.has(s.half)) : [];
  return {
    isToday,
    past,
    ptoDay,
    workday,
    nudges: isToday && !ptoDay,
    readOnly: !isToday || ptoDay,
    blocks: slots.map((slot) => ({ slot, muted: slot.pto || ptoDay })),
  };
}

/** QF-1: the next day after `date` with working hours that isn't PTO, within three weeks (a PTO day's link). */
export function nextWorkingDay(date: IsoDate, hasHours: (d: IsoDate) => boolean, isPto: (d: IsoDate) => boolean): IsoDate | null {
  let d = Temporal.PlainDate.from(date);
  for (let i = 0; i < 21; i++) {
    d = d.add({ days: 1 });
    const iso = d.toString();
    if (hasHours(iso) && !isPto(iso)) return iso;
  }
  return null;
}
