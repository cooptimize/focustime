// Fit while planning (step 15, D266): picks against a block's whole free time, in calm words. Pure.
// Check-in alone compares against the time left (capacityMinutes with now); everything else uses this.
import { freeMinutes } from "../week/free.ts";
import type { FreeGap, IsoDate } from "../week/types.ts";
import { fitOf, type Fit } from "./rules.ts";
import { slotPlanned } from "./timebox.ts";

type PickLike = { id: number; status: string; size: string | null };
type BoxLike = { date: IsoDate; pickId: number | null; start: string; end: string; removedAt: string | null };
type SlotLike = { date: IsoDate; start: string; end: string; pto: boolean; freeGaps: FreeGap[]; longestFreeMinutes: number };

/** Planned and done picks (timebox minutes when timed) against the block's whole free time. */
export function planFit(picks: readonly PickLike[], sizes: Readonly<Record<string, number>>, timeboxes: readonly BoxLike[] | undefined, slot: SlotLike): Fit {
  return fitOf(planMinutes(picks, sizes, timeboxes, slot), freeMinutes(slot));
}
/** Minutes of planned and done picks in a block (timed ones by their timebox). */
export function planMinutes(picks: readonly PickLike[], sizes: Readonly<Record<string, number>>, timeboxes: readonly BoxLike[] | undefined, slot: Pick<SlotLike, "date" | "start" | "end">): number {
  const live = picks.filter((p) => p.status === "planned" || p.status === "done").map((p) => ({ ...p, status: "planned" }));
  return slotPlanned(live, sizes, timeboxes, slot);
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

/**
 * Time in plain words (step 16.4): "under an hour", "about an hour", "about 3 hours". Whole hours only, never "1h 15m"
 * or a fraction.
 */
export function aboutHours(minutes: number): string {
  if (minutes < 45) return "under an hour";
  if (minutes < 90) return "about an hour";
  return `about ${Math.round(minutes / 60)} hours`;
}

/** The fit in a few calm words. Never red: over is amber with "About an hour over". */
export function fitWords(f: Fit | null): FitWords {
  if (!f || f.kind === "empty") return { kind: "none", text: "", tone: "neutral" };
  if (f.kind === "over") {
    if (f.by <= OVER_GRACE) return { kind: "fits", text: "Fits", tone: "neutral" };
    if (f.by < 45) return { kind: "over", text: "A little over", tone: "watch" };
    const w = aboutHours(f.by);
    return { kind: "over", text: `${w[0]!.toUpperCase()}${w.slice(1)} over`, tone: "watch" };
  }
  if (f.spare >= 45) return { kind: "room", text: `Room for ${aboutHours(f.spare)} more`, tone: "neutral" };
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
    .sort((a, b) => Number(musts.has(a.p.id)) - Number(musts.has(b.p.id)) || (sizes[b.p.size ?? "M"] ?? 0) - (sizes[a.p.size ?? "M"] ?? 0) || Number(timed.has(a.p.id)) - Number(timed.has(b.p.id)) || b.i - a.i);
  const out: number[] = [];
  let covered = 0;
  for (const { p } of order) {
    if (covered >= overBy) break;
    out.push(p.id);
    covered += sizes[p.size ?? "M"] ?? 0;
  }
  return out;
}

/** Plan the day's status line in plain words: "About 7 hours of work · about 6 hours free". */
export function dayTotals(blocks: readonly { planned: number; free: number }[]): string {
  const work = blocks.reduce((s, b) => s + b.planned, 0);
  const free = blocks.reduce((s, b) => s + b.free, 0);
  const cap = (t: string) => `${t[0]!.toUpperCase()}${t.slice(1)}`;
  return work ? `${cap(aboutHours(work))} of work · ${aboutHours(free)} free` : `Nothing planned yet · ${aboutHours(free)} free`;
}

/** Whole hours in short form for a card's fit (U4): "2h", or "1h 30m" under 2 hours; quarter hours only. */
function shortHours(minutes: number): string {
  const q = Math.max(15, Math.round(minutes / 15) * 15);
  return q >= 120 ? `${Math.round(q / 60)}h` : hm(q);
}

/**
 * A Plan the day block's fit, said once on the right of its header (U4): "About 2h over" (amber, with Trim) or
 * "Fits · 30m spare" (muted). Never red. Nothing for an empty block.
 */
export function blockFitWords(f: Fit | null): FitWords {
  if (!f || f.kind === "empty") return { kind: "none", text: "", tone: "neutral" };
  if (f.kind === "over" && f.by > OVER_GRACE) return { kind: "over", text: f.by < 45 ? "A little over" : `About ${shortHours(f.by)} over`, tone: "watch" };
  const spare = f.kind === "over" ? 0 : f.spare;
  return { kind: spare >= ROOM_FROM ? "room" : "fits", text: spare >= 15 ? `Fits · ${shortHours(spare)} spare` : "Fits", tone: "neutral" };
}

/**
 * Plan the day's header line (U4): "about 5 hours free" and, only when some block is over, "about 2 hours over"
 * (the amber part): the sum of each block's overage, so it agrees with the block fit words.
 */
export function dayHeadline(blocks: readonly { planned: number; free: number }[]): { free: string; over: string | null } {
  const free = blocks.reduce((s, b) => s + b.free, 0);
  const over = blocks.reduce((s, b) => s + (b.planned - b.free > OVER_GRACE ? b.planned - b.free : 0), 0);
  return { free: `${aboutHours(free)} free`, over: over > 0 ? `${aboutHours(over)} over` : null };
}
