// The Today view (step 10): which pick "Start focus" starts, and which follow-ups count as urgent. Pure.
import type { Half, IsoDate } from "../week/types.ts";
import type { Pick } from "./types.ts";

const ORDER: Half[] = ["AM", "PM", "EVE"];

/**
 * The pick Start focus timeboxes: the first planned pick of the half-day under way, else the first planned pick of a
 * later half-day today, else the first planned pick left. Done, moved and dropped picks never.
 */
export function focusPick(picks: readonly Pick[], current: Half | null): Pick | null {
  const planned = picks.filter((p) => p.status === "planned").sort((a, b) => ORDER.indexOf(a.half) - ORDER.indexOf(b.half) || a.position - b.position);
  if (!planned.length) return null;
  if (current) {
    const from = ORDER.indexOf(current);
    const here = planned.find((p) => ORDER.indexOf(p.half) >= from);
    if (here) return here;
  }
  return planned[0]!;
}

/** Follow-ups due today or earlier (open ones only), oldest due first. */
export function urgentFollowUps<T extends { due: IsoDate | null; closedAt?: string | null }>(followUps: readonly T[], today: IsoDate): T[] {
  return followUps.filter((l) => !l.closedAt && l.due !== null && l.due <= today).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
}
