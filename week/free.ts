// Free time of a half-day, one number for every view (step 6, D100): cards, details and Plan the day.
// Pure. Free = the slot's free gaps (no busy meeting or personal event), minus PTO, and from `now` on when
// the half-day is under way.
import type { Slot } from "./types.ts";

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

type FreeInput = Pick<Slot, "start" | "end" | "freeGaps" | "longestFreeMinutes"> & { ptoMinutes?: number };

/**
 * Total free minutes. With `now`, time before it doesn't count (a half-day that has ended has none).
 * PTO isn't placed in time, so it caps the total instead of removing a stretch: free can't exceed the
 * half-day's length minus its PTO (and an Outlook out-of-office event for the same time isn't counted twice).
 */
export function freeMinutes(slot: FreeInput, now?: string): number {
  const t = now ? ms(now) : -Infinity;
  let gaps = 0;
  for (const g of slot.freeGaps) {
    const a = Math.max(ms(g.start), t);
    const b = ms(g.end);
    if (b > a) gaps += (b - a) / 60_000;
  }
  const length = (ms(slot.end) - ms(slot.start)) / 60_000;
  const cap = Math.max(0, length - (slot.ptoMinutes ?? 0));
  return Math.floor(Math.max(0, Math.min(gaps, cap)));
}

/** Longest free stretch, never more than the total free (PTO can shrink it). */
export function longestFree(slot: FreeInput, now?: string): number {
  return Math.min(slot.longestFreeMinutes, freeMinutes(slot, now));
}

/** `now` only while the half-day is under way, so cards show the whole half-day before and after it. */
export function nowIfUnderway(slot: Pick<Slot, "start" | "end">, now: string): string | undefined {
  const t = ms(now);
  return t > ms(slot.start) && t < ms(slot.end) ? now : undefined;
}
