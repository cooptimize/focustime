import { dayBounds, iso, WEEKDAYS, weekDates } from "./dates";
import { expandPatterns, mergeFocus, standingBlocksFor } from "./patterns";
import { placeEvents } from "./placement";
import { evaluateRisks } from "./risks";
import type { CalEvent, Day, FocusPattern, Half, IsoDate, PlacedEvent, Slot, Week, WeekConfig } from "./types";

export type BuildWeekInput = {
  weekStart: IsoDate;
  patterns: readonly FocusPattern[];
  events: readonly CalEvent[];
  config: WeekConfig;
};

/** Build the whole week view model. Pure: same input, same output. */
export function buildWeek({ weekStart, patterns, events, config }: BuildWeekInput): Week {
  const dates = weekDates(weekStart);
  const shape = config.dayShape;
  const dataverse = expandPatterns(patterns, weekStart);
  const standing = standingBlocksFor(config.standingBlocks, weekStart);
  const placed = placeEvents(events, weekStart, shape);

  const days: Day[] = dates.map((date, i) => {
    const kind = i < 4 ? "work" : "overflow";
    const buckets = placed.get(date)!;
    const b = dayBounds(date, shape);

    const slot = (half: Half, evs: PlacedEvent[]): Slot => {
      const at = (x: { date: IsoDate; half: Half }) => x.date === date && x.half === half;
      const focus = kind === "overflow" ? [] : mergeFocus(dataverse.filter(at), standing.filter(at));
      const start = iso(half === "AM" ? b.start : b.split);
      const end = iso(half === "AM" ? b.split : b.end);
      const r = evaluateRisks({ focus, events: evs, allDay: buckets.allDay, start, end, timeZone: shape.timeZone }, config.thresholds);
      return { date, half, start, end, focus, open: kind === "work" && focus.length === 0, events: evs, ...r };
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
    };
  });

  return { weekStart, timeZone: shape.timeZone, days };
}
