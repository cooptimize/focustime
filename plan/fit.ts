// Fit while planning (step 15, D266): picks against a block's whole free time, in calm words. Pure.
// Check-in alone compares against the time left (capacityMinutes with now); everything else uses this.
import { freeMinutes } from "../week/free.ts";
import type { FreeGap, IsoDate } from "../week/types.ts";
import { fitOf, type Fit } from "./rules.ts";
import { slotPlanned } from "./timebox.ts";

type PickLike = { id: number; status: string; size: string };
type BoxLike = { date: IsoDate; pickId: number | null; start: string; end: string; removedAt: string | null };
type SlotLike = { date: IsoDate; start: string; end: string; pto: boolean; freeGaps: FreeGap[]; longestFreeMinutes: number };

/** Planned and done picks (timebox minutes when timed) against the block's whole free time. */
export function planFit(picks: readonly PickLike[], sizes: Readonly<Record<string, number>>, timeboxes: readonly BoxLike[] | undefined, slot: SlotLike): Fit {
  const live = picks.filter((p) => p.status === "planned" || p.status === "done").map((p) => ({ ...p, status: "planned" }));
  return fitOf(slotPlanned(live, sizes, timeboxes, slot), freeMinutes(slot));
}

/** Spare time from this much on reads "Room for about …". */
export const ROOM_FROM = 30;
/** Over by this much or less still reads "Fits" (sizes are estimates). */
export const OVER_GRACE = 10;

export type FitWords = { kind: "none" | "fits" | "room" | "over"; text: string; tone: "neutral" | "watch" };

/** "45m", "1h", "1h 15m". */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** The fit in a few calm words. Never red: over is amber with "About 1h over". */
export function fitWords(f: Fit | null): FitWords {
  if (!f || f.kind === "empty") return { kind: "none", text: "", tone: "neutral" };
  if (f.kind === "over") {
    if (f.by <= OVER_GRACE) return { kind: "fits", text: "Fits", tone: "neutral" };
    return { kind: "over", text: `About ${hm(Math.max(15, Math.round(f.by / 15) * 15))} over`, tone: "watch" };
  }
  if (f.spare >= ROOM_FROM) return { kind: "room", text: `Room for about ${hm(Math.floor(f.spare / 15) * 15)} more`, tone: "neutral" };
  return { kind: "fits", text: "Fits", tone: "neutral" };
}

/**
 * Picks to shrink or move so a block fits: the fewest planned picks whose sizes cover the overage. Musts last, larger
 * first, untimed before timed, later in the list first. Empty when nothing is over.
 */
export function trimCandidates<P extends PickLike>(picks: readonly P[], overBy: number, sizes: Readonly<Record<string, number>>, opts: { musts?: ReadonlySet<number>; timed?: ReadonlySet<number> } = {}): number[] {
  if (overBy <= OVER_GRACE) return [];
  const musts = opts.musts ?? new Set<number>();
  const timed = opts.timed ?? new Set<number>();
  const order = picks
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.status === "planned")
    .sort((a, b) => Number(musts.has(a.p.id)) - Number(musts.has(b.p.id)) || (sizes[b.p.size] ?? 0) - (sizes[a.p.size] ?? 0) || Number(timed.has(a.p.id)) - Number(timed.has(b.p.id)) || b.i - a.i);
  const out: number[] = [];
  let covered = 0;
  for (const { p } of order) {
    if (covered >= overBy) break;
    out.push(p.id);
    covered += sizes[p.size] ?? 0;
  }
  return out;
}

/** Plan the day's status line: "7h of work · 6h 15m free". */
export function dayTotals(blocks: readonly { planned: number; free: number }[]): string {
  const work = blocks.reduce((s, b) => s + b.planned, 0);
  const free = blocks.reduce((s, b) => s + b.free, 0);
  return work ? `${hm(work)} of work · ${hm(free)} free` : `Nothing planned yet · ${hm(free)} free`;
}
