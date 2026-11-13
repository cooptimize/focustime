// RS-2: what a day holds, decided once for Week's grid, Day's Cards, Day's Timeline and the phone's Day. A weekend day is
// its own quiet column; a PTO day (or holiday) is one hatched cell; a catch-up day with no working hours is one dashed
// "Catch-up" cell; every other day is its half-day blocks: morning and afternoon, plus the evening when it has one (a day
// with only an evening, a weekend flex session, is just that). A catch-up day with working hours is two blocks like any
// day, named "Catch-up" and drawn without a client color. Pure.
import type { Day, Half, Slot } from "../week/types.ts";

export type WholeDay = "pto" | "catchup";

export type DayBlocks = {
  /** A Saturday or Sunday: Week's quiet column, Day's plain list. */
  weekend: boolean;
  /** The whole day as one cell, or null when the day is its halves. */
  whole: WholeDay | null;
  /** The halves drawn as block cards, in order; none for a weekend or a whole day. */
  halves: Half[];
};

/** Only an evening slot (a weekend flex session): one card spanning the day. */
export const eveOnly = (d: Day) => !!d.eve && d.am.off && d.pm.off;

/** The cards a day's column draws: morning and afternoon, plus the evening when the day has one. */
export function cardHalves(d: Day): Half[] {
  if (eveOnly(d)) return ["EVE"];
  return d.eve ? ["AM", "PM", "EVE"] : ["AM", "PM"];
}

export function slotOf(d: Day, h: Half): Slot | null {
  return h === "AM" ? d.am : h === "PM" ? d.pm : d.eve;
}

/** The one answer: what Week and Day draw for a day. */
export function dayBlocks(d: Day): DayBlocks {
  if (d.kind === "weekend") return { weekend: true, whole: null, halves: [] };
  if (d.pto) return { weekend: false, whole: "pto", halves: [] };
  if (d.kind !== "work" && d.am.off && d.pm.off && !d.eve) return { weekend: false, whole: "catchup", halves: [] };
  return { weekend: false, whole: null, halves: cardHalves(d) };
}

/** The catch-up day's blocks have no client of their own: Week and Day name them "Catch-up" in the neutral color. */
export const isCatchUp = (d: Day, s: Slot) => d.kind === "overflow" && s.half !== "EVE";
