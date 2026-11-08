// Check-in (step 7, midday): for today, what each block or slot has left after meetings, and which picks no longer
// fit. Pure; the UI passes the week's slots, today's picks, focused time and the clock.
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
  /** Planned picks only: false once it no longer fits in what is left of its slot. */
  fits: boolean;
};

export type CheckSlot = {
  half: Half;
  /** Free minutes left from now on, after meetings and personal events (0 once the slot has ended). */
  leftMinutes: number;
  ended: boolean;
  /** Minutes the planned picks still need. */
  needMinutes: number;
  /** How far over the planned picks are; 0 when they fit. */
  overBy: number;
  picks: CheckPick[];
};

type SlotIn = { start: Slot["start"]; end: Slot["end"]; freeGaps: Slot["freeGaps"]; longestFreeMinutes: number; pto?: boolean };

/**
 * Picks keep their order: in turn, each planned pick takes its remaining need from what is left; the first one that
 * no longer fits and every one after it are flagged. Done picks are shown, never flagged.
 */
export function checkIn(slots: readonly { half: Half; slot: SlotIn }[], picks: readonly Pick[], focused: (id: number) => number, sizes: SizeScale, now: string, boxed: (pickId: number) => number | null = () => null): CheckSlot[] {
  const t = Temporal.Instant.from(now).epochMilliseconds;
  return slots.map(({ half, slot }) => {
    const ended = Temporal.Instant.from(slot.end).epochMilliseconds <= t;
    const left = ended ? 0 : freeMinutes(slot, now);
    const mine = picks.filter((p) => p.half === half && (p.status === "planned" || p.status === "done")).sort((a, b) => a.position - b.position);
    let used = 0;
    let broken = false;
    const out = mine.map((p): CheckPick => {
      const focusedMinutes = Math.floor(focused(p.id) / 60);
      if (p.status === "done") return { pick: p, needMinutes: 0, focusedMinutes, fits: true };
      // A timeboxed pick needs its timeboxed time (step 12), else its size.
      const need = p.resolved ? 0 : Math.max(0, (boxed(p.id) ?? pickNeed(p, sizes)) - focusedMinutes);
      used += need;
      if (used > left) broken = true;
      return { pick: p, needMinutes: need, focusedMinutes, fits: !broken };
    });
    return { half, leftMinutes: left, ended, needMinutes: used, overBy: Math.max(0, used - left), picks: out };
  });
}
