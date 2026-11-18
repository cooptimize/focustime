// WD-1, WK-6: a block's meetings in words, for its card's one line ("3 meetings · 2h 30m · 1h 45m free"), the named
// meetings' heading ("2h 30m · 1h 45m free") and the block panel's line (the card's folded line). Pure.
import { formatDuration } from "../week/format.ts";
import { freeMinutes } from "../week/free.ts";
import type { Slot } from "../week/types.ts";

const ms = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

/**
 * WD-1 (MB-1's agenda line on every card with no rail): "3 meetings · 2h 30m · 1h 45m free", the block's meetings and
 * personal events (shown as free left out), their time inside the block, and the free time.
 */
export function meetingsLine(slot: Slot): string {
  const { n, minutes, free } = meetingParts(slot);
  return [n ? `${n} meeting${n === 1 ? "" : "s"}` : "No meetings", n && minutes ? formatDuration(minutes) : "", free].filter(Boolean).join(" · ");
}
/** WK-6: the named meetings' heading after its word: the meetings' time in the block, then the free time ("1h 30m · 2h free"). */
export function meetingsSum(slot: Slot): string {
  const { n, minutes, free } = meetingParts(slot);
  return [n && minutes ? formatDuration(minutes) : "", free].filter(Boolean).join(" · ");
}
function meetingParts(slot: Slot) {
  const busy = slot.events.filter((e) => e.event.showAs !== "free");
  const minutes = busy.reduce((m, e) => m + Math.max(0, Math.round((ms(e.clipEnd) - ms(e.clipStart)) / 60000)), 0);
  return { n: busy.length, minutes, free: `${formatDuration(freeMinutes(slot))} free` };
}
