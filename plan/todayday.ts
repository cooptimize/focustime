// QF-1: what Today shows for a day. Today is the one day that nudges (the urgent strip, the attention line, the moment
// card) and that can be changed; any other day is read only (a past day links to its Close out, a later one to Plan).
// A PTO day is shown, not blank: "You're off", only the blocks that still hold a pick, all read only, nothing nags. A
// PTO half is muted on its own card; the other half is a normal block.
// RS-2: the blocks are Week's own (plan/dayblocks.ts), so a working catch-up day's morning and afternoon are blocks here too.
import type { Day, Half, IsoDate, Slot } from "../week/types.ts";
import { dayBlocks, slotOf, type WholeDay } from "./dayblocks.ts";

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
  /** RS-2: Week draws the day as one cell: PTO, or a catch-up day with no working hours. */
  whole: WholeDay | null;
};

export function todayShape(day: Day | null, o: { date: IsoDate; today: IsoDate; /** Today's own answer (hours, flex, the server's PTO). */ todayWorkday: boolean; /** Halves with a planned or done pick. */ picked: ReadonlySet<Half> }): TodayShape {
  const isToday = o.date === o.today;
  const past = o.date < o.today;
  const ptoDay = !!day?.pto;
  const workday = !!day && !ptoDay && (isToday ? o.todayWorkday : day.hours.segments.length > 0);
  const shape = day ? dayBlocks(day) : null;
  // RS-2: a working day's blocks are the cards Week draws for it (a PTO half shows, muted, where it would be). A PTO day
  // keeps only the halves that still hold a to-do; a day with no working hours has none (a catch-up day is one cell).
  const slots = !day || !shape ? [] : ptoDay ? [day.am, day.pm, ...(day.eve ? [day.eve] : [])].filter((s) => o.picked.has(s.half)) : workday ? shape.halves.map((h) => slotOf(day, h)!).filter(Boolean) : [];
  return {
    isToday,
    past,
    ptoDay,
    workday,
    nudges: isToday && !ptoDay,
    readOnly: !isToday || ptoDay,
    blocks: slots.map((slot) => ({ slot, muted: slot.pto || ptoDay })),
    whole: shape?.whole ?? null,
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
