// Which cards a day shows (step 6b): morning and afternoon, plus the evening slot when the day has one. A day with
// only an evening slot (a weekend flex session) shows just that card. Pure; shared by the grid and the keys.
import type { Day, Half, Slot } from "../week/types.ts";

export const eveOnly = (d: Day) => !!d.eve && d.am.off && d.pm.off;

export function cardHalves(d: Day): Half[] {
  if (eveOnly(d)) return ["EVE"];
  return d.eve ? ["AM", "PM", "EVE"] : ["AM", "PM"];
}

export function slotOf(d: Day, h: Half): Slot | null {
  return h === "AM" ? d.am : h === "PM" ? d.pm : d.eve;
}

/** The nearest half a day can show for a wanted one (EVE falls back to PM; a day with only EVE gets EVE). */
export function validHalf(d: Day, h: Half): Half {
  const hs = cardHalves(d);
  return hs.includes(h) ? h : hs.includes("PM") ? "PM" : hs[0]!;
}
