// Which cards a day shows (step 6b): morning and afternoon, plus the evening slot when the day has one. A day with
// only an evening slot (a weekend flex session) shows just that card. RS-2: decided in plan/dayblocks.ts, the one
// answer Week and Day share; this file keeps the names the grid and the keys import.
import type { Day, Half } from "../week/types.ts";
import { cardHalves } from "../plan/dayblocks.ts";

export { cardHalves, eveOnly, slotOf } from "../plan/dayblocks.ts";

/** The nearest half a day can show for a wanted one (EVE falls back to PM; a day with only EVE gets EVE). */
export function validHalf(d: Day, h: Half): Half {
  const hs = cardHalves(d);
  return hs.includes(h) ? h : hs.includes("PM") ? "PM" : hs[0]!;
}
