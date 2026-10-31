// Free time of a half-day, one number for every view (step 6, D100): cards, details and Plan the day.
// Pure. Free = the slot's free gaps (no busy meeting or personal event), from `now` on when the half-day is
// under way. A PTO day has none (D105).
import type { Slot } from "./types.ts";

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

type FreeInput = Pick<Slot, "start" | "end" | "freeGaps" | "longestFreeMinutes"> & { pto?: boolean };

/** Total free minutes. With `now`, time before it doesn't count (a half-day that has ended has none). */
export function freeMinutes(slot: FreeInput, now?: string): number {
  if (slot.pto) return 0;
  const t = now ? ms(now) : -Infinity;
  let gaps = 0;
  for (const g of slot.freeGaps) {
    const a = Math.max(ms(g.start), t);
    const b = ms(g.end);
    if (b > a) gaps += (b - a) / 60_000;
  }
  return Math.floor(gaps);
}

/** Longest free stretch, never more than the total free (from now on, or none on a PTO day). */
export function longestFree(slot: FreeInput, now?: string): number {
  return Math.min(slot.longestFreeMinutes, freeMinutes(slot, now));
}

/** `now` only while the half-day is under way, so cards show the whole half-day before and after it. */
export function nowIfUnderway(slot: Pick<Slot, "start" | "end">, now: string): string | undefined {
  const t = ms(now);
  return t > ms(slot.start) && t < ms(slot.end) ? now : undefined;
}
