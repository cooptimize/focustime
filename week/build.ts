import { dayBounds, iso, WEEKDAYS, weekDates } from "./dates.ts";
import { expandPatterns, mergeFocus, standingBlocksFor } from "./patterns.ts";
import { placeEvents } from "./placement.ts";
import type { PtoDay } from "./pto.ts";
import { evaluateRisks } from "./risks.ts";
import type { CalEvent, Day, FocusPattern, Half, IsoDate, PlacedEvent, Slot, Week, WeekConfig } from "./types.ts";

export type BuildWeekInput = {
  weekStart: IsoDate;
  patterns: readonly FocusPattern[];
  events: readonly CalEvent[];
  config: WeekConfig;
  /** PTO days from Dataverse (step 6), by date. */
  pto?: Readonly<Record<IsoDate, PtoDay>>;
};

/** Build the whole week view model. Pure: same input, same output. */
export function buildWeek({ weekStart, patterns, events, config, pto = {} }: BuildWeekInput): Week {
  const dates = weekDates(weekStart);
  const shape = config.dayShape;
  const dataverse = expandPatterns(patterns, weekStart);
  const standing = standingBlocksFor(config.standingBlocks, weekStart);
  const placed = placeEvents(events, weekStart, shape);

  const days: Day[] = dates.map((date, i) => {
    const kind = i < 4 ? "work" : "overflow";
    const buckets = placed.get(date)!;
    const b = dayBounds(date, shape);
    const off = pto[date] ?? null;

    const slot = (half: Half, evs: PlacedEvent[]): Slot => {
      const at = (x: { date: IsoDate; half: Half }) => x.date === date && x.half === half;
      const focus = kind === "overflow" ? [] : mergeFocus(dataverse.filter(at), standing.filter(at));
      const start = iso(half === "AM" ? b.start : b.split);
      const end = iso(half === "AM" ? b.split : b.end);
      const r = evaluateRisks({ focus, events: evs, allDay: buckets.allDay, start, end, timeZone: shape.timeZone }, config.thresholds);
      // A PTO day is simply off: nothing there is at risk (D99, D105).
      const risks = off ? [] : r.risks;
      return { date, half, start, end, focus, open: kind === "work" && focus.length === 0, events: evs, ...r, risks, pto: !!off };
    };

    return {
      date,
      weekday: WEEKDAYS[i]!,
      kind,
      allDay: buckets.allDay,
      early: buckets.early,
      am: slot("AM", buckets.am),
      pm: slot("PM", buckets.pm),
      evening: buckets.evening,
      pto: off,
    };
  });

  return { weekStart, timeZone: shape.timeZone, days };
}
