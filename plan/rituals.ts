// Step 17, slice 4: the Plan ahead rituals. "Look ahead 4 weeks" every other Thursday, once that Thursday's next week
// is planned (Done in Plan the week); the 8 to 12 week direction review on the first Thursday of each month. Each is
// due from the start of working time on a working day (a PTO day or a day without hours moves it to the next working
// day's start), fires once, and stays due (a dot on Plan ahead) until Plan ahead is opened for it. Pure.
import type { IsoDate } from "../week/types.ts";

/** A Thursday the fortnightly look ahead counts from (D355): Nov 5 2026, then every 14 days. */
export const LOOK_AHEAD_ANCHOR: IsoDate = "2026-11-05";

/** The marker kind (store markers) for "Plan ahead was opened for this ritual". */
export const AHEAD_SEEN_MARK = "ahead_seen";

export type AheadRitualKind = "plan_ahead" | "direction";
export type AheadRitual = { kind: AheadRitualKind; key: string; occasion: IsoDate };

const D = (d: IsoDate) => Temporal.PlainDate.from(d);
const plus = (d: IsoDate, n: number) => D(d).add({ days: n }).toString();
const days = (a: IsoDate, b: IsoDate) => D(a).until(D(b), { largestUnit: "days" }).days;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The look-ahead Thursday whose week (Thursday to the next Wednesday) holds this day. Null in the off weeks. */
export function lookAheadOccasion(today: IsoDate): IsoDate | null {
  const since = mod(days(LOOK_AHEAD_ANCHOR, today), 14);
  return since <= 6 ? plus(today, -since) : null;
}

/** The first Thursday of the day's month, when the day is on or after it. */
export function directionOccasion(today: IsoDate): IsoDate | null {
  const first = D(today).with({ day: 1 });
  const thu = first.add({ days: mod(4 - first.dayOfWeek, 7) }).toString();
  return today >= thu ? thu : null;
}

/** The next look-ahead Thursday and direction review on or after a day (Settings > Planning shows them). */
export function nextRituals(today: IsoDate): { lookAhead: IsoDate; direction: IsoDate } {
  const la = plus(today, mod(14 - mod(days(LOOK_AHEAD_ANCHOR, today), 14), 14));
  let m = D(today).with({ day: 1 });
  for (;;) {
    const thu = m.add({ days: mod(4 - m.dayOfWeek, 7) }).toString();
    if (thu >= today) return { lookAhead: la, direction: thu };
    m = m.add({ months: 1 });
  }
}

export type RitualFacts = {
  today: IsoDate;
  /** "HH:MM" now, in the configured zone. */
  time: string;
  /** Today's first working time ("HH:MM"); null without hours. */
  workStart: string | null;
  pto: boolean;
  /** CF-1: that week has anything placed (was: confirmed). */
  weekHasWork: (weekStart: IsoDate) => boolean;
  /** Plan ahead was opened for this occasion. */
  seen: (key: string) => boolean;
};

/**
 * The rituals due now. Look ahead: in the look-ahead week (Thursday to Wednesday), once next week (the Monday after the
 * Thursday) has anything placed (CF-1; was: confirmed). Direction: from the first Thursday to the end of that month. Both only on a working day
 * from its working start, and not once Plan ahead was opened for them.
 */
export function aheadRitualsDue(f: RitualFacts): AheadRitual[] {
  if (f.pto || !f.workStart || f.time < f.workStart) return [];
  const out: AheadRitual[] = [];
  const la = lookAheadOccasion(f.today);
  if (la && f.weekHasWork(plus(la, 4))) {
    const key = `plan_ahead:${la}`;
    if (!f.seen(key)) out.push({ kind: "plan_ahead", key, occasion: la });
  }
  const dr = directionOccasion(f.today);
  if (dr) {
    const key = `direction:${dr.slice(0, 7)}`;
    if (!f.seen(key)) out.push({ kind: "direction", key, occasion: dr });
  }
  return out;
}
