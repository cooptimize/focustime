// Check-in (step 7, midday): for today, the free time each block or slot has left after meetings, and what each
// planned pick still needs. QT-2: nothing here says a pick doesn't fit or a block is over; the check-in states free
// time as a fact. Pure; the UI passes the week's slots, today's picks, focused time and the clock.
import type { SizeScale } from "./estimate.ts";
import { pickNeed } from "./types.ts";
import { freeMinutes } from "../week/free.ts";
import type { Half, Slot } from "../week/types.ts";
import type { Pick } from "./types.ts";

export type CheckPick = {
  pick: Pick;
  /** Minutes still needed: its size less the time focused on it (0 for a done pick). */
  needMinutes: number;
  focusedMinutes: number;
};

export type CheckSlot = {
  half: Half;
  /** Free minutes left from now on, after meetings and personal events (0 once the slot has ended). */
  leftMinutes: number;
  ended: boolean;
  /** Minutes the planned picks still need. */
  needMinutes: number;
  picks: CheckPick[];
};

type SlotIn = { start: Slot["start"]; end: Slot["end"]; freeGaps: Slot["freeGaps"]; longestFreeMinutes: number; pto?: boolean };

/** Picks keep their order; each planned pick says what it still needs. Done picks need nothing. */
export function checkIn(slots: readonly { half: Half; slot: SlotIn }[], picks: readonly Pick[], focused: (id: number) => number, sizes: SizeScale, now: string, boxed: (pickId: number) => number | null = () => null): CheckSlot[] {
  const t = Temporal.Instant.from(now).epochMilliseconds;
  return slots.map(({ half, slot }) => {
    const ended = Temporal.Instant.from(slot.end).epochMilliseconds <= t;
    const left = ended ? 0 : freeMinutes(slot, now);
    const mine = picks.filter((p) => p.half === half && (p.status === "planned" || p.status === "done")).sort((a, b) => a.position - b.position);
    let used = 0;
    const out = mine.map((p): CheckPick => {
      const focusedMinutes = Math.floor(focused(p.id) / 60);
      if (p.status === "done") return { pick: p, needMinutes: 0, focusedMinutes };
      // A timeboxed pick needs its timeboxed time (step 12), else what's left.
      // TX-1: once a check-in has said what's left, focus time before it is already in that number.
      const spent = p.remainingMinutes == null ? focusedMinutes : 0;
      const need = p.resolved ? 0 : Math.max(0, (boxed(p.id) ?? pickNeed(p, sizes)) - spent);
      used += need;
      return { pick: p, needMinutes: need, focusedMinutes };
    });
    return { half, leftMinutes: left, ended, needMinutes: used, picks: out };
  });
}
